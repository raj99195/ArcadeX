// api/campaign.js
// Vercel serverless function — mirrors server.js campaign routes

import admin from "firebase-admin";
import { ethers } from "ethers";

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
const BOTCHAIN_RPC = "https://rpc.botchain.ai";
const PLATFORM_ADDRESS = "0xB784bECdD891b629979B342F27F3CF95B0C096BC";
const TOURNAMENT_ADDRESS = "0x27e8e13F8Dd4858Ffd34Ea4aCCa18463B0D032D4";

const PLATFORM_ABI = [
  "function recordPlayAndEarn(uint256 gameId, uint256 score) external",
];

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

      // ── POST verify-social ────────────────────────────────────
      case "verify-social": {
        const { wallet, taskId, username, field } = req.body;
        if (!wallet || !username || !field)
          return res.status(400).json({ error: "Missing fields" });

        const db = getDb();
        await db.collection("campaign_participants").doc(wallet.toLowerCase()).set(
          { [field]: username, updatedAt: new Date().toISOString() },
          { merge: true }
        );
        return res.json({ success: true });
      }

      // ── POST submit-transaction ───────────────────────────────
      case "submit-transaction": {
        const { wallet, txHash } = req.body;
        if (!wallet || !txHash)
          return res.status(400).json({ error: "Missing wallet or txHash" });

        const db = getDb();
        await db.collection("campaign_participants").doc(wallet.toLowerCase()).set(
          { txHash, updatedAt: new Date().toISOString() },
          { merge: true }
        );
        return res.json({ success: true });
      }

      // ── POST verify-transaction ───────────────────────────────
      case "verify-transaction": {
        const { wallet, txHash } = req.body;
        if (!wallet || !txHash)
          return res.status(400).json({ error: "Missing fields" });

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

      // ── GET dashboard ─────────────────────────────────────────
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

        return res.json({
          completedTasks: completed,
          totalTasks,
          progressPct: Math.round((completed / totalTasks) * 100),
          gamesPlayed: data.gamePlayed ? 1 : 0,
          txHash: data.txHash || "—",
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

      // ── GET admin ─────────────────────────────────────────────
      case "admin": {
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

      // ── POST approve ──────────────────────────────────────────
      case "approve": {
        const { wallet } = req.body;
        if (!wallet) return res.status(400).json({ error: "Missing wallet" });
        const db = getDb();
        await db.collection("campaign_participants").doc(wallet.toLowerCase()).set(
          { verificationStatus: "verified", rewardStatus: "eligible" },
          { merge: true }
        );
        return res.json({ success: true });
      }

      // ── POST reject ───────────────────────────────────────────
      case "reject": {
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