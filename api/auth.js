// api/auth.js — Wallet signature verify karo, JWT do
import { ethers } from "ethers";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { address, signature, message } = req.body;
    if (!address || !signature || !message) {
      return res.status(400).json({ error: "Missing fields" });
    }

    // Message mein timestamp check karo — 5 min se purana nahi hona chahiye
    const timestampMatch = message.match(/(\d+)$/);
    if (!timestampMatch) return res.status(400).json({ error: "Invalid message format" });
    const msgTime = parseInt(timestampMatch[1]);
    if (Date.now() - msgTime > 5 * 60 * 1000) {
      return res.status(400).json({ error: "Message expired. Please try again." });
    }

    // Signature verify karo
    const recovered = ethers.verifyMessage(message, signature);
    if (recovered.toLowerCase() !== address.toLowerCase()) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    // JWT token banao — 24hr valid
    const token = jwt.sign(
      { address: address.toLowerCase(), iat: Date.now() },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    return res.status(200).json({ token, address: address.toLowerCase() });
  } catch (err) {
    console.error("Auth error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
