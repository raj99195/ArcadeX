// api/auth.js
import { ethers } from "ethers";
import jwt from "jsonwebtoken";

// ── CORS ────────────────────────────────────────────────────────────
// FAIL-CLOSED: pehle "*" fallback tha. Vercel pe ALLOWED_ORIGIN accidentally
// unset ho jaaye toh koi bhi website auth calls kar sakti thi → JWT phishing
// risk (phishing subdomain ne user ka signature capture kar liya, JWT le liya,
// same-origin JS se localStorage read kar liya). Ab env missing → CORS header
// hi nahi lagta → browser same-origin ke alawa sab cross-origin calls block
// kar dega. Deployment mein ALLOWED_ORIGIN=https://playarcadex.in set hona
// chahiye.
function cors(res) {
  const allowed = process.env.ALLOWED_ORIGIN;
  if (allowed) res.setHeader("Access-Control-Allow-Origin", allowed);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // JWT secret required — fail fast instead of silently issuing bad tokens
  if (!process.env.JWT_SECRET)
    return res.status(503).json({ error: "Auth not configured" });

  try {
    const { address, signature, message } = req.body;
    if (!address || !signature || !message) {
      return res.status(400).json({ error: "Missing fields" });
    }

    // Address format validation — reject anything that's not a real EOA
    // format. ethers.verifyMessage() would eventually mismatch on garbage
    // input but this fails faster and doesn't waste an ECDSA recovery.
    if (!ethers.isAddress(address))
      return res.status(400).json({ error: "Invalid address format" });

    // Timestamp check — 5-min window prevents old-signature replay past
    // that horizon. Nonce-based (SIWE) would be even better but this file
    // stays stateless for now; the 5-min ceiling caps damage.
    const tsMatch = message.match(/(\d+)$/);
    if (!tsMatch) return res.status(400).json({ error: "Invalid message" });
    const msgAge = Date.now() - parseInt(tsMatch[1]);
    if (msgAge > 5 * 60 * 1000) {
      return res.status(400).json({ error: "Message expired — please reconnect" });
    }
    // Reject far-future timestamps too (client clock skew or crafted replay)
    if (msgAge < -60 * 1000) {
      return res.status(400).json({ error: "Message timestamp is in the future" });
    }

    // Signature verify — try standard personal_sign first, then explicit
    // hash-recover fallback (some wallets like Coinbase/WalletConnect emit
    // slightly different prefix formats that ethers.verifyMessage misses).
    let recovered = null;
    try {
      recovered = ethers.verifyMessage(message, signature);
    } catch (_) { /* fall through to explicit recovery */ }

    if (!recovered || recovered.toLowerCase() !== address.toLowerCase()) {
      try {
        const msgHash = ethers.hashMessage(message);
        recovered = ethers.recoverAddress(msgHash, signature);
      } catch (_) { /* both attempts failed */ }
    }

    if (!recovered || recovered.toLowerCase() !== address.toLowerCase()) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    // JWT — 24hr valid, address always lowercased so downstream comparisons
    // don't need to case-normalize.
    const token = jwt.sign(
      { address: address.toLowerCase() },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );

    return res.status(200).json({ token, address: address.toLowerCase() });
  } catch (err) {
    console.error("Auth error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}