// api/community.js
import { verifyToken, cors, getDb } from "./_middleware.js";

const ADMIN = process.env.VITE_ADMIN_ADDRESS?.toLowerCase();
const CHANNELS = ["general", "game-talk", "flex", "announcements"];

const rateLimits = new Map();
function rateLimit(address) {
  const now = Date.now();
  const calls = (rateLimits.get(address) || []).filter(t => t > now - 60000);
  if (calls.length >= 5) return false;
  rateLimits.set(address, [...calls, now]);
  return true;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  const db = getDb();

  // ── GET messages (public) ──
  if (req.method === "GET") {
    const { channel } = req.query;
    if (!CHANNELS.includes(channel)) return res.status(400).json({ error: "Invalid channel" });
    try {
      const snap = await db.collection("community").doc(channel)
        .collection("messages").orderBy("createdAt", "asc").limit(100).get();
      return res.status(200).json({
        messages: snap.docs.map(d => ({
          id: d.id, ...d.data(),
          createdAt: d.data().createdAt?.toDate?.() || null
        }))
      });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // Write requires JWT
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  // ── POST send message ──
  if (req.method === "POST") {
    const { channel, text, avatarStyle } = req.body;
    if (!CHANNELS.includes(channel)) return res.status(400).json({ error: "Invalid channel" });
    if (!text?.trim() || text.length > 500) return res.status(400).json({ error: "Invalid message" });
    if (channel === "announcements" && user.address !== ADMIN) {
      return res.status(403).json({ error: "Admin only" });
    }
    if (!rateLimit(user.address)) return res.status(429).json({ error: "Too many messages" });
    try {
      const ref = await db.collection("community").doc(channel).collection("messages").add({
        text: text.trim(), address: user.address,
        avatarStyle: avatarStyle || "bottts",
        isAdmin: user.address === ADMIN,
        createdAt: new Date(),
      });
      return res.status(200).json({ success: true, id: ref.id });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── DELETE message (admin only) ──
  if (req.method === "DELETE") {
    if (user.address !== ADMIN) return res.status(403).json({ error: "Admin only" });
    const { channel, messageId } = req.body;
    try {
      await db.collection("community").doc(channel).collection("messages").doc(messageId).delete();
      return res.status(200).json({ success: true });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
