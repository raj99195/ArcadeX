// api/ai/generate-game.js

import jwt from "jsonwebtoken";
import admin from "firebase-admin";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function verifyToken(req) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  try { return jwt.verify(auth.split(" ")[1], process.env.JWT_SECRET); }
  catch { return null; }
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

// ── Inline SDK so no external CDN needed ─────────────────────────────────────
// This is injected directly into the generated HTML — no network dependency.
const INLINE_SDK = `
<script>
(function(){
  var _gameId=null,_ready=false,_platform=window.parent;
  function _send(type,data){
    if(!_ready&&type!=="SDK_READY")return;
    try{
      _platform.postMessage(Object.assign({},data,{type:type,_sdk:true,gameId:_gameId,sdkVersion:"1.0.1"}),"*");
    }catch(e){}
  }
  window.addEventListener("message",function(e){
    if(!e.data||!e.data._platform)return;
  });
  window.ArcadeSDK={
    init:function(id){_gameId=String(id);_ready=true;_send("SDK_READY",{gameId:_gameId});},
    updateScore:function(s){_send("SCORE_UPDATE",{score:Number(s)});},
    gameOver:function(s){_send("GAME_OVER",{score:Number(s)});},
    isReady:function(){return _ready;},
  };
})();
<\/script>`;

