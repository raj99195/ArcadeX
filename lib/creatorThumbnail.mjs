import { randomUUID } from "node:crypto";

const MAX_BYTES = 3 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");

function imageFormat(bytes) {
  if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return ["image/png", "png"];
  if (bytes.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"))) return ["image/jpeg", "jpg"];
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    return ["image/webp", "webp"];
  }
  return null;
}

export async function uploadCreatorThumbnail(req, res, { verifyToken, rateLimit, getBucket }) {
  const address = verifyToken(req)?.address;
  if (typeof address !== "string" || !/^0x[\da-f]{40}$/i.test(address)) {
    return res.status(401).json({ error: "Reconnect your wallet before uploading a thumbnail." });
  }
  const { base64Data } = req.body || {};
  if (typeof base64Data !== "string" || !base64Data) {
    return res.status(400).json({ error: "Choose a thumbnail image." });
  }
  if (base64Data.length > 4 * Math.ceil(MAX_BYTES / 3)) {
    return res.status(413).json({ error: "Thumbnail must be 3 MB or smaller." });
  }
  const bytes = Buffer.from(base64Data, "base64");
  if (bytes.toString("base64") !== base64Data) {
    return res.status(400).json({ error: "Invalid image data." });
  }
  const format = imageFormat(bytes);
  if (!format) return res.status(415).json({ error: "Use a PNG, JPG, or WebP image." });

  const owner = address.toLowerCase();
  if (!rateLimit(`creator-thumbnail:${owner}`, 10, 60_000)) {
    return res.status(429).json({ error: "Too many uploads. Try again in a minute." });
  }
  const [contentType, extension] = format;
  const path = `creatorGameThumbnails/${owner}/${randomUUID()}.${extension}`;
  const token = randomUUID();
  try {
    const bucket = getBucket();
    await bucket.file(path).save(bytes, {
      resumable: false,
      metadata: {
        contentType,
        cacheControl: "public, max-age=31536000, immutable",
        metadata: { firebaseStorageDownloadTokens: token },
      },
    });
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
    return res.status(200).json({ url });
  } catch (error) {
    console.error("[creator-thumbnail]", error.code || error.message);
    return res.status(502).json({ error: "Could not save the thumbnail. Try again." });
  }
}

export function creatorThumbnailBucket(admin) {
  const name = process.env.FIREBASE_STORAGE_BUCKET ||
    process.env.VITE_FIREBASE_STORAGE_BUCKET ||
    `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app`;
  return admin.storage().bucket(name);
}
