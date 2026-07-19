// api/admin/deploy-multichain.js
//
// Multi-chain game approval. Given a gameId, this:
//   1. Loops over every chain in the registry with status "live"
//   2. For each live chain, checks if the game is already registered there
//      - If yes -> calls approveGame(gameId)
//      - If no  -> calls adminRegisterAndApprove(gameId, creator, name, iframeUrl, rewardRate)
//        (this both registers AND activates the game in one tx, used for
//        chains the creator never directly submitted to — e.g. a chain that
//        went live after the game was originally submitted on BOTChain)
//   3. Returns a per-chain result so the Admin UI can show a status table
//
// Admin signing key: uses a single PRIVATE_KEY for every chain by default
// (same deployer wallet you already use for scripts/deploy.js). If you
// later want a dedicated wallet for a specific chain, set
// `${CHAIN_KEY_UPPERCASE}_ADMIN_PRIVATE_KEY` for just that chain and it
// takes priority over the shared PRIVATE_KEY automatically.

import { ethers } from "ethers";
import jwt from "jsonwebtoken";
import admin from "firebase-admin";
import { CHAIN_LIST } from "../../src/config/chains.js";

const PLATFORM_ABI = [
  "function games(uint256) external view returns (uint256 gameId, string name, address creator, string iframeUrl, uint256 rewardRate, uint256 totalPlays, bool isActive)",
  "function approveGame(uint256 gameId) external",
  "function adminRegisterAndApprove(uint256 specificGameId, address creator, string name, string iframeUrl, uint256 rewardRate) external",
];

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function verifyAdminToken(req) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  try {
    const decoded = jwt.verify(auth.split(" ")[1], process.env.JWT_SECRET);
    const adminAddr = process.env.VITE_ADMIN_ADDRESS?.toLowerCase();
    if (decoded.address?.toLowerCase() !== adminAddr) return null;
    return decoded;
  } catch {
    return null;
  }
}

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

/** Per-chain admin key, falling back to the shared PRIVATE_KEY if no
 *  chain-specific override is set — e.g. "somnia" checks
 *  SOMNIA_ADMIN_PRIVATE_KEY first, then falls back to PRIVATE_KEY. */
function resolveAdminKey(chainKey) {
  const override = process.env[`${chainKey.toUpperCase()}_ADMIN_PRIVATE_KEY`];
  return override || process.env.PRIVATE_KEY || null;
}

async function approveOnChain(chain, gameData) {
  const privateKey = resolveAdminKey(chain.key);
  if (!privateKey) {
    return { chain: chain.name, key: chain.key, status: "skipped", reason: "No admin key configured (set PRIVATE_KEY in .env)" };
  }
  if (!chain.contracts?.platform) {
    return { chain: chain.name, key: chain.key, status: "skipped", reason: "Platform contract address not deployed on this chain yet" };
  }

  try {
    const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    const platform = new ethers.Contract(chain.contracts.platform, PLATFORM_ABI, wallet);

    const existing = await platform.games(gameData.gameId);
    const alreadyRegistered = existing.gameId.toString() !== "0";

    let tx;
    if (alreadyRegistered) {
      if (existing.isActive) {
        return { chain: chain.name, key: chain.key, status: "already_live", txHash: null };
      }
      tx = await platform.approveGame(gameData.gameId, { gasLimit: 500000 });
    } else {
      tx = await platform.adminRegisterAndApprove(
        gameData.gameId,
        gameData.creator,
        gameData.name,
        gameData.iframeUrl || "",
        gameData.rewardRate || 50,
        { gasLimit: 3000000 }
      );
    }

    await tx.wait();
    return { chain: chain.name, key: chain.key, status: "live", txHash: tx.hash, mode: alreadyRegistered ? "approved" : "registered_and_approved" };
  } catch (err) {
    return { chain: chain.name, key: chain.key, status: "failed", reason: err.shortMessage || err.reason || err.message };
  }
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = verifyAdminToken(req);
  if (!user) return res.status(401).json({ error: "Admin only" });

  const { gameId } = req.body;
  if (!gameId) return res.status(400).json({ error: "gameId required" });

  try {
    const db = getDb();
    const gameDoc = await db.collection("games").doc(String(gameId)).get();
    if (!gameDoc.exists) return res.status(404).json({ error: "Game not found in database" });

    const data = gameDoc.data();
    const gameData = {
      gameId: data.gameId,
      name: data.name,
      creator: data.creator,
      iframeUrl: data.iframeUrl || "",
      rewardRate: data.rewardRate || 50,
    };

    const liveChains = CHAIN_LIST.filter(c => c.status === "live");
    if (liveChains.length === 0) {
      return res.status(500).json({ error: "No live chains configured in registry" });
    }

    const results = await Promise.all(liveChains.map(chain => approveOnChain(chain, gameData)));

    // Mark approved in Firestore once at least one chain succeeded
    const anySucceeded = results.some(r => r.status === "live" || r.status === "already_live");
    if (anySucceeded) {
      await gameDoc.ref.update({ status: "approved", approvedAt: new Date() });
    }

    return res.status(200).json({ success: anySucceeded, gameId, results });
  } catch (err) {
    console.error("deploy-multichain error:", err);
    return res.status(500).json({ error: err.message });
  }
}