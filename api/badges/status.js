// api/badges/status.js
//
// Public GET endpoint — given a wallet, returns eligibility for all 5
// campaign badges (Genesis, Pioneer, Legend, Creator, Builder). This is
// what Marketplace.jsx's "Badges" tab calls to decide whether to show
// "Claim Now" or "Locked" on each card. This route only checks
// eligibility — it does NOT sign anything (that's sign-claim.js, called
// separately when the user actually clicks Claim).

import admin from "firebase-admin";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
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

// Campaign window — only activity within this range counts for Creator/Builder.
// Update these to match the actual TaskOn campaign dates once locked in.
const CAMPAIGN_START = new Date(process.env.CAMPAIGN_START_DATE || "2026-06-29");
const CAMPAIGN_END = new Date(process.env.CAMPAIGN_END_DATE || "2026-07-31");

/** Genesis: played 5+ distinct games (all-time, no campaign window needed
 *  since "play 5 games" is a participation bar, not a competitive rank). */
async function checkGenesis(db, wallet) {
  const gamesSnap = await db.collection("games").get();
  let distinctGamesPlayed = 0;
  for (const gameDoc of gamesSnap.docs) {
    const playerDoc = await gameDoc.ref.collection("players").doc(wallet).get();
    if (playerDoc.exists) distinctGamesPlayed++;
    if (distinctGamesPlayed >= 5) break; // short-circuit, no need to keep counting
  }
  return distinctGamesPlayed >= 5;
}

/** Pioneer / Legend: read from the cached leaderboard snapshot
 *  (see api/admin/refresh-badge-leaderboard.js for how it's built). */
async function checkRank(db, wallet, maxRank) {
  const snap = await db.collection("badgeLeaderboard").doc("snapshot").get();
  if (!snap.exists) return false;
  const { rankings } = snap.data();
  const entry = rankings.find((r) => r.wallet === wallet);
  return !!entry && entry.rank <= maxRank;
}

/** Creator: published at least one game with createdAt inside the campaign window. */
async function checkCreator(db, wallet) {
  const snap = await db
    .collection("games")
    .where("creator", "==", wallet)
    .get();
  return snap.docs.some((d) => {
    const createdAt = d.data().createdAt?.toDate?.();
    return createdAt && createdAt >= CAMPAIGN_START && createdAt <= CAMPAIGN_END;
  });
}

/** Builder: top 10 creators by total plays across their games, campaign-period only.
 *  (Computed live here rather than cached — creator count is much smaller
 *  than the full player base, so this stays cheap.) */
async function checkBuilder(db, wallet) {
  const gamesSnap = await db.collection("games").get();
  const creatorPlays = {};

  gamesSnap.docs.forEach((d) => {
    const data = d.data();
    const createdAt = data.createdAt?.toDate?.();
    if (!createdAt || createdAt < CAMPAIGN_START || createdAt > CAMPAIGN_END) return;
    if (!data.creator) return;
    creatorPlays[data.creator] = (creatorPlays[data.creator] || 0) + (data.plays || 0);
  });

  const ranked = Object.entries(creatorPlays)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([creator]) => creator);

  return ranked.includes(wallet);
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { wallet } = req.query;
  if (!wallet) return res.status(400).json({ error: "wallet required" });
  const w = wallet.toLowerCase();

  try {
    const db = getDb();

    const [genesis, pioneer, legend, creator, builder] = await Promise.all([
      checkGenesis(db, w),
      checkRank(db, w, 500),
      checkRank(db, w, 50),
      checkCreator(db, w),
      checkBuilder(db, w),
    ]);

    return res.status(200).json({
      eligibility: { genesis, pioneer, legend, creator, builder },
    });
  } catch (err) {
    console.error("badges/status error:", err);
    return res.status(500).json({ error: err.message });
  }
}
