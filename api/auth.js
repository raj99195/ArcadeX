// api/auth.js
//
// ArcadeX authentication endpoint — issues 24-hour JWTs after verifying
// (a) a Cloudflare Turnstile token, (b) a personal-signed message from
// the wallet, (c) the wallet is not banned, and (d) the caller's IP
// hasn't burst-farmed JWTs in the last minute.
//
// Also computes a `probation` flag from lightweight bot-detection signals
// (headless user-agent, fresh wallet, IP burst) and embeds it in the JWT
// payload. Downstream endpoints (start-session / sign-score) tighten
// their thresholds when a token carries `probation: true`. No user is
// ever hard-blocked by probation — they just face the friction a bot
// can't cheaply pay through.
//
// Env vars required (Vercel):
//   JWT_SECRET               — signing key for issued tokens
//   ALLOWED_ORIGIN           — https://playarcadex.in (fail-closed CORS)
//   TURNSTILE_SECRET_KEY     — Cloudflare Turnstile secret (from dashboard)
//   MST_RPC_URL              — used for fresh-wallet detection
//   FIREBASE_PROJECT_ID / _CLIENT_EMAIL / _PRIVATE_KEY — for banned check
//
// If TURNSTILE_SECRET_KEY is unset (e.g. local dev), Turnstile verification
// is SKIPPED — this lets you deploy the code before flipping the switch.
// Set the env var → verification becomes mandatory automatically.

import { ethers } from "ethers";
import jwt from "jsonwebtoken";

// ── CORS ─────────────────────────────────────────────────────────────
// FAIL-CLOSED: no wildcard fallback. If ALLOWED_ORIGIN is unset, no CORS
// header is sent → browsers block all cross-origin calls.
function cors(res) {
  const allowed = process.env.ALLOWED_ORIGIN;
  if (allowed) res.setHeader("Access-Control-Allow-Origin", allowed);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// ── IP rate limiter (per warm-instance memory) ──────────────────────
// Not perfect across Vercel's warm pool but good enough to slow bursts.
// Real defense is Turnstile; this is a friction layer for solver services.
const ipBuckets = new Map();
function ipRateLimit(ip, max = 10, windowMs = 60_000) {
  if (!ip) return true;
  const now = Date.now();
  const arr = (ipBuckets.get(ip) || []).filter(t => t > now - windowMs);
  if (arr.length >= max) return false;
  ipBuckets.set(ip, [...arr, now]);
  // Bounded map — evict oldest 1000 keys when we hit 10k
  if (ipBuckets.size > 10_000) {
    const keys = [...ipBuckets.keys()].slice(0, 1000);
    for (const k of keys) ipBuckets.delete(k);
  }
  return true;
}

function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0].trim();
  return req.headers["x-real-ip"] || req.socket?.remoteAddress || null;
}

// ── Turnstile verify ────────────────────────────────────────────────
// Calls Cloudflare's siteverify endpoint. Returns { ok, hostname, errors }.
// Fail-closed on missing token when secret is configured.
async function verifyTurnstile(token, ip) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true, skipped: true }; // dev / not-yet-configured
  if (!token)  return { ok: false, reason: "no-token" };
  try {
    const body = new URLSearchParams();
    body.append("secret", secret);
    body.append("response", token);
    if (ip) body.append("remoteip", ip);
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", body,
    });
    const data = await r.json();
    return {
      ok:       !!data.success,
      hostname: data.hostname,
      errors:   data["error-codes"] || [],
    };
  } catch (e) {
    return { ok: false, reason: "verify-error", error: e.message };
  }
}

// ── Fresh-wallet check ───────────────────────────────────────────────
// One MST RPC call. 0 outbound txns = flagged as fresh (contributes to
// probation, not a block). Legit new users pass; drain bots with brand-new
// wallets get tighter thresholds downstream.
async function isFreshWallet(address) {
  try {
    const rpc = process.env.MST_RPC_URL;
    if (!rpc) return false;
    const provider = new ethers.JsonRpcProvider(rpc);
    const count = await provider.getTransactionCount(address);
    return count === 0;
  } catch {
    return false; // RPC hiccup — don't add suspicion on infrastructure failure
  }
}

// ── Bot user-agent heuristics ───────────────────────────────────────
// Well-known headless / scripting fingerprints. False-positive rate near
// zero — no legit human browser advertises these strings.
function isBotUserAgent(ua) {
  if (!ua) return true; // no UA header at all = almost certainly a script
  const s = String(ua).toLowerCase();
  const markers = [
    "headlesschrome", "puppeteer", "playwright", "phantomjs",
    "selenium", "electron", "cypress", "webdriver",
    "python-requests", "node-fetch", "axios/", "got/",
    "curl/", "wget/", "postmanruntime", "insomnia",
  ];
  return markers.some(m => s.includes(m));
}

