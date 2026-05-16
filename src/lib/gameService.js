import { db } from "./firebase";
import {
  collection, doc, setDoc, getDoc, getDocs,
  query, where, orderBy, serverTimestamp, updateDoc
} from "firebase/firestore";

// Bech32 → Hex converter
export function bech32ToHex(addr) {
  const charset = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  const stripped = addr.slice(addr.indexOf("1") + 1);
  const data = [];
  for (const c of stripped) {
    const idx = charset.indexOf(c);
    if (idx !== -1) data.push(idx);
  }
  const result = [];
  let acc = 0, bits = 0;
  for (const val of data.slice(0, -6)) {
    acc = ((acc << 5) | val) & 0x1fff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      result.push((acc >> bits) & 0xff);
    }
  }
  return "0x" + result.map(b => b.toString(16).padStart(2, "0")).join("");
}

// Game save karo Firebase mein
export async function saveGame({
  gameId, name, description, iframeUrl,
  thumbnailUrl, category, rewardRate,
  creator, txHash
}) {
  const gameRef = doc(db, "games", String(gameId));
  const existing = await getDoc(gameRef);
  if (existing.exists()) {
    throw new Error(`Game ID ${gameId} already exists. Try again.`);
  }
  await setDoc(gameRef, {
    gameId, name, description, iframeUrl,
    thumbnailUrl: thumbnailUrl || "",
    category,
    rewardRate: parseInt(rewardRate) || 50,
    creator, txHash,
    status: "pending",
    plays: 0, earned: 0,
    createdAt: serverTimestamp(),
  });
}

// Creator save/update karo
export async function saveCreator({ address, displayName }) {
  const ref = doc(db, "creators", address);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      address,
      displayName: displayName || "",
      gamesPublished: 0,
      totalEarned: 0,
      joinedAt: serverTimestamp(),
    });
  }
}

// Creator register karo (new)
export async function registerCreator({ address, displayName }) {
  const ref = doc(db, "creators", address);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      address,
      displayName: displayName || "",
      status: "pending",
      gamesPublished: 0,
      totalEarned: 0,
      registeredAt: serverTimestamp(),
      joinedAt: serverTimestamp(),
    });
  }
}

// Creator status check karo + auto-approve
export async function getCreatorStatus(address) {
  const ref = doc(db, "creators", address);
  const snap = await getDoc(ref);

  if (!snap.exists()) return null;

  const data = snap.data();

  // Auto-approve check: 2 hours baad
  if (data.status === "pending" && data.registeredAt) {
    const registeredAt = data.registeredAt.toDate?.() || new Date(data.registeredAt);
    const now = new Date();
    const diffHours = (now - registeredAt) / (1000 * 60 * 60);

    if (diffHours >= 2) {
      await updateDoc(ref, { status: "approved" });
      return { ...data, status: "approved" };
    }
  }

  return { id: snap.id, ...data };
}
export async function getNextGameId() {
  try {
    const res = await fetch(
      `${import.meta.env.VITE_REST_URL}/initia/move/v1/accounts/${import.meta.env.VITE_CONTRACT}/resources`

    );
    const data = await res.json();
    const platform = data.resources?.find(r =>
      r.struct_tag?.includes("::platform::Platform")
    );
    if (platform) {
      const parsed = JSON.parse(platform.move_resource);
      return parseInt(parsed.data.next_game_id);
    }
  } catch (e) {
    console.error("Chain ID fetch failed:", e);
  }
  const snap = await getDocs(collection(db, "games"));
  return snap.size + 1;
}
// Creator ke games fetch karo
export async function getGamesByCreator(creatorAddress) {
  const q = query(
    collection(db, "games"),
    where("creator", "==", creatorAddress)
  );
  const snap = await getDocs(q);
  const games = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return games.sort((a, b) => (b.gameId || 0) - (a.gameId || 0));
}

// Single game fetch karo
export async function getGame(gameId) {
  const snap = await getDoc(doc(db, "games", String(gameId)));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Sabhi games fetch karo (Admin ke liye)
export async function getAllGames() {
  const snap = await getDocs(
    query(collection(db, "games"), orderBy("createdAt", "desc"))
  );
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Pending games fetch karo
export async function getPendingGames() {
  const q = query(
    collection(db, "games"),
    where("status", "==", "pending"),
    orderBy("createdAt", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Game approve karo
export async function approveGameInFirebase(gameId) {
  await updateDoc(doc(db, "games", String(gameId)), {
    status: "approved",
    approvedAt: serverTimestamp(),
  });
}

// Game reject karo
export async function rejectGameInFirebase(gameId) {
  await updateDoc(doc(db, "games", String(gameId)), {
    status: "rejected",
    rejectedAt: serverTimestamp(),
  });
}

// Total games count
export async function getTotalGamesCount() {
  try {
    const REST = import.meta.env.VITE_REST_URL || "https://rest.testnet.initia.xyz";
    const CONTRACT = import.meta.env.VITE_CONTRACT || "0xd1aa08d2de31ca1af55682f4185547f92332bee";
    const res = await fetch(`${REST}/initia/move/v1/accounts/${CONTRACT}/resources`);
    const data = await res.json();
    const platform = data.resources?.find(r => r.struct_tag?.includes("::platform::Platform"));
    if (platform) {
      const parsed = JSON.parse(platform.move_resource);
      return parseInt(parsed.data.next_game_id) - 1;
    }
  } catch (e) {
    console.error("Chain count failed:", e);
  }
  const snap = await getDocs(collection(db, "games"));
  return snap.size;
}

// Score save karo
export async function saveScore({ player, score, gameId, gameName, txHash }) {
  try {
    const scoreRef = doc(db, "scores", txHash);
    await setDoc(scoreRef, {
      player,
      score: parseInt(score),
      gameId: parseInt(gameId),
      gameName: gameName || "Unknown Game",
      txHash,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.error("Score save failed:", err);
  }
}

// Global scores fetch karo
export async function getScores() {
  try {
    const snap = await getDocs(
      query(collection(db, "scores"), orderBy("score", "desc"))
    );
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("Scores fetch failed:", err);
    return [];
  }
}

// Game wise scores fetch karo
export async function getScoresByGame(gameId) {
  try {
    const snap = await getDocs(
      query(
        collection(db, "scores"),
        where("gameId", "==", parseInt(gameId)),
        orderBy("score", "desc")
      )
    );
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("Game scores fetch failed:", err);
    return [];
  }
}