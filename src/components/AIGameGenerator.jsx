// src/components/AIGameGenerator.jsx
//
// AI Game Generator tab — shown inside Creator Dashboard (/publish).
// Creator describes a game → Groq (llama-3.3-70b) generates complete
// HTML5 game with ArcadeX SDK pre-integrated → preview in iframe →
// copy code or submit directly to ArcadeX review queue.
//
// Props:
//   P          — design tokens (same palette object Creator.jsx uses)
//   onSubmit   — called with { name, code } when creator clicks Submit
//   remaining  — how many generations left today (shown in UI, optional)

import { useState, useRef } from "react";

const GENRES = [
  { value: "arcade",    label: "🕹️ Arcade" },
  { value: "runner",    label: "🏃 Endless Runner" },
  { value: "puzzle",    label: "🧩 Puzzle" },
  { value: "catch",     label: "🎯 Catch Game" },
  { value: "platformer",label: "🍄 Platformer" },
  { value: "shooter",   label: "🚀 Shooter" },
  { value: "snake",     label: "🐍 Snake" },
];

const COMPLEXITY = [
  { value: "simple",  label: "Simple",  sub: "Fast & reliable — recommended" },
  { value: "medium",  label: "Medium",  sub: "Balanced features" },
  { value: "complex", label: "Complex", sub: "More mechanics, may need tweaks" },
];

