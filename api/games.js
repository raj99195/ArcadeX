// api/games.js
import jwt from "jsonwebtoken";
import admin from "firebase-admin";
import { ethers } from "ethers";
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
const FV = admin.firestore.FieldValue;
const rateLimits = new Map();
function rateLimit(key, max = 10) {
  const now = Date.now();
  const calls = (rateLimits.get(key) || []).filter(t => t > now - 60000);
  if (calls.length >= max) return false;
  rateLimits.set(key, [...calls, now]);
  return true;
}

// ── Score Signer Config ───────────────────────────────────────────────────────
const PLATFORM_ADDRESSES = {
  botchain: "0x2Ca0C74C1ee7e65e5f96c469cef840B62Ba6cFB4",
  mst:      "0xd9181c86f9E1D5825E47ED80Ae9E76B4dF18c0B8",
};
const CHAIN_IDS = {
  botchain: 677n,
  mst:      4646n,
};
const RPC_URLS = {
  botchain: process.env.BOTCHAIN_RPC_URL,
  mst:      process.env.MST_RPC_URL,
};
// Minimal ABI — sirf PlayRecorded event parse karne ke liye
const PLATFORM_EVENT_ABI = [
  "event PlayRecorded(address indexed player, uint256 indexed gameId, uint256 playerReward, uint256 creatorReward)",
];

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  const { action } = req.query;
  const db = getDb();

  // ── GET stats (public) ──
  if (req.method === "GET" && action === "stats") {
    const { gameId } = req.query;
    if (!gameId) return res.status(400).json({ error: "gameId required" });
    try {
      const gDoc = await db.collection("games").doc(String(gameId)).get();
      const data = gDoc.exists ? gDoc.data() : {};
      const pSnap = await db.collection("games").doc(String(gameId)).collection("players").get();
      const cSnap = await db.collection("games").doc(String(gameId)).collection("comments")
        .orderBy("createdAt", "desc").limit(50).get();
      return res.status(200).json({
        plays: data.plays || 0,
        likes: data.likes || 0,
        uniquePlayers: pSnap.size,
        comments: cSnap.docs.map(d => ({
          id: d.id, ...d.data(),
          createdAt: d.data().createdAt?.toDate?.() || null
        })),
      });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── GET list (public — approved games) ──
  if (req.method === "GET" && action === "list") {
    try {
      const snap = await db.collection("games").where("status", "==", "approved").get();
      const games = snap.docs.map(d => ({ id: d.data().gameId, ...d.data() }));
      return res.status(200).json({ games });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── GET creator-games ──
  if (req.method === "GET" && action === "creator-games") {
    const user = verifyToken(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    try {
      const lowerAddress = user.address.toLowerCase();
      const allGamesSnap = await db.collection("games").get();
      const uniqueDocs = allGamesSnap.docs.filter(d => {
        const creator = d.data().creator;
        return creator && creator.toLowerCase() === lowerAddress;
      });
      const games = uniqueDocs
        .map(d => ({ id: d.data().gameId || d.id, ...d.data() }))
        .sort((a, b) => (b.gameId || 0) - (a.gameId || 0));
      return res.status(200).json({ games });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── GET check-gas-claim (public) ──
  if (req.method === "GET" && action === "check-gas-claim") {
    const { address: claimAddr } = req.query;
    if (!claimAddr) return res.status(400).json({ error: "address required" });
    try {
      const provider = new ethers.JsonRpcProvider(process.env.MST_RPC_URL);
      const faucet   = new ethers.Contract(
        process.env.MST_FAUCET_ADDRESS,
        ["function hasClaimed(address) view returns (bool)"],
        provider
      );
      const claimed = await faucet.hasClaimed(claimAddr);
      return res.status(200).json({ claimed });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── GET scores (public) ──
  if (req.method === "GET" && action === "scores") {
    try {
      const { chain } = req.query;
      const ref = chain ? db.collection("scores").where("chain", "==", chain) : db.collection("scores");
      const snap = await ref.get();
      const scores = snap.docs
        .map(d => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate?.() || null }))
        .sort((a, b) => (b.score || 0) - (a.score || 0));
      return res.status(200).json({ scores });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── POST record-time (SH0008: JWT required) ──
  if (req.method === "POST" && action === "record-time") {
    const rtUser = verifyToken(req);
    if (!rtUser) return res.status(401).json({ error: "Unauthorized" });
    const { gameId, seconds, timestamp, chainId } = req.body;
    if (!gameId || seconds == null) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    // player JWT token se lo — client-supplied player address trust mat karo
    const player = rtUser.address;
    if (!rateLimit(`record-time:${player}`, 60)) {
      return res.status(429).json({ error: "Too many requests" });
    }
    try {
      await db.collection("gameTimes").add({
        gameId, player, seconds,
        chainId: chainId ?? null,
        timestamp: timestamp ?? Date.now(),
        recordedAt: new Date(),
      });
      return res.status(200).json({ success: true });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── POST record-event (SH0008: JWT required) ──
  if (req.method === "POST" && action === "record-event") {
    const reUser = verifyToken(req);
    if (!reUser) return res.status(401).json({ error: "Unauthorized" });
    const { gameId, eventType, value, timestamp, chainId } = req.body;
    if (!gameId || !eventType) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    // player JWT token se lo — client-supplied player address trust mat karo
    const player = reUser.address;
    if (!rateLimit(`record-event:${player}`, 60)) {
      return res.status(429).json({ error: "Too many requests" });
    }
    try {
      await db.collection("gameEvents").add({
        gameId, player, eventType,
        value: value ?? null,
        chainId: chainId ?? null,
        timestamp: timestamp ?? Date.now(),
        recordedAt: new Date(),
      });
      return res.status(200).json({ success: true });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── POST claim-gas (SH0017: JWT + X-account required) ────────────────────
  // Pehle koi bhi wallet address bhej ke claim kar sakta tha — attacker unlimited
  // fresh wallets bana ke faucet drain kar sakta tha. Ab do gates:
  //   1. JWT (wallet ownership) — claim JWT ke address ke liye hi
  //   2. X/Twitter account (Firebase) — one claim per X account
  // Fresh wallets free hain, lekin fresh X accounts mass-generate karna mushkil
  // (phone verify, rate limits) — isliye farming impractical.
  if (req.method === "POST" && action === "claim-gas") {
    const gasUser = verifyToken(req);
    if (!gasUser) return res.status(401).json({ error: "Unauthorized — connect wallet first" });

    // ── X/Twitter account verification (Firebase ID token) ──
    // Frontend Firebase X login karke idToken bhejta hai (body.firebaseToken).
    const { firebaseToken } = req.body;
    if (!firebaseToken)
      return res.status(403).json({ error: "X login required to claim gas" });

    let xUid, xProvider;
    try {
      const decoded = await admin.auth().verifyIdToken(firebaseToken);
      xUid      = decoded.uid;
      xProvider = decoded.firebase?.sign_in_provider || "";
      // Sirf Twitter/X login accept karo (Google se bypass na ho)
      if (!xProvider.includes("twitter"))
        return res.status(403).json({ error: "Must login with X (Twitter) to claim gas" });
    } catch (e) {
      return res.status(403).json({ error: "Invalid or expired X login. Please login again." });
    }

    // claimAddress body se nahi — JWT se (koi doosre ka wallet claim nahi kar sakta)
    const claimAddress = gasUser.address;

    // ── One claim per X account ──
    const xClaimRef = db.collection("faucetXClaims").doc(xUid);
    const xClaimDoc = await xClaimRef.get();
    if (xClaimDoc.exists)
      return res.status(403).json({ error: "This X account has already claimed gas." });

    const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";
    if (!rateLimit(`faucet:${ip}`, 3))
      return res.status(429).json({ error: "Too many requests" });
    if (!rateLimit(`faucet-addr:${claimAddress.toLowerCase()}`, 2))
      return res.status(429).json({ error: "Too many requests for this wallet" });
    try {
      const rpcUrl     = process.env.MST_RPC_URL;
      const pk         = process.env.PRIVATE_KEY;
      const faucetAddr = process.env.MST_FAUCET_ADDRESS;
      if (!rpcUrl || !pk || !faucetAddr)
        return res.status(503).json({ error: "Faucet not configured" });
      const provider    = new ethers.JsonRpcProvider(rpcUrl);
      const adminWallet = new ethers.Wallet(pk, provider);
      const faucetABI = [
        "function claimGas(address payable user) external",
        "function hasClaimed(address) view returns (bool)",
        "function balance() view returns (uint256)",
        "function FAUCET_AMOUNT() view returns (uint256)",
      ];
      const faucet = new ethers.Contract(faucetAddr, faucetABI, adminWallet);
      if (await faucet.hasClaimed(claimAddress))
        return res.status(200).json({ already: true, msg: "Already claimed" });
      const bal = await faucet.balance();
      const amt = await faucet.FAUCET_AMOUNT();
      if (bal < amt)
        return res.status(503).json({ error: "Faucet empty — refill pending" });
      const tx = await faucet.claimGas(claimAddress, { gasLimit: 120_000 });
      await tx.wait();
      // X account ko record karo — ab ye X account dubara claim nahi kar sakta
      await xClaimRef.set({
        xUid, wallet: claimAddress.toLowerCase(),
        txHash: tx.hash, claimedAt: new Date(),
      });
      return res.status(200).json({ success: true, txHash: tx.hash });
    } catch (err) {
      const msg = err.shortMessage || err.message || "Claim failed";
      if (msg.includes("Already claimed")) return res.status(200).json({ already: true });
      if (msg.includes("Faucet empty")) return res.status(503).json({ error: "Faucet empty" });
      return res.status(500).json({ error: msg });
    }
  }

  // ── POST verify-item-price (SH0006: server-side price gate for in-game purchases) ──
  // GamePlay.jsx calls this BEFORE constructing the on-chain tx so the contract
  // receives the price that the backend authorised, not whatever the iframe sent.
  // Returns a short-lived signed price token the frontend embeds in the tx value.
  //
  // Flow:
  //   1. Game iframe sends PURCHASE_SKIN { gameId, skinIndex, price: X }
  //   2. GamePlay.jsx calls /api/games?action=verify-item-price (JWT required)
  //   3. Backend looks up the canonical price in Firestore (games/{gameId}/items/{itemKey})
  //   4. Returns { canonicalPrice, approved: true/false }
  //   5. GamePlay.jsx uses canonicalPrice for the tx — ignores iframe-supplied price
  if (req.method === "POST" && action === "verify-item-price") {
    const vpUser = verifyToken(req);
    if (!vpUser) return res.status(401).json({ error: "Unauthorized" });
    const { gameId, itemType, itemKey } = req.body;
    // itemType: "skin" | "powerup"  |  itemKey: skinIndex or powerUpId
    if (!gameId || !itemType || itemKey == null) {
      return res.status(400).json({ error: "gameId, itemType, itemKey required" });
    }
    try {
      const itemDoc = await db
        .collection("games").doc(String(gameId))
        .collection("items").doc(`${itemType}_${itemKey}`)
        .get();
      if (!itemDoc.exists) {
        // Item not registered in DB — deny purchase
        return res.status(404).json({ error: "Item not found", approved: false });
      }
      const { price, active } = itemDoc.data();
      if (!active) return res.status(403).json({ error: "Item not available", approved: false });
      return res.status(200).json({ canonicalPrice: price, approved: true });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── POST start-session (SH0009: JWT required) ────────────────────────────────
  // Game open hone pe GamePlay.jsx call karta hai.
  // Ek one-time sessionToken generate hota hai — sign-score tabhi milega jab yeh token ho.
  if (req.method === "POST" && action === "start-session") {
    const ssUser = verifyToken(req);
    if (!ssUser) return res.status(401).json({ error: "Unauthorized" });
    const { gameId, chain } = req.body;
    if (!gameId || !chain) return res.status(400).json({ error: "gameId and chain required" });
    if (!rateLimit(`session:${ssUser.address}:${gameId}`, 10))
      return res.status(429).json({ error: "Too many session requests" });
    try {
      const { randomUUID } = await import("crypto");
      const sessionToken = randomUUID();
      await db.collection("gameSessions").add({
        sessionToken,
        player:    ssUser.address.toLowerCase(),
        gameId:    String(gameId),
        chain,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        used:      false,
      });
      return res.status(200).json({ sessionToken });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── POST sign-score (SH0009: JWT + sessionToken required) ───────────────────
  // Bina valid gameplay session ke sign nahi milega — no fallback.
  if (req.method === "POST" && action === "sign-score") {
    const signUser = verifyToken(req);
    if (!signUser) return res.status(401).json({ error: "Unauthorized" });

    const { gameId, score, chain, sessionToken } = req.body;
    if (!gameId || score == null || !chain || !sessionToken)
      return res.status(400).json({ error: "gameId, score, chain, sessionToken required" });

    // ── LAYER 3 — soft-ban: 3+ flagged submissions → sign-score refuse ──
    const flagCount = (await db.collection("flagged")
      .where("player", "==", signUser.address.toLowerCase())
      .limit(3).get()).size;
    if (flagCount >= 3)
      return res.status(403).json({ error: "Account under review due to suspicious activity." });

    const pk = process.env.SCORE_SIGNER_PRIVATE_KEY;
    if (!pk) return res.status(503).json({ error: "Score signing not configured" });

    const platformAddr = PLATFORM_ADDRESSES[chain];
    const chainId      = CHAIN_IDS[chain];
    if (!platformAddr || !chainId)
      return res.status(400).json({ error: `Unknown chain: ${chain}` });

    if (!rateLimit(`sign:${signUser.address.toLowerCase()}:${gameId}`, 30))
      return res.status(429).json({ error: "Too many sign requests" });

    try {
      // Session validate + burn
      const sessSnap = await db.collection("gameSessions")
        .where("sessionToken", "==", sessionToken)
        .where("player",       "==", signUser.address.toLowerCase())
        .where("gameId",       "==", String(gameId))
        .where("used",         "==", false)
        .limit(1)
        .get();

      if (sessSnap.empty)
        return res.status(403).json({ error: "Invalid or expired session. Open the game page and play first." });

      const sessDoc  = sessSnap.docs[0];
      const expiresAt = sessDoc.data().expiresAt?.toDate?.() || new Date(sessDoc.data().expiresAt);
      if (expiresAt < new Date())
        return res.status(403).json({ error: "Session expired. Reload the game page." });

      if (sessDoc.data().chain !== chain)
        return res.status(403).json({ error: "Session chain mismatch." });

      // ═══════════════════════════════════════════════════════════════════════
      // LAYER 1 — Server-authoritative score validation (anti-cheat gates)
      // sign-score ab generic oracle nahi — score pe "sochta" hai before signing.
      // ═══════════════════════════════════════════════════════════════════════
      const scoreNum   = Number(score);
      const createdAt  = sessDoc.data().createdAt?.toDate?.() || new Date(sessDoc.data().createdAt);
      const playSec    = (Date.now() - createdAt.getTime()) / 1000;
      const rate       = playSec > 0 ? scoreNum / playSec : Infinity;

      const flagAndReject = async (reason, extra = {}) => {
        await db.collection("flagged").add({
          player: signUser.address.toLowerCase(),
          gameId: String(gameId),
          score: scoreNum, playSec, rate, chain,
          reason, ...extra, flaggedAt: new Date(),
        });
        return res.status(403).json({ error: reason });
      };

      // GATE 0 — negative / NaN / non-finite score
      if (!Number.isFinite(scoreNum) || scoreNum < 0)
        return await flagAndReject("Invalid score value");

      // GATE 1 — minimum play time (bina khelay instant submit block)
      const MIN_PLAY_SECONDS = 15;
      if (playSec < MIN_PLAY_SECONDS)
        return await flagAndReject("Play time too short — actually play the game", { minPlaySeconds: MIN_PLAY_SECONDS });

      // GATE 2 — absolute impossible-rate ceiling (bootstrap safety net)
      // Koi bhi game realistically 500 pts/sec cross nahi karega.
      const ABSOLUTE_MAX_RATE = 500;
      if (rate > ABSOLUTE_MAX_RATE)
        return await flagAndReject("Impossible score rate", { absoluteMaxRate: ABSOLUTE_MAX_RATE });

      // GATE 3 — self-learning per-game rate (Option B, no manual config)
      // Har game apna normal rate khud seekhta hai. 20+ samples ke baad
      // koi bhi submission jo learned-average se 3x zyada ho → flag.
      const statRef  = db.collection("gameStats").doc(String(gameId));
      const statSnap = await statRef.get();
      const { avgRate = null, count = 0 } = statSnap.exists ? statSnap.data() : {};

      if (count >= 20 && avgRate && rate > avgRate * 3)
        return await flagAndReject("Score anomaly — far above normal for this game", { learnedAvgRate: avgRate });

      // Legit submission → rolling average update (outliers ko average mein mat lo)
      const withinNormal = !avgRate || rate <= avgRate * 3;
      if (withinNormal) {
        const newCount = count + 1;
        const newAvg   = avgRate ? (avgRate * count + rate) / newCount : rate;
        await statRef.set({ avgRate: newAvg, count: newCount, lastUpdated: new Date() }, { merge: true });
      }
      // ═══════════════════════════════════════════════════════════════════════
      // END LAYER 1
      // ═══════════════════════════════════════════════════════════════════════

      // Burn — one-time use
      await sessDoc.ref.update({ used: true, usedAt: new Date() });

      // player JWT se lo — body se nahi (SH0009)
      const player       = signUser.address;
      const signerWallet = new ethers.Wallet(pk);
      const nonce        = BigInt(Date.now());

      const messageHash = ethers.solidityPackedKeccak256(
        ["address", "uint256", "uint256", "uint256", "address", "uint256"],
        [player, BigInt(gameId), BigInt(score), nonce, platformAddr, chainId]
      );

      const signature = await signerWallet.signMessage(ethers.getBytes(messageHash));
      return res.status(200).json({ nonce: nonce.toString(), signature });

    } catch (err) {
      console.error("[sign-score]", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── All writes require JWT ──
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: "Unauthorized — connect wallet" });

  // ── POST play ──
  if (req.method === "POST" && action === "play") {
    const { gameId } = req.body;
    if (!rateLimit(`play:${user.address}`, 30)) {
      return res.status(429).json({ error: "Too many requests" });
    }
    try {
      await db.collection("games").doc(String(gameId)).update({ plays: FV.increment(1) });
      await db.collection("games").doc(String(gameId)).collection("players").doc(user.address).set(
        { address: user.address, lastPlayed: new Date() }, { merge: true }
      );
      return res.status(200).json({ success: true });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── POST like ──
  if (req.method === "POST" && action === "like") {
    const { gameId } = req.body;
    if (!rateLimit(`like:${user.address}:${gameId}`, 2)) {
      return res.status(429).json({ error: "Already liked" });
    }
    try {
      await db.collection("games").doc(String(gameId)).update({ likes: FV.increment(1) });
      return res.status(200).json({ success: true });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── POST comment ──
  if (req.method === "POST" && action === "comment") {
    const { gameId, text } = req.body;
    if (!text || text.length > 200) return res.status(400).json({ error: "Invalid comment" });
    if (!rateLimit(`comment:${user.address}`, 5)) {
      return res.status(429).json({ error: "Too many comments" });
    }
    try {
      await db.collection("games").doc(String(gameId)).collection("comments").add({
        text, player: user.address, createdAt: new Date(),
      });
      return res.status(200).json({ success: true });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── POST score (LAYER 2: on-chain verified before leaderboard) ──
  // Score tabhi save hota hai jab txHash actually blockchain pe exist kare,
  // succeed hui ho, aur us player ke liye PlayRecorded event emit kiya ho.
  // Isse koi bhi fake { txHash, score } bhej ke leaderboard poison nahi kar sakta.
  if (req.method === "POST" && action === "score") {
    const { txHash, score, gameId, gameName, chain, earned, earnedSymbol } = req.body;
    if (!txHash || score == null) return res.status(400).json({ error: "Missing fields" });

    const chainKey = chain || "botchain";
    const rpcUrl   = RPC_URLS[chainKey];
    const platformAddr = PLATFORM_ADDRESSES[chainKey];
    if (!rpcUrl || !platformAddr)
      return res.status(400).json({ error: `Unknown chain: ${chainKey}` });

    try {
      // Idempotency — already recorded? (double-submit safe)
      const existing = await db.collection("scores").doc(txHash).get();
      if (existing.exists) return res.status(200).json({ success: true, cached: true });

      // 1) Tx blockchain pe fetch karo
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const receipt  = await provider.getTransactionReceipt(txHash);
      if (!receipt) return res.status(400).json({ error: "Transaction not found on-chain" });
      if (receipt.status !== 1) return res.status(400).json({ error: "Transaction failed on-chain" });

      // 2) Tx Platform contract ko hi gayi thi?
      if (receipt.to?.toLowerCase() !== platformAddr.toLowerCase())
        return res.status(400).json({ error: "Transaction not to Platform contract" });

      // 3) PlayRecorded event parse karo — player match kare?
      const iface = new ethers.Interface(PLATFORM_EVENT_ABI);
      let matched = null;
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== platformAddr.toLowerCase()) continue;
        try {
          const parsed = iface.parseLog({ topics: log.topics, data: log.data });
          if (parsed?.name === "PlayRecorded" &&
              parsed.args.player.toLowerCase() === user.address.toLowerCase()) {
            matched = parsed;
            break;
          }
        } catch { /* not this event */ }
      }
      if (!matched)
        return res.status(400).json({ error: "No matching PlayRecorded event for this player" });

      // 4) On-chain se hi values lo — body ke score/earned pe trust nahi
      const onChainGameId = matched.args.gameId.toString();
      const onChainReward = Number(ethers.formatEther(matched.args.playerReward));

      await db.collection("scores").doc(txHash).set({
        player:       user.address,
        score:        parseInt(score),          // display score (game se)
        gameId:       parseInt(onChainGameId),   // on-chain verified
        gameName:     gameName || "Unknown",
        chain:        chainKey,
        earned:       onChainReward,             // on-chain verified reward
        earnedSymbol: earnedSymbol || "ARCADE",
        txHash,
        verified:     true,                      // Layer 2 stamp
        createdAt:    new Date(),
      });
      return res.status(200).json({ success: true, verified: true });
    } catch (err) {
      console.error("[score verify]", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST save-game (creator) ──
  if (req.method === "POST" && action === "save-game") {
    const { gameId, name, description, iframeUrl, thumbnailUrl, category, rewardRate, rewardRateNative, txHash } = req.body;
    try {
      const gameRef = db.collection("games").doc(String(gameId));
      const existing = await gameRef.get();
      if (existing.exists) {
        await gameRef.update({
          name, description, iframeUrl,
          thumbnailUrl: thumbnailUrl || existing.data().thumbnailUrl || "",
          category, rewardRate: parseInt(rewardRate) || 50,
          rewardRateNative: rewardRateNative != null ? parseInt(rewardRateNative) : (existing.data().rewardRateNative ?? 1),
          txHash, status: "pending", updatedAt: new Date(),
        });
      } else {
        await gameRef.set({
          gameId, name, description, iframeUrl,
          thumbnailUrl: thumbnailUrl || "",
          category, rewardRate: parseInt(rewardRate) || 50,
          rewardRateNative: rewardRateNative != null ? parseInt(rewardRateNative) : 1,
          creator: user.address, txHash,
          status: "pending", plays: 0, earned: 0,
          createdAt: new Date(),
        });
      }
      return res.status(200).json({ success: true });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── POST update-game (creator) ──
  if (req.method === "POST" && action === "update-game") {
    const { gameId, rewardRate, rewardRateNative, helpContent } = req.body;
    try {
      const gameRef = db.collection("games").doc(String(gameId));
      const game = await gameRef.get();
      if (!game.exists) return res.status(404).json({ error: "Game not found" });
      if (game.data().creator?.toLowerCase() !== user.address?.toLowerCase()) return res.status(403).json({ error: "Not your game" });
      const updates = {};
      if (rewardRate != null) updates.rewardRate = parseInt(rewardRate);
      if (rewardRateNative != null) updates.rewardRateNative = parseInt(rewardRateNative);
      if (helpContent != null) {
        updates.helpContent = {
          objective: (helpContent.objective || "").trim(),
          controls: (helpContent.controls || "").trim(),
          instructions: (helpContent.instructions || "").trim(),
          tips: (helpContent.tips || "").trim(),
          videoUrl: (helpContent.videoUrl || "").trim(),
        };
      }
      if (Object.keys(updates).length === 0) return res.status(400).json({ error: "Nothing to update" });
      await gameRef.update(updates);
      return res.status(200).json({ success: true });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── POST admin-update-reward (admin-only) ──
  if (req.method === "POST" && action === "admin-update-reward") {
    // Admin gate — sirf VITE_ADMIN_ADDRESS wala wallet reward rate badal sake.
    // Warna koi bhi logged-in user kisi bhi game ka reward inflate kar deta.
    const adminAddr = process.env.VITE_ADMIN_ADDRESS?.toLowerCase();
    if (!adminAddr || user.address?.toLowerCase() !== adminAddr)
      return res.status(403).json({ error: "Admin only" });

    const { gameId, rewardRate, rewardRateNative } = req.body;
    if (!gameId) return res.status(400).json({ error: "gameId required" });
    try {
      const updates = { updatedAt: new Date() };
      if (rewardRate != null)       updates.rewardRate       = Number(rewardRate);
      if (rewardRateNative != null) updates.rewardRateNative = Number(rewardRateNative);
      if (Object.keys(updates).length === 1)
        return res.status(400).json({ error: "Nothing to update" });
      await db.collection("games").doc(String(gameId)).update(updates);
      return res.status(200).json({ success: true });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  return res.status(400).json({ error: "Invalid action" });
}