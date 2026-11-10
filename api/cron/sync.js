// api/cron/sync.js
import admin from "firebase-admin";
import { ethers } from "ethers";

// Firebase initialization (Reusing your existing pattern)
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

export default async function handler(req, res) {
  // 🔒 SECURITY: Vercel automatically sends this header for Cron Jobs.
  // This prevents random people from triggering your sync script.
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const db = getDb();
    const provider = new ethers.JsonRpcProvider(process.env.MST_RPC_URL);
    const PLATFORM_ADDRESS = "0xd9181c86f9E1D5825E47ED80Ae9E76B4dF18c0B8";
    
    // Only fetching PlayRecorded events
    const PLATFORM_ABI = ["event PlayRecorded(address indexed player, uint256 indexed gameId, uint256 playerReward, uint256 creatorReward)"];
    const contract = new ethers.Contract(PLATFORM_ADDRESS, PLATFORM_ABI, provider);

    const currentBlock = await provider.getBlockNumber();
    
    // ⚡ OPTIMIZATION: Only scan the last 10,000 blocks (~last 1-2 days)
    // This keeps the serverless function ultra-fast (runs in ~2 seconds)
    const SCAN_BLOCKS = 10000;
    const fromBlock = currentBlock > SCAN_BLOCKS ? currentBlock - SCAN_BLOCKS : 0;

    console.log(`[Cron Sync] Scanning MST chain from ${fromBlock} to ${currentBlock}...`);
    const playLogs = await contract.queryFilter(contract.filters.PlayRecorded(), fromBlock, currentBlock);

    if (playLogs.length === 0) {
      return res.status(200).json({ message: "No recent plays found on-chain." });
    }

    const recentTxHashes = playLogs.map(log => log.transactionHash);

    // 🔥 Check Firebase to see which of these recent txHashes are already saved
    const existingHashes = new Set();
    
    // Firestore 'in' query supports max 30 items per batch
    for (let i = 0; i < recentTxHashes.length; i += 30) {
        const chunk = recentTxHashes.slice(i, i + 30);
        const snap = await db.collection("scores").where("txHash", "in", chunk).get();
        snap.docs.forEach(doc => existingHashes.add(doc.data().txHash));
    }

    // Filter out the ones that are NOT in Firebase yet (Web3 Drop-offs)
    const missingLogs = playLogs.filter(log => !existingHashes.has(log.transactionHash));

    if (missingLogs.length === 0) {
      return res.status(200).json({ message: "Firebase is fully synced. No drops found." });
    }

    // 💾 Insert missing logs into Firebase
    const batch = db.batch();
    const blockCache = {};

    for (const log of missingLogs) {
      const { player, gameId, playerReward } = log.args;
      const txHash = log.transactionHash;

      // Get exact time of the transaction for accurate charts
      if (!blockCache[log.blockNumber]) {
        const block = await provider.getBlock(log.blockNumber);
        blockCache[log.blockNumber] = new Date(block.timestamp * 1000);
      }
      
      const docRef = db.collection("scores").doc(txHash);
      batch.set(docRef, {
        player: player.toLowerCase(),
        score: 1, // Fallback since actual score isn't on-chain
        gameId: Number(gameId),
        gameName: "Restored Play", // Fallback name
        chain: "mst",
        earned: Number(ethers.formatEther(playerReward)),
        earnedSymbol: "MSTC",
        txHash: txHash,
        verified: true, // Marked as true since it came directly from the chain
        createdAt: blockCache[log.blockNumber]
      });
    }

    await batch.commit();

    return res.status(200).json({
        success: true,
        syncedCount: missingLogs.length,
        message: `Successfully rescued and synced ${missingLogs.length} missing plays.`
    });

  } catch (error) {
    console.error("Cron Sync Error:", error);
    return res.status(500).json({ error: error.message });
  }
}