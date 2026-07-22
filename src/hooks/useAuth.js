// api/auth.js
import { ethers } from "ethers";
import jwt from "jsonwebtoken";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
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

    // Timestamp check — 5 min window
    const tsMatch = message.match(/(\d+)$/);
    if (!tsMatch) return res.status(400).json({ error: "Invalid message format" });
    const msgAge = Date.now() - parseInt(tsMatch[1]);
    if (msgAge > 5 * 60 * 1000) {
      return res.status(400).json({ error: "Message expired — please reconnect" });
    }

    // Signature verify — try both personal_sign formats
    // Some wallets (WalletConnect, Coinbase) may produce different prefix formats
    let recovered = null;
    let verifyError = null;

    try {
      // Standard: ethers personal_sign (\x19Ethereum Signed Message:\n prefix)
      recovered = ethers.verifyMessage(message, signature);
    } catch (e) {
      verifyError = e.message;
    }

    // Agar standard verify fail hua — try with explicit hash
    if (!recovered || recovered.toLowerCase() !== address.toLowerCase()) {
      try {
        const msgHash = ethers.hashMessage(message);
        recovered = ethers.recoverAddress(msgHash, signature);
      } catch (e2) {
        // ignore second attempt error
      }
    }

    if (!recovered || recovered.toLowerCase() !== address.toLowerCase()) {
      console.error("Auth signature mismatch:", {
        expected: address.toLowerCase(),
        recovered: recovered?.toLowerCase() || "null",
        messagePreview: message.slice(0, 50),
        verifyError,
      });
      return res.status(401).json({ error: "Invalid signature" });
    }

    // JWT — 24hr valid
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