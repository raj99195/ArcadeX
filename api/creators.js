// api/creators.js

import jwt from "jsonwebtoken";
import admin from "firebase-admin";

function verifyToken(req) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  try { return jwt.verify(auth.split(" ")[1], process.env.JWT_SECRET); }
  catch { return null; }
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
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




export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  const db = getDb();

  // ── GET creator (public) ──
  if (req.method === "GET") {
    const { address } = req.query;
    if (!address) return res.status(400).json({ error: "address required" });
    try {
      const snap = await db.collection("creators").doc(address.toLowerCase()).get();
      if (!snap.exists()) {
        // Try original case
        const snap2 = await db.collection("creators").doc(address).get();
        return res.status(200).json(snap2.exists() ? snap2.data() : null);
      }
      return res.status(200).json(snap.data());
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // Write requires JWT
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  // ── POST save creator ──
  if (req.method === "POST") {
    const { displayName, avatarStyle, txHash } = req.body;
    try {
      const ref = db.collection("creators").doc(user.address);
      const snap = await ref.get();
      if (!snap.exists()) {
        await ref.set({
          address: user.address,
          displayName: displayName || "",
          avatarStyle: avatarStyle || "bottts",
          txHash: txHash || "",
          status: "pending",
          gamesPublished: 0,
          totalEarned: 0,
          registeredAt: new Date(),
          joinedAt: new Date(),
        });
      } else {
        await ref.update({
          displayName: displayName || snap.data().displayName,
          avatarStyle: avatarStyle || snap.data().avatarStyle,
          updatedAt: new Date(),
        });
      }
      return res.status(200).json({ success: true });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── GET creator status ──
  if (req.method === "PATCH") {
    try {
      const ref = db.collection("creators").doc(user.address);
      const snap = await ref.get();
      if (!snap.exists()) return res.status(404).json({ error: "Creator not found" });
      const data = snap.data();
      // Auto approve after 2 hours
      if (data.status === "pending" && data.registeredAt) {
        const diff = (Date.now() - data.registeredAt.toDate().getTime()) / (1000 * 60 * 60);
        if (diff >= 2) {
          await ref.update({ status: "approved" });
          return res.status(200).json({ ...data, status: "approved" });
        }
      }
      return res.status(200).json(data);
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
