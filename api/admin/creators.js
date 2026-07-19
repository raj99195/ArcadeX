// api/admin/creators.js
//
// Lists every creator profile from Firestore for the Admin Panel's
// Creators tab — used alongside the per-creator "Sync to All Chains"
// button (which calls /api/admin/sync-creator-nft for a specific creator).

import jwt from "jsonwebtoken";
import admin from "firebase-admin";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function verifyAdminToken(req) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  try {
    const decoded = jwt.verify(auth.split(" ")[1], process.env.JWT_SECRET);
    const adminAddr = process.env.VITE_ADMIN_ADDRESS?.toLowerCase();
    if (decoded.address?.toLowerCase() !== adminAddr) return null;
    return decoded;
  } catch {
    return null;
  }
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
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const user = verifyAdminToken(req);
  if (!user) return res.status(401).json({ error: "Admin only" });

  try {
    const db = getDb();
    const snap = await db.collection("creators").orderBy("registeredAt", "desc").get();
    const creators = snap.docs.map(d => ({
      address: d.id,
      ...d.data(),
      registeredAt: d.data().registeredAt?.toDate?.() || null,
      joinedAt: d.data().joinedAt?.toDate?.() || null,
    }));
    return res.status(200).json({ creators });
  } catch (err) {
    console.error("admin/creators error:", err);
    return res.status(500).json({ error: err.message });
  }
}
