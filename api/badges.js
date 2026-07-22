// api/badges.js
//
// Unified badges endpoint — merges badges/status.js + badges/sign-claim.js
// into one serverless function to stay within Vercel's 12-function free limit.
//
// GET  /api/badges?action=status&wallet=0x...   → eligibility check (public)
// POST /api/badges?action=sign-claim            → mint signature (JWT required)

import jwt from "jsonwebtoken";
import admin from "firebase-admin";
import { ethers } from "ethers";

// ── CORS ─────────────────────────────────────────────────────────────────
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// ── Auth ──────────────────────────────────────────────────────────────────
function verifyToken(req) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  try { return jwt.verify(auth.split(" ")[1], process.env.JWT_SECRET); }
  catch { return null; }
}

// ── Firebase ──────────────────────────────────────────────────────────────
function getDb() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
    });
  }
  return admin.firestore();
}

// ── Campaign window ───────────────────────────────────────────────────────
const CAMPAIGN_START = new Date(process.env.CAMPAIGN_START_DATE || "2026-06-29");
const CAMPAIGN_END   = new Date(process.env.CAMPAIGN_END_DATE   || "2026-07-31");

const BADGE_TYPE_KEYS = { 1: "genesis", 2: "pioneer", 3: "legend", 4: "creator", 5: "builder" };

// ── Eligibility checks ────────────────────────────────────────────────────
async function checkGenesis(db, wallet) {
  const gamesSnap = await db.collection("games").get();
  let count = 0;
  for (const gameDoc of gamesSnap.docs) {
    const playerDoc = await gameDoc.ref.collection("players").doc(wallet).get();
    if (playerDoc.exists) count++;
    if (count >= 5) break;
  }
  return count >= 5;
}

async function checkRank(db, wallet, maxRank) {
  const snap = await db.collection("badgeLeaderboard").doc("snapshot").get();
  if (!snap.exists) return false;
  const { rankings } = snap.data();
  const entry = rankings.find(r => r.wallet === wallet);
  return !!entry && entry.rank <= maxRank;
}

async function checkCreator(db, wallet) {
  const snap = await db.collection("games").where("creator", "==", wallet).get();
  return snap.docs.some(d => {
    const createdAt = d.data().createdAt?.toDate?.();
    return createdAt && createdAt >= CAMPAIGN_START && createdAt <= CAMPAIGN_END;
  });
}

async function checkBuilder(db, wallet) {
  const gamesSnap = await db.collection("games").get();
  const creatorPlays = {};
  gamesSnap.docs.forEach(d => {
    const data = d.data();
    const createdAt = data.createdAt?.toDate?.();
    if (!createdAt || createdAt < CAMPAIGN_START || createdAt > CAMPAIGN_END) return;
    if (!data.creator) return;
    creatorPlays[data.creator] = (creatorPlays[data.creator] || 0) + (data.plays || 0);
  });
  const ranked = Object.entries(creatorPlays)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([c]) => c);
  return ranked.includes(wallet);
}

async function checkEligibility(db, wallet) {
  const [genesis, pioneer, legend, creator, builder] = await Promise.all([
    checkGenesis(db, wallet),
    checkRank(db, wallet, 500),
    checkRank(db, wallet, 50),
    checkCreator(db, wallet),
    checkBuilder(db, wallet),
  ]);
  return { genesis, pioneer, legend, creator, builder };
}

// ── Main handler ──────────────────────────────────────────────────────────
export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const { action } = req.query;

  // ── GET /api/badges?action=status&wallet=0x... (public) ──
  if (req.method === "GET" && action === "status") {
    const { wallet } = req.query;
    if (!wallet) return res.status(400).json({ error: "wallet required" });
    const w = wallet.toLowerCase();
    try {
      const db = getDb();
      const eligibility = await checkEligibility(db, w);
      return res.status(200).json({ eligibility });
    } catch (err) {
      console.error("badges/status error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST /api/badges?action=sign-claim (JWT required) ──
  if (req.method === "POST" && action === "sign-claim") {
    const user = verifyToken(req);
    if (!user) return res.status(401).json({ error: "Unauthorized — connect wallet" });

    const { badgeTypeId, chainId, contractAddress } = req.body;
    if (!badgeTypeId) return res.status(400).json({ error: "badgeTypeId required" });
    if (!chainId || !contractAddress) return res.status(400).json({ error: "chainId and contractAddress required" });

    const badgeKey = BADGE_TYPE_KEYS[badgeTypeId];
    if (!badgeKey) return res.status(400).json({ error: "Invalid badgeTypeId" });

    const wallet = user.address.toLowerCase();
    try {
      const db = getDb();

      // Re-verify eligibility fresh — never trust client's earlier status call
      const eligibility = await checkEligibility(db, wallet);
      if (!eligibility[badgeKey]) {
        return res.status(403).json({ error: `Not eligible for ${badgeKey} badge yet` });
      }

      const messageHash = ethers.solidityPackedKeccak256(
        ["address", "uint256", "address", "uint256"],
        [wallet, badgeTypeId, contractAddress, Number(chainId)]
      );
      const signerWallet = new ethers.Wallet(process.env.BADGE_SIGNER_PRIVATE_KEY);
      const signature = await signerWallet.signMessage(ethers.getBytes(messageHash));

      return res.status(200).json({ signature });
    } catch (err) {
      console.error("badges/sign-claim error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: "Invalid action. Use ?action=status or ?action=sign-claim" });
}