export default function AIGameGenerator({ P, onSubmit }) {
  const [description, setDescription] = useState("");
  const [genre, setGenre] = useState("arcade");
  const [complexity, setComplexity] = useState("simple");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [generatedCode, setGeneratedCode] = useState("");
  const [gameName, setGameName] = useState("");
  const [copied, setCopied] = useState(false);
  const [remaining, setRemaining] = useState(5);
  const iframeRef = useRef(null);

  const generate = async () => {
    if (!description.trim()) { setError("Game description likhna zaroori hai!"); return; }
    if (remaining <= 0) { setError("Aaj ki limit khatam ho gayi (5/day). Kal try karo."); return; }

    setLoading(true);
    setError("");
    setGeneratedCode("");

    try {
      const token = localStorage.getItem("arcadex_jwt");
      const res = await fetch("/api/ai/generate-game", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ description, genre, complexity }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");

      setGeneratedCode(data.code);
      setRemaining(prev => Math.max(0, prev - 1));

      // Auto-suggest game name from genre + description
      if (!gameName) {
        const words = description.trim().split(" ").slice(0, 3).map(w => w.charAt(0).toUpperCase() + w.slice(1));
        setGameName(words.join(" "));
      }

      // Load into iframe
      setTimeout(() => loadPreview(data.code), 100);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadPreview = (code) => {
    if (!iframeRef.current) return;
    const blob = new Blob([code], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    iframeRef.current.src = url;
  };

  const copyCode = () => {
    if (!generatedCode) return;
    navigator.clipboard.writeText(generatedCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleSubmit = () => {
    if (!generatedCode) return;
    if (!gameName.trim()) { setError("Game ka naam dena zaroori hai submit karne ke liye"); return; }
    if (onSubmit) onSubmit({ name: gameName, code: generatedCode });
  };

  return (
    <div style={{ paddingBottom: 40 }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 22 }}>🤖</span>
          <h2 style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 20, color: "#fff", margin: 0 }}>
            AI Game Generator
          </h2>
          <span style={{ fontSize: 9, padding: "3px 9px", background: "rgba(0,212,255,0.1)", border: "1px solid rgba(0,212,255,0.25)", borderRadius: 10, color: "#00d4ff", fontFamily: P.raj, fontWeight: 700, letterSpacing: "0.5px" }}>
            BETA
          </span>
        </div>
        <p style={{ fontSize: 11, color: "#5533aa", fontFamily: P.raj, margin: 0, lineHeight: 1.6 }}>
          Apne game ka description likho — AI ek complete HTML5 game generate karega jisme ArcadeX SDK already integrated hoga.
          {" "}<span style={{ color: remaining <= 1 ? "#ff4444" : "#FFB700" }}>{remaining}/5 generations aaj bache hain.</span>
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: generatedCode ? "1fr 1fr" : "1fr", gap: 24 }}>

        {/* LEFT — Input panel */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Description */}
          <div style={{ background: P.s1, border: `1px solid ${P.b}`, borderRadius: 10, padding: 16 }}>
            <label style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 11, color: "#c4a0ff", textTransform: "uppercase", letterSpacing: "0.8px", display: "block", marginBottom: 8 }}>
              Game Description *
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="e.g. Objects fall from top, player moves left-right to catch coins and avoid bombs, 60 second countdown timer, speed increases every 10 seconds"
              rows={4}
              style={{
                width: "100%", background: "rgba(0,0,0,0.3)", border: `1px solid ${P.b}`,
                borderRadius: 7, color: "#e5e5e5", fontFamily: P.raj, fontSize: 12, padding: "10px 12px",
                resize: "vertical", outline: "none", lineHeight: 1.6, boxSizing: "border-box",
              }}
              onFocus={e => e.target.style.borderColor = "rgba(123,47,255,0.5)"}
              onBlur={e => e.target.style.borderColor = P.b}
            />
            <div style={{ fontSize: 9, color: "#3a2a5a", fontFamily: P.raj, marginTop: 5 }}>
              {description.length}/300 — jitna detail doge utna better game aayega
            </div>
          </div>

          {/* Genre */}
          <div style={{ background: P.s1, border: `1px solid ${P.b}`, borderRadius: 10, padding: 16 }}>
            <label style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 11, color: "#c4a0ff", textTransform: "uppercase", letterSpacing: "0.8px", display: "block", marginBottom: 10 }}>
              Genre
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
              {GENRES.map(g => (
                <button key={g.value} onClick={() => setGenre(g.value)} style={{
                  padding: "6px 12px", borderRadius: 6, fontSize: 11, fontWeight: 700,
                  fontFamily: P.raj, cursor: "pointer", transition: "all 0.15s",
                  background: genre === g.value ? "rgba(123,47,255,0.25)" : "rgba(0,0,0,0.3)",
                  border: `1px solid ${genre === g.value ? "rgba(123,47,255,0.6)" : P.b}`,
                  color: genre === g.value ? "#c4a0ff" : "#5533aa",
                }}>{g.label}</button>
              ))}
            </div>
          </div>

          {/* Complexity */}
          <div style={{ background: P.s1, border: `1px solid ${P.b}`, borderRadius: 10, padding: 16 }}>
            <label style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 11, color: "#c4a0ff", textTransform: "uppercase", letterSpacing: "0.8px", display: "block", marginBottom: 10 }}>
              Complexity
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              {COMPLEXITY.map(c => (
                <button key={c.value} onClick={() => setComplexity(c.value)} style={{
                  flex: 1, padding: "10px 8px", borderRadius: 7, cursor: "pointer",
                  background: complexity === c.value ? "rgba(123,47,255,0.2)" : "rgba(0,0,0,0.3)",
                  border: `1px solid ${complexity === c.value ? "rgba(123,47,255,0.5)" : P.b}`,
                  transition: "all 0.15s",
                }}>
                  <div style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 11, color: complexity === c.value ? "#c4a0ff" : "#5533aa", marginBottom: 3 }}>{c.label}</div>
                  <div style={{ fontFamily: P.raj, fontSize: 9, color: "#3a2a5a", lineHeight: 1.4 }}>{c.sub}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div style={{ padding: "10px 14px", background: "rgba(255,68,68,0.06)", border: "1px solid rgba(255,68,68,0.2)", borderRadius: 7, fontSize: 11, color: "#ff4444", fontFamily: P.raj }}>
              {error}
            </div>
          )}

          {/* Generate button */}
          <button onClick={generate} disabled={loading || remaining <= 0} style={{
            padding: "13px 0", background: loading ? "rgba(123,47,255,0.2)" : "linear-gradient(135deg,#7B2FFF,#5a1fd4)",
            border: "none", borderRadius: 9, color: loading ? "#5533aa" : "#fff",
            fontSize: 13, fontWeight: 700, cursor: loading || remaining <= 0 ? "not-allowed" : "pointer",
            fontFamily: P.raj, letterSpacing: "0.5px", transition: "all 0.2s",
            opacity: remaining <= 0 ? 0.4 : 1,
          }}>
            {loading ? "🤖 Generating... (5-15 seconds)" : "✨ Generate Game"}
          </button>

          {/* Submit section — shown after generation */}
          {generatedCode && (
            <div style={{ background: P.s1, border: `1px solid rgba(0,255,136,0.15)`, borderRadius: 10, padding: 16 }}>
              <label style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 11, color: "#00FF88", textTransform: "uppercase", letterSpacing: "0.8px", display: "block", marginBottom: 8 }}>
                Submit to ArcadeX
              </label>
              <input
                value={gameName}
                onChange={e => setGameName(e.target.value)}
                placeholder="Game ka naam dalo..."
                style={{
                  width: "100%", background: "rgba(0,0,0,0.3)", border: `1px solid ${P.b}`,
                  borderRadius: 7, color: "#e5e5e5", fontFamily: P.raj, fontSize: 12,
                  padding: "9px 12px", outline: "none", marginBottom: 10, boxSizing: "border-box",
                }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={copyCode} style={{
                  flex: 1, padding: "9px 0", background: "rgba(0,212,255,0.08)", border: "1px solid rgba(0,212,255,0.25)",
                  borderRadius: 7, color: "#00d4ff", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: P.raj,
                }}>
                  {copied ? "✓ Copied!" : "📋 Copy Code"}
                </button>
                <button onClick={handleSubmit} style={{
                  flex: 2, padding: "9px 0", background: "linear-gradient(135deg,#00FF88,#00cc6a)",
                  border: "none", borderRadius: 7, color: "#000", fontSize: 11, fontWeight: 700,
                  cursor: "pointer", fontFamily: P.raj,
                }}>
                  🚀 Submit for Review
                </button>
              </div>
              <div style={{ fontSize: 9, color: "#3a2a5a", fontFamily: P.raj, marginTop: 8, lineHeight: 1.5 }}>
                Submit karne ke baad game Admin review queue mein jayega — approve hone ke baad live ho jayega.
              </div>
            </div>
          )}
        </div>

        {/* RIGHT — Preview panel (only shown after generation) */}
        {generatedCode && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 12, color: "#c4a0ff" }}>Preview</span>
              <div style={{ display: "flex", gap: 7 }}>
                <button onClick={() => loadPreview(generatedCode)} style={{
                  fontSize: 10, padding: "4px 10px", background: "rgba(123,47,255,0.1)",
                  border: `1px solid ${P.b}`, borderRadius: 5, color: "#a67fff", cursor: "pointer", fontFamily: P.raj, fontWeight: 700,
                }}>↺ Reload</button>
                <button onClick={generate} disabled={loading} style={{
                  fontSize: 10, padding: "4px 10px", background: "rgba(0,212,255,0.08)",
                  border: "1px solid rgba(0,212,255,0.2)", borderRadius: 5, color: "#00d4ff", cursor: "pointer", fontFamily: P.raj, fontWeight: 700,
                }}>✨ Regenerate</button>
              </div>
            </div>
            <div style={{ border: `1px solid ${P.b}`, borderRadius: 10, overflow: "hidden", background: "#000", flexShrink: 0 }}>
              <iframe
                ref={iframeRef}
                title="AI Generated Game Preview"
                style={{ width: "100%", height: 440, border: "none", display: "block" }}
                sandbox="allow-scripts allow-same-origin allow-forms"
              />
            </div>
            <div style={{ padding: "8px 12px", background: "rgba(0,255,136,0.05)", border: "1px solid rgba(0,255,136,0.15)", borderRadius: 7, fontSize: 9, color: "#00FF88", fontFamily: P.raj, lineHeight: 1.6 }}>
              ✓ ArcadeX SDK auto-integrated — init(), updateScore(), gameOver() already wired
            </div>
          </div>
        )}
      </div>

      {/* Tips */}
      {!generatedCode && (
        <div style={{ marginTop: 24, background: P.s1, border: `1px solid ${P.b}`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 11, color: "#c4a0ff", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.8px" }}>💡 Best Results Tips</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {[
              ["✅ Catch Game", "Objects fall from top, player catches coins, avoids bombs, 60s timer"],
              ["✅ Snake", "Classic snake, eat food to grow, avoid walls and yourself"],
              ["✅ Memory Match", "Flip cards to find pairs, countdown timer, score per match"],
              ["✅ Endless Runner", "Jump over obstacles, speed increases, collect coins"],
              ["⚠️ Platformer", "Works but may need physics tweaking"],
              ["❌ Tower Defense", "Too complex — avoid for now"],
            ].map(([label, desc]) => (
              <div key={label} style={{ padding: "8px 10px", background: "rgba(0,0,0,0.2)", borderRadius: 6 }}>
                <div style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 10, color: "#a67fff", marginBottom: 3 }}>{label}</div>
                <div style={{ fontFamily: P.raj, fontSize: 9, color: "#5533aa", lineHeight: 1.5 }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
