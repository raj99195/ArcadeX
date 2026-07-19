// api/admin/sync-creator-nft.js
//
// Syncs a creator's profile to every live chain via CreatorNFT.adminMintFor().
// Called automatically right after a creator mints on their current chain
// (see Creator.jsx) — no admin action needed. Uses the same admin wallet
// (PRIVATE_KEY) that already holds MINTER_ROLE on CreatorNFT, calling
// adminMintFor() on every OTHER live chain so the creator doesn't have to
// sign a transaction per chain.
//
// Auth: requires a valid JWT. Normal callers can only sync their OWN
// address (the standard post-mint flow). If the caller IS the admin
// wallet, they may additionally pass `targetAddress` to sync on behalf of
// any other creator — used by the Admin Panel's per-creator sync button,
// for creators who minted before a new chain went live.

import { ethers } from "ethers";
import jwt from "jsonwebtoken";
import { CHAIN_LIST } from "../../src/config/chains.js";

const CREATOR_NFT_ABI = [
  "function walletToToken(address) external view returns (uint256)",
  "function adminMintFor(address creator, string username, string avatarColor) external",
];

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function verifyToken(req) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  try {
    const decoded = jwt.verify(auth.split(" ")[1], process.env.JWT_SECRET);
    const adminAddr = process.env.VITE_ADMIN_ADDRESS?.toLowerCase();
    return {
      ...decoded,
      isAdmin: decoded.address?.toLowerCase() === adminAddr,
    };
  } catch {
    return null;
  }
}

function resolveAdminKey(chainKey) {
  const override = process.env[`${chainKey.toUpperCase()}_ADMIN_PRIVATE_KEY`];
  return override || process.env.PRIVATE_KEY || null;
}

async function syncOnChain(chain, creator, username, avatarColor) {
  const privateKey = resolveAdminKey(chain.key);
  if (!privateKey) {
    return { chain: chain.name, key: chain.key, status: "skipped", reason: "No admin key configured (set PRIVATE_KEY in .env)" };
  }
  if (!chain.contracts?.creatorNft) {
    return { chain: chain.name, key: chain.key, status: "skipped", reason: "CreatorNFT not deployed on this chain yet" };
  }

  try {
    const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    const creatorNft = new ethers.Contract(chain.contracts.creatorNft, CREATOR_NFT_ABI, wallet);

    const existingTokenId = await creatorNft.walletToToken(creator);
    if (existingTokenId.toString() !== "0") {
      return { chain: chain.name, key: chain.key, status: "already_minted", txHash: null };
    }

    const tx = await creatorNft.adminMintFor(creator, username, avatarColor, { gasLimit: 5000000 });
    await tx.wait();
    return { chain: chain.name, key: chain.key, status: "minted", txHash: tx.hash };
  } catch (err) {
    return { chain: chain.name, key: chain.key, status: "failed", reason: err.shortMessage || err.reason || err.message };
  }
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: "Unauthorized — connect wallet" });

  const { username, avatarColor, originChainKey, targetAddress } = req.body;
  if (!username || !avatarColor) {
    return res.status(400).json({ error: "username and avatarColor required" });
  }

  // Default: sync your own profile. If a targetAddress is given, only the
  // admin wallet is allowed to use it — anyone else trying to sync someone
  // else's profile gets rejected.
  let creator = user.address;
  if (targetAddress) {
    const adminAddr = process.env.VITE_ADMIN_ADDRESS?.toLowerCase();
    if (user.address?.toLowerCase() !== adminAddr) {
      return res.status(403).json({ error: "Only admin can sync on behalf of another address" });
    }
    creator = targetAddress;
  }

  try {
    const liveChains = CHAIN_LIST.filter(
      c => c.status === "live" && c.key !== originChainKey
    );

    if (liveChains.length === 0) {
      return res.status(200).json({ success: true, results: [], message: "No other live chains to sync to" });
    }

    const results = await Promise.all(
      liveChains.map(chain => syncOnChain(chain, creator, username, avatarColor))
    );

    return res.status(200).json({ success: true, results });
  } catch (err) {
    console.error("sync-creator-nft error:", err);
    return res.status(500).json({ error: err.message });
  }
}