// ── Banned wallet check (Firestore) ─────────────────────────────────
// Lazy-init firebase-admin so cold auth calls that don't need Firestore
// (rare — every real call needs the ban check) don't pay init cost twice.
let _db = null;
async function getBanDb() {
  if (_db) return _db;
  const admin = (await import("firebase-admin")).default;
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
    });
  }
  _db = admin.firestore();
  return _db;
}
async function isBanned(address) {
  try {
    const db = await getBanDb();
    const snap = await db.collection("bannedWallets").doc(address.toLowerCase()).get();
    return snap.exists;
  } catch {
    return false; // never block legit auth on Firestore hiccups
  }
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")    return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.JWT_SECRET)
    return res.status(503).json({ error: "Auth not configured" });

  try {
    const ip = getClientIp(req);

    // ── Per-IP burst limit ──
    // 10 auth attempts per IP per minute. A real human never needs this.
    // A bot on residential proxy rotation might still get through — that's
    // what Turnstile is for.
    if (!ipRateLimit(ip, 10, 60_000))
      return res.status(429).json({
        error: "Too many auth requests from this IP. Please wait a minute.",
      });

    const { address, signature, message, turnstileToken } = req.body || {};
    if (!address || !signature || !message)
      return res.status(400).json({ error: "Missing fields" });

    if (!ethers.isAddress(address))
      return res.status(400).json({ error: "Invalid address format" });

    // ── Banned wallet check ──
    // Manually-banned wallets (via admin panel) can't refresh their JWT.
    // Their existing JWT still works until it expires (24h max) — for
    // instant kill, we also re-check in sign-score.
    if (await isBanned(address))
      return res.status(403).json({ error: "This wallet has been suspended." });

    // ── Turnstile verify ──
    // Runs before wallet-signature verify so we don't waste an ECDSA
    // recovery on clearly-bot requests.
    const tsResult = await verifyTurnstile(turnstileToken, ip);
    if (!tsResult.ok) {
      return res.status(403).json({
        error: "Human verification failed. Please refresh and try again.",
        reason: tsResult.reason || tsResult.errors?.[0] || "invalid-token",
      });
    }

    // ── Timestamp window ──
    const tsMatch = message.match(/(\d+)$/);
    if (!tsMatch) return res.status(400).json({ error: "Invalid message" });
    const msgAge = Date.now() - parseInt(tsMatch[1]);
    if (msgAge > 5 * 60 * 1000)
      return res.status(400).json({ error: "Message expired — please reconnect" });
    if (msgAge < -60 * 1000)
      return res.status(400).json({ error: "Message timestamp is in the future" });

    // ── Signature verify ──
    let recovered = null;
    try { recovered = ethers.verifyMessage(message, signature); } catch (_) {}
    if (!recovered || recovered.toLowerCase() !== address.toLowerCase()) {
      try {
        const msgHash = ethers.hashMessage(message);
        recovered = ethers.recoverAddress(msgHash, signature);
      } catch (_) {}
    }
    if (!recovered || recovered.toLowerCase() !== address.toLowerCase())
      return res.status(401).json({ error: "Invalid signature" });

    // ── Probation scoring ──
    // Additive signals — any two = probation. Legit user with clean setup
    // scores 0. Botter with headless UA on a fresh wallet scores ≥2.
    let suspicionScore = 0;

    const ua = req.headers["user-agent"];
    if (isBotUserAgent(ua)) suspicionScore += 2;           // strong signal

    if (await isFreshWallet(address)) suspicionScore += 1; // fresh MST wallet

    const ipBucket = ipBuckets.get(ip) || [];
    if (ipBucket.length > 3) suspicionScore += 1;          // burst from this IP

    // Turnstile verification returned success but sometimes carries an
    // interactive-flag in error-codes for borderline cases. If Cloudflare
    // reported ANY error-code (even non-fatal), add 1 suspicion point.
    if (tsResult.errors && tsResult.errors.length > 0) suspicionScore += 1;

    const probation = suspicionScore >= 2;

    // ── Issue JWT ──
    const token = jwt.sign(
      { address: address.toLowerCase(), probation },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );

    return res.status(200).json({
      token,
      address: address.toLowerCase(),
      // probation intentionally NOT returned to client — no need for the
      // frontend to know its own trust level; that stays server-side.
    });
  } catch (err) {
    console.error("Auth error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}