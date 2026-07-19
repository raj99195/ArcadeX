// api/admin/sync-marketplace.js
//
// Syncs all marketplace items (avatar styles) to every live chain.
// Run this once when a new chain goes live — it reads the canonical
// AVATAR_STYLES list and calls addItem() on any chain that doesn't
// already have the item (checked via nextItemId count comparison).
//
// Auth: admin only (JWT required, address must match VITE_ADMIN_ADDRESS)

import { ethers } from "ethers";
import jwt from "jsonwebtoken";
import { CHAIN_LIST } from "../../src/config/chains.js";

// ── Item definitions (mirrors scripts/addAvatarStyles.js) ───────────────
// Keep this in sync with addAvatarStyles.js if you add new items.
const E18 = (n) => ethers.parseEther(n);
const SKIN = 3; // ItemType.Skin = 3

const AVATAR_STYLES = [
  { name: "Style: Adventurer",  desc: "Unlock Adventurer avatar style — gamer cartoon look",    price: E18("100"), supply: 0 },
  { name: "Style: Lorelei",     desc: "Unlock Lorelei avatar style — anime-inspired character",  price: E18("100"), supply: 0 },
  { name: "Style: Notionists",  desc: "Unlock Notionists avatar style — minimal line art",       price: E18("300"), supply: 0 },
  { name: "Style: Micah",       desc: "Unlock Micah avatar style — modern illustration",         price: E18("300"), supply: 0 },
  { name: "Style: Rings",       desc: "Unlock Rings avatar style — abstract geometric design",   price: E18("500"), supply: 0 },
  { name: "Style: Shapes",      desc: "Unlock Shapes avatar style — bold abstract art",          price: E18("500"), supply: 0 },
  { name: "Style: Thumbs",      desc: "Unlock Thumbs avatar style — ultra rare character",       price: E18("800"), supply: 0 },
  { name: "Style: Croodles",    desc: "Unlock Croodles avatar style — hand-drawn exclusive",     price: E18("800"), supply: 0 },
];

const MARKETPLACE_ABI = [
  "function addItem(string name, string description, string imageURI, uint8 itemType, uint256 arcadePrice, uint256 botPrice, uint256 totalSupply) external",
  "function nextItemId() external view returns (uint256)",
];

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function verifyAdmin(req) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  try {
    const decoded = jwt.verify(auth.split(" ")[1], process.env.JWT_SECRET);
    const adminAddr = process.env.VITE_ADMIN_ADDRESS?.toLowerCase();
    if (decoded.address?.toLowerCase() !== adminAddr) return null;
    return decoded;
  } catch { return null; }
}

function resolveAdminKey(chainKey) {
  return process.env[`${chainKey.toUpperCase()}_ADMIN_PRIVATE_KEY`] || process.env.PRIVATE_KEY || null;
}

async function syncMarketplaceOnChain(chain) {
  const privateKey = resolveAdminKey(chain.key);
  if (!privateKey) {
    return { chain: chain.name, key: chain.key, status: "skipped", reason: "No admin key (set PRIVATE_KEY in .env)", added: 0 };
  }
  if (!chain.contracts?.marketplace) {
    return { chain: chain.name, key: chain.key, status: "skipped", reason: "Marketplace contract not deployed on this chain yet", added: 0 };
  }

  try {
    const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    const marketplace = new ethers.Contract(chain.contracts.marketplace, MARKETPLACE_ABI, wallet);

    // Check how many items already exist (nextItemId starts at 1, so nextItemId-1 = item count)
    const nextId = await marketplace.nextItemId();
    const existingCount = Number(nextId) - 1;
    const toAdd = AVATAR_STYLES.slice(existingCount); // only add missing items

    if (toAdd.length === 0) {
      return { chain: chain.name, key: chain.key, status: "already_synced", added: 0, total: existingCount };
    }

    const txHashes = [];
    for (const style of toAdd) {
      const tx = await marketplace.addItem(
        style.name, style.desc,
        "",          // imageURI — empty
        SKIN,        // ItemType.Skin = 3
        style.price, // arcadePrice
        0,           // botPrice = 0
        style.supply,// 0 = unlimited
        { gasLimit: 500000 }
      );
      await tx.wait();
      txHashes.push(tx.hash);
    }

    return { chain: chain.name, key: chain.key, status: "synced", added: toAdd.length, total: existingCount + toAdd.length, txHashes };
  } catch (err) {
    return { chain: chain.name, key: chain.key, status: "failed", reason: err.shortMessage || err.reason || err.message, added: 0 };
  }
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = verifyAdmin(req);
  if (!user) return res.status(403).json({ error: "Admin only" });

  try {
    const liveChains = CHAIN_LIST.filter(c => c.status === "live");
    if (liveChains.length === 0) return res.status(500).json({ error: "No live chains configured" });

    const results = await Promise.all(liveChains.map(chain => syncMarketplaceOnChain(chain)));
    const anySucceeded = results.some(r => r.status === "synced" || r.status === "already_synced");

    return res.status(200).json({ success: anySucceeded, results });
  } catch (err) {
    console.error("sync-marketplace error:", err);
    return res.status(500).json({ error: err.message });
  }
}
