// scripts/migrateGames.js
// Run: npx hardhat run scripts/migrateGames.js --network mst
//
// Migrates every Firestore-approved game onto whichever Platform contract
// is currently recorded for --network in deployedAddresses.json — same
// source of truth chains.js uses, so there's nothing to keep in sync by hand.
//
// For migrating to a NATIVE TOKEN chain (MST) where the old Firestore
// rewardRate values were set in ARCADE (ERC-20) context and would be far
// too high in native MSTC, set FORCE_REWARD_RATE before running:
//
//   set FORCE_REWARD_RATE=1 && npx hardhat run scripts/migrateGames.js --network mst   (Windows CMD)
//   FORCE_REWARD_RATE=1 npx hardhat run scripts/migrateGames.js --network mst          (bash/Mac/Linux)
//
// IMPORTANT: adminRegisterAndApprove() does NOT call _validateRewardRate()
// on-chain — there is no contract-level safety net here. FORCE_REWARD_RATE
// is the only thing standing between "old ARCADE-context rate" and "real
// MSTC accidentally set to 50/play". Do not skip it when migrating to a
// native-token chain.
require("dotenv").config();
const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

const DEPLOYED_ADDRESSES_PATH = path.join(
  __dirname, "..", "src", "config", "deployedAddresses.json"
);

// Set this when migrating to a native-token chain (e.g. MST) to override
// every game's rate to a safe fixed value, ignoring whatever's stored in
// Firestore. Leave unset for ERC-20 chain migrations (BOTChain/Somnia) —
// those keep using each game's own stored rewardRate as before.
const FORCE_REWARD_RATE = process.env.FORCE_REWARD_RATE
  ? parseInt(process.env.FORCE_REWARD_RATE)
  : null;

const PLATFORM_ABI = [
  "function adminRegisterAndApprove(uint256 specificGameId, address creator, string name, string iframeUrl, uint256 rewardRate) external",
  "function games(uint256) external view returns (uint256 gameId, string name, address creator, string iframeUrl, uint256 rewardRate, uint256 totalPlays, bool isActive)",
  "function nextGameId() external view returns (uint256)",
  "function minRewardRate() external view returns (uint256)",
  "function maxRewardRate() external view returns (uint256)",
];

function getPlatformAddress(chainKey) {
  let allAddresses;
  try {
    allAddresses = JSON.parse(fs.readFileSync(DEPLOYED_ADDRESSES_PATH, "utf8"));
  } catch (err) {
    console.error("❌ deployedAddresses.json not found or unreadable:", err.message);
    return null;
  }
  const chainAddresses = allAddresses[chainKey];
  if (!chainAddresses?.platform) {
    console.error(`❌ No "platform" address for "${chainKey}" in deployedAddresses.json — deploy Platform.sol first (scripts/deployPlatform.js).`);
    return null;
  }
  return chainAddresses.platform;
}

async function fetchGamesFromFirestore() {
  try {
    const admin = require("firebase-admin");
    const serviceAccount = require("./serviceAccountKey.json");
    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }
    const db = admin.firestore();
    const snap = await db.collection("games").where("status", "==", "approved").get();
    const games = snap.docs.map(d => {
      const data = d.data();
      return {
        gameId: data.gameId,
        name: data.name,
        creator: data.creator,
        iframeUrl: data.iframeUrl || "",
        rewardRate: data.rewardRate || 50,
      };
    });
    return games.sort((a, b) => a.gameId - b.gameId);
  } catch (err) {
    if (err.message?.includes("serviceAccountKey")) {
      console.log("\n⚠️  serviceAccountKey.json nahi mila!");
      console.log("Steps:");
      console.log("1. Firebase Console → Project Settings → Service Accounts");
      console.log("2. 'Generate new private key' → JSON download karo");
      console.log("3. File ko rename karke scripts/serviceAccountKey.json pe save karo\n");
    } else if (err.message?.includes("firebase-admin")) {
      console.log("\n⚠️  firebase-admin install karo:");
      console.log("npm install firebase-admin\n");
    } else {
      console.error("Firestore error:", err.message);
    }
    return null;
  }
}

async function main() {
  const chainKey = hre.network.name;
  console.log(`\n🔗 Migrating games on: ${chainKey}`);

  const NEW_PLATFORM_ADDRESS = getPlatformAddress(chainKey);
  if (!NEW_PLATFORM_ADDRESS) return;
  console.log("🔑 Platform Address:", NEW_PLATFORM_ADDRESS, "(from deployedAddresses.json)");

  if (FORCE_REWARD_RATE !== null) {
    console.log(`⚠️  FORCE_REWARD_RATE=${FORCE_REWARD_RATE} set hai — Firestore ka rewardRate IGNORE hoga, sab games isi rate pe migrate honge.`);
  } else {
    console.log("ℹ️  FORCE_REWARD_RATE unset — har game apna Firestore wala rewardRate use karega (ERC-20 chain migration ke liye normal hai).");
  }

  console.log("\n📡 Firestore se games fetch ho rahe hain...");
  const GAMES = await fetchGamesFromFirestore();
  if (!GAMES) return;
  if (GAMES.length === 0) { console.log("❌ Koi approved game nahi mila!"); return; }

  console.log(`\n✅ ${GAMES.length} approved games mile:`);
  GAMES.forEach(g => {
    const rate = FORCE_REWARD_RATE !== null ? FORCE_REWARD_RATE : g.rewardRate;
    console.log(`   #${g.gameId} — ${g.name} | rate → ${rate} | creator: ${g.creator?.slice(0,12)}...`);
  });

  const [admin] = await ethers.getSigners();
  console.log("\n👤 Admin wallet:", admin.address);

  const platform = new ethers.Contract(NEW_PLATFORM_ADDRESS, PLATFORM_ABI, admin);
  const nextId = await platform.nextGameId();

  // Informational only — adminRegisterAndApprove does not enforce these,
  // this is just so you can eyeball whether a rate looks out of range.
  try {
    const min = await platform.minRewardRate();
    const max = await platform.maxRewardRate();
    console.log(`📊 Contract nextGameId: ${nextId} | configured limits: ${min}–${max}\n`);
  } catch {
    console.log(`📊 Contract nextGameId: ${nextId}\n`);
  }

  for (const game of GAMES) {
    const rateToUse = FORCE_REWARD_RATE !== null ? FORCE_REWARD_RATE : game.rewardRate;
    console.log(`\n📋 Game #${game.gameId} — "${game.name}" | rate: ${rateToUse}`);
    try {
      const existing = await platform.games(game.gameId);
      if (existing.isActive) { console.log(`   ✅ Already active — skip`); continue; }

      const tx = await platform.adminRegisterAndApprove(
        game.gameId, game.creator, game.name, game.iframeUrl, rateToUse,
        { gasLimit: 500000 }
      );
      console.log(`   ⏳ TX: ${tx.hash}`);
      await tx.wait();
      console.log(`   ✅ Registered & Approved!`);
    } catch (err) {
      console.error(`   ❌ Failed: ${err.message?.slice(0, 120)}`);
    }
  }

  const finalNextId = await platform.nextGameId();
  console.log(`\n🎮 Migration complete! nextGameId: ${finalNextId}`);
  console.log("✅ Saare games naye contract pe live hain!");
}

main().catch(err => { console.error(err); process.exit(1); });