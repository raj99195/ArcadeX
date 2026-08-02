// api/campaign.js
// Vercel serverless function — mirrors server.js campaign routes

import admin from "firebase-admin";
import { ethers } from "ethers";
import jwt from "jsonwebtoken";

// ── Firebase ────────────────────────────────────────────────────
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

// ── Constants ───────────────────────────────────────────────────
// ── Constants (from chains.js + deployedAddresses.json) ─────────
// ── Constants ───────────────────────────────────────────────────
// Values from deployedAddresses.json (BOTChain). Pehle PLATFORM_ADDRESS
// galat tha (0xB784...) jisse verify-transaction hamesha fail hota tha —
// actual BOTChain platform 0x2Ca0... hai. Env override bhi allowed hai
// taaki redeploy pe sirf env badalna pade, code nahi.
const BOTCHAIN_RPC       = process.env.BOTCHAIN_RPC_URL || "https://rpc.botchain.ai";
const PLATFORM_ADDRESS   = process.env.BOTCHAIN_PLATFORM_ADDRESS   || "0x2Ca0C74C1ee7e65e5f96c469cef840B62Ba6cFB4";
const TOURNAMENT_ADDRESS = process.env.BOTCHAIN_TOURNAMENT_ADDRESS || "0xdeB296E39c770475EBC771a2D8B3Dc51a8268Ec8";

const PLATFORM_ABI = [
  "function recordPlayAndEarn(uint256 gameId, uint256 score) external",
];

// ── Admin address (matches VITE_ADMIN_ADDRESS used across all admin files) ──
const ADMIN_ADDR = process.env.VITE_ADMIN_ADDRESS?.toLowerCase() || null;

// ── Auth helpers ────────────────────────────────────────────────
// JWT se caller ka address nikaalo (games.js jaisa hi arcadex_jwt use karta hai)
function getAuthAddress(req) {
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded.address?.toLowerCase() || null;
  } catch { return null; }
}

// Admin hai? — JWT valid + address VITE_ADMIN_ADDRESS se match
function isAdmin(req) {
  const addr = getAuthAddress(req);
  return addr && ADMIN_ADDR && addr === ADMIN_ADDR;
}

// Wallet ownership proof — user ne is wallet se sign kiya?
// Frontend bheje: { wallet, signature, timestamp }
// message = `ArcadeX campaign: ${wallet} @ ${timestamp}`
// signature 5 min ke andar valid.
function verifyWalletOwnership(body) {
  const { wallet, signature, timestamp } = body || {};
  if (!wallet || !signature || !timestamp) return false;
  // Replay window — 5 min
  if (Math.abs(Date.now() - Number(timestamp)) > 5 * 60 * 1000) return false;
  try {
    const message = `ArcadeX campaign: ${wallet.toLowerCase()} @ ${timestamp}`;
    const recovered = ethers.verifyMessage(message, signature);
    return recovered.toLowerCase() === wallet.toLowerCase();
  } catch { return false; }
}

// ── CORS helper ─────────────────────────────────────────────────
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

