// api/taskon/first-play.js
//
// TaskOn verification endpoint — "Submit your first gameplay score on
// ArcadeX" task. TaskOn calls this with ?address=<wallet> and expects
// { "result": { "isValid": true|false } }, always HTTP 200.
//
// Eligible the moment a wallet appears in ANY game's players subcollection
// (set by /api/games?action=play, which only fires after a successful
// on-chain recordPlayAndEarn — see GamePlay.jsx).

import admin from "firebase-admin";

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
  // Per TaskOn's spec: always return 200, even on internal errors — the
  // *body*'s isValid is what signals completion, not the HTTP status.
  try {
    const { address } = req.query;
    if (!address) {
      return res.status(200).json({ result: { isValid: false } });
    }
    const wallet = address.toLowerCase();

    const db = getDb();
    const gamesSnap = await db.collection("games").get();

    let played = false;
    for (const gameDoc of gamesSnap.docs) {
      const playerDoc = await gameDoc.ref.collection("players").doc(wallet).get();
      if (playerDoc.exists) { played = true; break; }
    }

    return res.status(200).json({ result: { isValid: played } });
  } catch (err) {
    console.error("taskon/first-play error:", err);
    return res.status(200).json({ result: { isValid: false } });
  }
}
