// api/taskon/five-scores.js
//
// TaskOn verification endpoint — "Submit 5 gameplay scores during the
// campaign period (across different games/days)" task. Checks the
// `scores` collection (written by /api/games?action=score after every
// successful on-chain recordPlayAndEarn) for at least 5 submissions by
// this wallet within the campaign date window.

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

const CAMPAIGN_START = new Date(process.env.CAMPAIGN_START_DATE || "2026-06-28");
const CAMPAIGN_END = new Date(process.env.CAMPAIGN_END_DATE || "2026-07-18");

export default async function handler(req, res) {
  try {
    const { address } = req.query;
    if (!address) {
      return res.status(200).json({ result: { isValid: false } });
    }
    const wallet = address.toLowerCase();

    const db = getDb();
    const snap = await db.collection("scores").where("player", "==", wallet).get();

    const inWindowCount = snap.docs.filter((d) => {
      const createdAt = d.data().createdAt?.toDate?.();
      return createdAt && createdAt >= CAMPAIGN_START && createdAt <= CAMPAIGN_END;
    }).length;

    return res.status(200).json({ result: { isValid: inWindowCount >= 5 } });
  } catch (err) {
    console.error("taskon/five-scores error:", err);
    return res.status(200).json({ result: { isValid: false } });
  }
}
