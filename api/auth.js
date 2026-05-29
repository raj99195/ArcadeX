// api/auth.js
import { ethers } from "ethers";
import jwt from "jsonwebtoken";
import { cors } from "./_middleware.js";

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
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { address, signature, message } = req.body;
    if (!address || !signature || !message) {
      return res.status(400).json({ error: "Missing fields" });
    }

    // Timestamp check — 5 min se purana nahi hona chahiye
    const tsMatch = message.match(/(\d+)$/);
    if (!tsMatch) return res.status(400).json({ error: "Invalid message" });
    if (Date.now() - parseInt(tsMatch[1]) > 5 * 60 * 1000) {
      return res.status(400).json({ error: "Message expired" });
    }

    // Signature verify
    const recovered = ethers.verifyMessage(message, signature);
    if (recovered.toLowerCase() !== address.toLowerCase()) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    // JWT banao — 24hr valid
    const token = jwt.sign(
      { address: address.toLowerCase() },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );

    return res.status(200).json({ token, address: address.toLowerCase() });
  } catch (err) {
    console.error("Auth error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