// ── Main handler ────────────────────────────────────────────────
export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const action = req.query.action;

  try {
    switch (action) {

      // ── GET stats ──────────────────────────────────────────────
      case "stats": {
        const db = getDb();
        const snap = await db.collection("campaign_participants").get();
        const users = snap.docs.map((d) => d.data());

        return res.json({
          participants: users.length,
          gamesPlayed: users.filter((u) => u.gamePlayed).length,
          verifiedUsers: users.filter((u) => u.verificationStatus === "verified").length,
        });
      }

      // ── GET tasks ──────────────────────────────────────────────
      case "tasks": {
        const wallet = req.query.wallet?.toLowerCase();
        if (!wallet) return res.json({ tasks: [] });

        const db = getDb();
        const doc = await db.collection("campaign_participants").doc(wallet).get();
        const data = doc.exists ? doc.data() : {};

        const tasks = [
          { id: "connect_wallet",   status: "completed" },
          { id: "follow_arcadex_x", status: data.twitter  ? "completed" : "pending" },
          { id: "follow_botchain_x",status: data.twitter  ? "completed" : "pending" },
          { id: "join_arcadex_tg",  status: data.telegram ? "completed" : "pending" },
          { id: "join_botchain_tg", status: data.telegram ? "completed" : "pending" },
          { id: "join_discord",     status: data.discord  ? "completed" : "pending" },
          { id: "play_games",       status: data.gamePlayed ? "completed" : "pending" },
          { id: "submit_tx",        status: data.verificationStatus === "verified" ? "completed" : "pending" },
        ];

        return res.json({ walletAddress: wallet, tasks });
      }

      // ── POST verify-social (ownership required) ───────────────
      case "verify-social": {
        const { wallet, taskId, username, field } = req.body;
        if (!wallet || !username || !field)
          return res.status(400).json({ error: "Missing fields" });

        // Ownership — caller apni hi wallet ka data likh sakta hai
        const callerAddr = getAuthAddress(req);
        if (!callerAddr || callerAddr !== wallet.toLowerCase())
          return res.status(403).json({ error: "Forbidden — wallet ownership required" });

        // Field allowlist — arbitrary field write mat hone do
        const ALLOWED_FIELDS = ["twitter", "telegram", "discord"];
        if (!ALLOWED_FIELDS.includes(field))
          return res.status(400).json({ error: "Invalid field" });

        const db = getDb();
        await db.collection("campaign_participants").doc(wallet.toLowerCase()).set(
          { [field]: username, updatedAt: new Date().toISOString() },
          { merge: true }
        );
        return res.json({ success: true });
      }

      // ── POST submit-transaction (ownership required) ──────────
      case "submit-transaction": {
        const { wallet, txHash } = req.body;
        if (!wallet || !txHash)
          return res.status(400).json({ error: "Missing wallet or txHash" });

        const callerAddr = getAuthAddress(req);
        if (!callerAddr || callerAddr !== wallet.toLowerCase())
          return res.status(403).json({ error: "Forbidden — wallet ownership required" });

        const db = getDb();
        await db.collection("campaign_participants").doc(wallet.toLowerCase()).set(
          { txHash, updatedAt: new Date().toISOString() },
          { merge: true }
        );
        return res.json({ success: true });
      }

      // ── POST verify-transaction (ownership required) ──────────
      case "verify-transaction": {
        const { wallet, txHash } = req.body;
        if (!wallet || !txHash)
          return res.status(400).json({ error: "Missing fields" });

        const callerAddr = getAuthAddress(req);
        if (!callerAddr || callerAddr !== wallet.toLowerCase())
          return res.status(403).json({ error: "Forbidden — wallet ownership required" });

        try {
          const provider = new ethers.JsonRpcProvider(BOTCHAIN_RPC);
          const tx = await provider.getTransaction(txHash);
          const receipt = await provider.getTransactionReceipt(txHash);

          if (!tx || !receipt)
            return res.json({ verified: false, reason: "Transaction not found on BOTChain." });

          // Must be from this wallet
          if (tx.from.toLowerCase() !== wallet.toLowerCase())
            return res.json({ verified: false, reason: "Transaction not from your wallet." });

          // Must be to Platform contract
          if (tx.to?.toLowerCase() !== PLATFORM_ADDRESS?.toLowerCase())
            return res.json({ verified: false, reason: "Transaction not to ArcadeX Platform contract." });

          // Must be successful
          if (receipt.status !== 1)
            return res.json({ verified: false, reason: "Transaction failed on-chain." });

          // Must call recordPlayAndEarn
          const iface = new ethers.Interface(PLATFORM_ABI);
          let isPlayAndEarn = false;
          try {
            iface.parseTransaction({ data: tx.data });
            isPlayAndEarn = true;
          } catch {
            isPlayAndEarn = false;
          }

          if (!isPlayAndEarn)
            return res.json({ verified: false, reason: "Transaction is not a game score submission." });

          // All checks passed → mark verified
          const db = getDb();
          await db.collection("campaign_participants").doc(wallet.toLowerCase()).set(
            {
              txHash,
              gamePlayed: true,
              verificationStatus: "verified",
              rewardStatus: "eligible",
              verifiedAt: new Date().toISOString(),
            },
            { merge: true }
          );

          return res.json({ verified: true });

        } catch (err) {
          console.error("verify-transaction error:", err);
          return res.json({ verified: false, reason: "Chain verification failed. Try again." });
        }
      }

      // ── GET dashboard (SH0015: IDOR fix) ──────────────────────
      // Progress data non-sensitive hai (task completion %), lekin txHash
      // sensitive hai. txHash sirf tabhi full dikhega jab caller wallet ka
      // owner ho (JWT address match). Warna masked.
      case "dashboard": {
        const wallet = req.query.wallet?.toLowerCase();
        if (!wallet) return res.status(400).json({ error: "Missing wallet" });

        const db = getDb();
        const doc = await db.collection("campaign_participants").doc(wallet).get();
        const data = doc.exists ? doc.data() : {};

        const totalTasks = 8;
        const completed = [
          true, // wallet always connected
          !!data.twitter,
          !!data.twitter,
          !!data.telegram,
          !!data.telegram,
          !!data.discord,
          !!data.gamePlayed,
          data.verificationStatus === "verified",
        ].filter(Boolean).length;

        // Ownership check — caller apna hi dashboard dekh raha hai?
        const callerAddr = getAuthAddress(req);
        const isOwner = callerAddr && callerAddr === wallet;

        const rawTx = data.txHash || "";
        const maskedTx = rawTx ? rawTx.slice(0, 6) + "…" + rawTx.slice(-4) : "—";

        return res.json({
          completedTasks: completed,
          totalTasks,
          progressPct: Math.round((completed / totalTasks) * 100),
          gamesPlayed: data.gamePlayed ? 1 : 0,
          txHash: isOwner ? (rawTx || "—") : maskedTx,  // full sirf owner ko
          verificationStatus: data.verificationStatus || "pending",
          rewardStatus: data.rewardStatus || "pending",
        });
      }

      // ── GET leaderboard ───────────────────────────────────────
      case "leaderboard": {
        const db = getDb();
        const snap = await db.collection("campaign_participants")
          .where("verificationStatus", "==", "verified")
          .get();

        const entries = snap.docs.map((d, i) => {
          const data = d.data();
          const points =
            (data.twitter  ? 10 : 0) +
            (data.telegram ? 10 : 0) +
            (data.discord  ? 10 : 0) +
            (data.gamePlayed ? 40 : 0) +
            (data.verificationStatus === "verified" ? 30 : 0);
          return {
            rank: i + 1,
            wallet: d.id.slice(0, 6) + "..." + d.id.slice(-4),
            points,
            gamesPlayed: data.gamePlayed ? 1 : 0,
            status: data.verificationStatus || "pending",
          };
        }).sort((a, b) => b.points - a.points).map((e, i) => ({ ...e, rank: i + 1 }));

        return res.json({ entries });
      }

      // ── GET admin (SH0014: admin-only) ────────────────────────
      case "admin": {
        if (!isAdmin(req))
          return res.status(403).json({ error: "Forbidden — admin access required" });

        const db = getDb();
        const snap = await db.collection("campaign_participants").get();
        const users = snap.docs.map((d) => ({ wallet: d.id, ...d.data() }));

        const stats = {
          totalUsers: users.length,
          completed: users.filter((u) => u.verificationStatus === "verified").length,
          pending: users.filter((u) => !u.verificationStatus || u.verificationStatus === "pending").length,
          rejected: users.filter((u) => u.verificationStatus === "rejected").length,
          rewardsBOT: users.filter((u) => u.rewardStatus === "eligible").length * 20,
        };

        return res.json({ stats, users });
      }

      // ── POST approve (admin-only — reward eligibility) ────────
      case "approve": {
        if (!isAdmin(req))
          return res.status(403).json({ error: "Forbidden — admin access required" });
        const { wallet } = req.body;
        if (!wallet) return res.status(400).json({ error: "Missing wallet" });
        const db = getDb();
        await db.collection("campaign_participants").doc(wallet.toLowerCase()).set(
          { verificationStatus: "verified", rewardStatus: "eligible" },
          { merge: true }
        );
        return res.json({ success: true });
      }

      // ── POST reject (admin-only) ──────────────────────────────
      case "reject": {
        if (!isAdmin(req))
          return res.status(403).json({ error: "Forbidden — admin access required" });
        const { wallet, reason } = req.body;
        if (!wallet) return res.status(400).json({ error: "Missing wallet" });
        const db = getDb();
        await db.collection("campaign_participants").doc(wallet.toLowerCase()).set(
          { verificationStatus: "rejected", rejectReason: reason || "" },
          { merge: true }
        );
        return res.json({ success: true });
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error(`campaign/${action} error:`, err);
    return res.status(500).json({ error: "Internal server error" });
  }
}