import { ethers } from "ethers";
import admin from "firebase-admin";
import dotenv from "dotenv";

// Load .env file automatically
dotenv.config();

if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_PRIVATE_KEY) {
  console.error("❌ ERROR: Missing Firebase environment variables. Ensure your .env file is in this folder.");
  process.exit(1);
}

// ── CONFIGURATION ──
const RPC_URL = process.env.MST_RPC_URL || "https://mariorpc.mstblockchain.com"; 
const PLATFORM_ADDRESS = "0xd9181c86f9E1D5825E47ED80Ae9E76B4dF18c0B8";

// Initialize Firebase
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    // Replace handles newline issues in private keys
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
});
const db = admin.firestore();

const PLATFORM_ABI = [
  "event PlayRecorded(address indexed player, uint256 indexed gameId, uint256 playerReward, uint256 creatorReward)"
];

async function main() {
  console.log("🔍 1. Connecting to MST RPC...");
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const contract = new ethers.Contract(PLATFORM_ADDRESS, PLATFORM_ABI, provider);

  console.log("📊 2. Fetching all PlayRecorded events from Block 0...");
  const playLogs = await contract.queryFilter(contract.filters.PlayRecorded(), 0, "latest");
  console.log(`   Found ${playLogs.length} total plays on-chain.`);

  console.log("🔥 3. Fetching existing scores from Firebase...");
  const snapshot = await db.collection("scores").where("chain", "==", "mst").get();
  const existingTxHashes = new Set();
  snapshot.docs.forEach(doc => existingTxHashes.add(doc.data().txHash));
  console.log(`   Found ${existingTxHashes.size} plays currently in Firebase.`);

  // Find missing Web3 drop-offs
  const missingLogs = playLogs.filter(log => !existingTxHashes.has(log.transactionHash));
  console.log(`⚠️  Found ${missingLogs.length} missing plays (Web3 drop-offs).`);

  if (missingLogs.length === 0) {
    console.log("✅ Firebase is already 100% synced!");
    return;
  }

  console.log("⏳ 4. Syncing missing plays to Firebase (this will take a few minutes)...");
  
  const blockCache = {};
  let batch = db.batch();
  let count = 0;
  let totalSynced = 0;

  for (const log of missingLogs) {
    const { player, gameId, playerReward } = log.args;
    const txHash = log.transactionHash;

    // Fetch block timestamp so the dashboard charts align correctly
    if (!blockCache[log.blockNumber]) {
      const block = await provider.getBlock(log.blockNumber);
      blockCache[log.blockNumber] = new Date(block.timestamp * 1000);
    }
    const createdAt = blockCache[log.blockNumber];

    const docRef = db.collection("scores").doc(txHash);
    batch.set(docRef, {
      player: player.toLowerCase(),
      score: 1, // Fallback score
      gameId: Number(gameId),
      gameName: "Restored Play", 
      chain: "mst",
      earned: Number(ethers.formatEther(playerReward)),
      earnedSymbol: "MSTC",
      txHash: txHash,
      verified: true,
      createdAt: createdAt
    });

    count++;
    totalSynced++;

    // Commit to Firebase in batches of 400
    if (count >= 400) {
      await batch.commit();
      console.log(`   ...Synced ${totalSynced} / ${missingLogs.length} records`);
      batch = db.batch();
      count = 0;
    }
  }

  if (count > 0) {
    await batch.commit();
  }

  console.log(`\n✅ SUCCESSFULLY SYNCED ${totalSynced} MISSING RECORDS TO FIREBASE!`);
  console.log("🔄 Go refresh your Admin Dashboard now!");
}

main().catch(console.error);