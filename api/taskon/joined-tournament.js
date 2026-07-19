// api/taskon/joined-tournament.js
//
// TaskOn verification endpoint — "Join at least 1 ArcadeX tournament" task.
// There's no Firestore record of tournament joins (only on-chain state in
// Tournament.sol's playerScores mapping), so this reads directly from the
// chain: loops every tournamentId from 1..nextTournamentId-1 and checks
// playerScores(tournamentId, wallet).submitted for each.

import { ethers } from "ethers";

const TOURNAMENT_ABI = [
  "function nextTournamentId() view returns (uint256)",
  "function playerScores(uint256, address) view returns (uint256 score, bool submitted)",
];

export default async function handler(req, res) {
  try {
    const { address } = req.query;
    if (!address) {
      return res.status(200).json({ result: { isValid: false } });
    }
    const wallet = address.toLowerCase();

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
  } catch (err) {
    console.error("taskon/joined-tournament error:", err);
    return res.status(200).json({ result: { isValid: false } });
  }
}