const SYSTEM_PROMPT = `You are an expert HTML5 Canvas game developer. Your job is to generate a COMPLETE, WORKING, PLAYABLE single-file HTML5 game.

══ ABSOLUTE RULES ══
1. Return ONLY raw HTML starting with <!DOCTYPE html> — NO markdown, NO code fences, NO explanation
2. Zero external dependencies — no CDN, no imports, no fetch calls, no images from URLs
3. The HTML will have an ArcadeSDK already available as window.ArcadeSDK — call it as shown below
4. Game MUST work immediately on load — no broken states, no missing variables

══ ARCADEX SDK — call these exactly ══
  ArcadeSDK.init("GAME_001");          // call once on page load (window.onload or DOMContentLoaded)
  ArcadeSDK.updateScore(score);        // call every time score changes
  ArcadeSDK.gameOver(finalScore);      // call when game ends — REQUIRED

══ REQUIRED STRUCTURE ══
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { background:#0a0818; display:flex; align-items:center; justify-content:center; height:100vh; overflow:hidden; }
    canvas { display:block; }
  </style>
</head>
<body>
<canvas id="c"></canvas>
<script>
  // 1. SDK init FIRST
  window.onload = function() {
    ArcadeSDK.init("GAME_001");
    startGame();
  };

  // 2. Canvas setup
  var canvas = document.getElementById("c");
  var ctx = canvas.getContext("2d");
  canvas.width = 480;
  canvas.height = 420;

  // 3. Game state variables
  var score = 0;
  var gameState = "start"; // "start" | "playing" | "over"

  // 4. Game loop using requestAnimationFrame — ALWAYS use this pattern:
  var lastTime = 0;
  function gameLoop(timestamp) {
    var dt = Math.min((timestamp - lastTime) / 1000, 0.05); // delta in seconds, capped
    lastTime = timestamp;
    update(dt);
    draw();
    requestAnimationFrame(gameLoop);
  }

  function update(dt) {
    if (gameState !== "playing") return;
    // ... your game logic here
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (gameState === "start") drawStart();
    else if (gameState === "playing") drawGame();
    else if (gameState === "over") drawOver();
  }

  function drawStart() {
    // Dark background, game title, "Press Space or Tap to Start"
  }

  function drawGame() {
    // Draw all game objects, score in top-left
  }

  function drawOver() {
    // "GAME OVER", final score, "Press Space or Tap to Restart"
  }

  function startGame() {
    score = 0;
    gameState = "playing";
    requestAnimationFrame(gameLoop);
  }

  function endGame() {
    gameState = "over";
    ArcadeSDK.gameOver(score); // REQUIRED
  }

  // Controls: keyboard + touch
  document.addEventListener("keydown", function(e) {
    if (e.code === "Space") {
      e.preventDefault();
      if (gameState === "start" || gameState === "over") startGame();
      else { /* jump / action */ }
    }
  });
  canvas.addEventListener("click", function() {
    if (gameState === "start" || gameState === "over") startGame();
    else { /* jump / action */ }
  });
<\/script>
</body>
</html>

══ GAME QUALITY RULES ══
- Canvas MUST be 480×420 — hardcode these values
- Use requestAnimationFrame with delta-time — never setInterval for game loop
- Draw shapes with ctx — NO images, NO sprite sheets (use colored rectangles, circles, polygons)
- Score must update via ArcadeSDK.updateScore(score) every time it changes
- Start screen: black/dark bg, game title (large white text), genre-appropriate subtitle, "Press SPACE or TAP to start"
- Game Over screen: score display, "Press SPACE or TAP to restart"
- All variables must be declared before use (var, not let/const in loops to avoid closure bugs)
- requestAnimationFrame loop MUST be started in startGame() NOT at top level
- Colors: dark purple/black bg (#0a0818), bright accent colors for objects
- FUN and COMPLETE — has real gameplay, difficulty progression, visual feedback`;

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: "Unauthorized — connect wallet first" });

  const { description, genre, complexity } = req.body;
  if (!description?.trim()) return res.status(400).json({ error: "description required" });

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return res.status(500).json({ error: "GROQ_API_KEY not configured on server" });

  // Rate limit: 5 per creator per day
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const limitRef = db.collection("aiGenerations").doc(`${user.address}_${today}`);
  try {
    const snap = await limitRef.get();
    const count = snap.exists ? (snap.data().count || 0) : 0;
    if (count >= 5) return res.status(429).json({ error: "Daily limit reached (5/day). Try again tomorrow." });
    await limitRef.set({ count: count + 1, address: user.address, date: today }, { merge: true });
  } catch (e) { console.warn("Rate limit check failed:", e.message); }

  const complexityNote = {
    simple:  "Keep it simple and reliable — 1 mechanic done well, bug-free. No power-ups.",
    medium:  "Medium complexity — 2-3 mechanics, one type of power-up or enemy variety.",
    complex: "Complex — multiple enemy types, power-ups, levels or increasing difficulty waves.",
  }[complexity || "simple"];

  const genreHints = {
    arcade:     "Classic arcade style — fixed screen, enemies/objects spawn, player dodges or shoots.",
    runner:     "Side-scrolling — ground at bottom, player jumps over obstacles, coins above ground. Parallax bg with 2 layers.",
    puzzle:     "Grid-based — match, move, or flip items. Clear board to win. Timer pressure.",
    catch:      "Objects fall from top at random x positions. Player moves left-right at bottom to catch good items, avoid bad.",
    platformer: "Platforms at various heights. Player jumps between them. Gravity always pulls down.",
    shooter:    "Player at bottom shoots upward. Enemies move down in patterns. Bullet-based collision.",
    snake:      "Classic snake on grid. Arrow keys to move. Eat food to grow. Hit wall or self = game over.",
  }[genre || "arcade"];

  const userPrompt = `Genre: ${genre || "arcade"}
Genre rules: ${genreHints}
Complexity: ${complexityNote}

Game description: ${description.trim()}

Build this COMPLETE game now. Follow the structure template exactly. Canvas 480x420. ArcadeSDK.init, updateScore, gameOver must all be called correctly.`;

  try {
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${groqKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user",   content: userPrompt },
        ],
        max_tokens: 12000,   // increased from 8000
        temperature: 0.5,    // lowered from 0.7 — more reliable code
      }),
    });

    if (!groqRes.ok) {
      const err = await groqRes.json().catch(() => ({}));
      throw new Error(err.error?.message || `Groq API error ${groqRes.status}`);
    }

    const data = await groqRes.json();
    let code = data.choices?.[0]?.message?.content?.trim() || "";

    // Strip markdown fences if model disobeys
    code = code
      .replace(/^```html\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    if (!code.includes("<!DOCTYPE") && !code.includes("<html")) {
      return res.status(422).json({ error: "Model returned non-HTML. Try a simpler description." });
    }

    // ── Inject inline SDK before </head> so ArcadeSDK is available ──
    // This replaces any CDN sdk script tag too (in case model adds one)
    code = code.replace(/<script[^>]*arcade-sdk[^>]*><\/script>/gi, "");
    code = code.replace("</head>", INLINE_SDK + "\n</head>");

    // Log success
    db.collection("aiGenerationLogs").add({
      address: user.address,
      description: description.trim(),
      genre: genre || "arcade",
      complexity: complexity || "simple",
      timestamp: new Date(),
      success: true,
    }).catch(() => {});

    return res.status(200).json({ success: true, code });

  } catch (err) {
    console.error("Groq error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}