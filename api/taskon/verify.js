// api/taskon/verify.js
//
// Unified TaskOn verification endpoint for ArcadeX.
// Accepts query parameters: ?address=<wallet>&task=<task_name>
// Valid tasks: 'five-scores', 'joined-tournament', 'first-play'

import admin from "firebase-admin";
import { ethers } from "ethers";

// --- FIREBASE SETUP ---
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

// --- CONSTANTS ---
const CAMPAIGN_START = new Date(process.env.CAMPAIGN_START_DATE || "2026-06-28");
const CAMPAIGN_END = new Date(process.env.CAMPAIGN_END_DATE || "2026-07-18");

const TOURNAMENT_ABI = [
  "function nextTournamentId() view returns (uint256)",
  "function playerScores(uint256, address) view returns (uint256 score, bool submitted)",
];

// --- MAIN HANDLER ---
export default async function handler(req, res) {
  try {
    const { address, task } = req.query;
    
    if (!address) {
      return res.status(200).json({ result: { isValid: false, error: "Missing address" } });
    }
    if (!task) {
      return res.status(200).json({ result: { isValid: false, error: "Missing task parameter" } });
    }

    const wallet = address.toLowerCase();

    switch (task) {
      case "five-scores": {
        // Task: Submit 5 gameplay scores during the campaign period
        const db = getDb();
        const snap = await db.collection("scores").where("player", "==", wallet).get();

        const inWindowCount = snap.docs.filter((d) => {
          const createdAt = d.data().createdAt?.toDate?.();
          return createdAt && createdAt >= CAMPAIGN_START && createdAt <= CAMPAIGN_END;
        }).length;

        return res.status(200).json({ result: { isValid: inWindowCount >= 5 } });
      }

      case "joined-tournament": {
        // Task: Join at least 1 ArcadeX tournament
        const provider = new ethers.JsonRpcProvider(process.env.BOTCHAIN_MAINNET_RPC_URL);
        const tournament = new ethers.Contract(
          process.env.VITE_TOURNAMENT_ADDRESS,
          TOURNAMENT_ABI,
          provider
        );

        const nextId = await tournament.nextTournamentId();
        const totalTournaments = Number(nextId) - 1; // IDs are 1-indexed

        if (totalTournaments <= 0) {
          return res.status(200).json({ result: { isValid: false } });
        }

        // Check every tournament for this wallet's "submitted" flag in parallel
        const checks = await Promise.all(
          Array.from({ length: totalTournaments }, (_, i) => i + 1).map(async (id) => {
            try {
              const entry = await tournament.playerScores(id, wallet);
              return entry.submitted;
            } catch {
              return false;
            }
          })
        );

        const joinedAny = checks.some(Boolean);
        return res.status(200).json({ result: { isValid: joinedAny } });
      }

      case "first-play": {
        // Task: Submit your first gameplay score on ArcadeX
        const db = getDb();
        const gamesSnap = await db.collection("games").get();

        let played = false;
        for (const gameDoc of gamesSnap.docs) {
          const playerDoc = await gameDoc.ref.collection("players").doc(wallet).get();
          if (playerDoc.exists) { 
            played = true; 
            break; 
          }
        }

        return res.status(200).json({ result: { isValid: played } });
      }

      default:
        // Task name not recognized
        return res.status(200).json({ result: { isValid: false, error: "Invalid task parameter" } });
    }
  } catch (err) {
    console.error(`taskon/${req.query.task} error:`, err);
    // Always return 200 per TaskOn's spec
    return res.status(200).json({ result: { isValid: false } });
  }
}