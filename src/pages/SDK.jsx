import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";

const C = {
  bg: "#08070f", surface: "#0e0c1a", surface2: "#13101f",
  border: "rgba(123,47,255,0.15)", borderHi: "rgba(123,47,255,0.35)",
  purple: "#7B2FFF", purpleDim: "rgba(123,47,255,0.12)",
  cyan: "#00d4ff", green: "#00FF88", gold: "#FFB800",
  red: "#ff4444", orange: "#ff8800", blue: "#4499ff",
  text: "#fff", muted: "#aaa", dim: "#555",
  mono: "'Fira Code','Cascadia Code','Courier New',monospace",
  ui: "'Rajdhani',sans-serif", display: "'Orbitron','Rajdhani',sans-serif",
};

const CodeBlock = ({ code, id, copied, onCopy, lang = "js" }) => (
  <div style={{ position: "relative", marginBottom: 8 }}>
    <div style={{ background: "#050408", borderRadius: 10, padding: "20px 20px 20px 24px", border: `1px solid ${C.border}`, overflowX: "auto" }}>
      <pre style={{ color: "#c8b8ff", fontSize: 12, lineHeight: 1.9, margin: 0, fontFamily: C.mono, tabSize: 2, whiteSpace: "pre" }}>{code}</pre>
    </div>
    <div style={{ position: "absolute", top: 10, right: 10, display: "flex", gap: 6 }}>
      <span style={{ padding: "3px 8px", background: "rgba(123,47,255,0.1)", border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 9, color: C.dim, fontFamily: C.ui }}>{lang}</span>
      <button onClick={() => onCopy(code, id)} style={{ padding: "4px 12px", background: copied === id ? "rgba(0,255,136,0.1)" : C.purpleDim, border: `1px solid ${copied === id ? "rgba(0,255,136,0.3)" : C.border}`, borderRadius: 6, color: copied === id ? C.green : C.muted, fontSize: 11, cursor: "pointer", fontFamily: C.ui, fontWeight: 600, transition: "all 0.2s" }}>
        {copied === id ? "✓ Copied" : "Copy"}
      </button>
    </div>
  </div>
);

const Badge = ({ children, color = C.purple }) => (
  <span style={{ padding: "2px 9px", background: color + "22", border: `1px solid ${color}44`, borderRadius: 4, fontSize: 10, fontWeight: 700, color, fontFamily: C.ui, letterSpacing: "0.5px", textTransform: "uppercase" }}>{children}</span>
);

const InfoBox = ({ color = C.blue, icon = "ℹ", children }) => (
  <div style={{ padding: "13px 18px", background: color + "0d", border: `1px solid ${color}30`, borderRadius: 8, fontSize: 12, color: color + "cc", lineHeight: 1.75, display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 16 }}>
    <span style={{ flexShrink: 0, fontSize: 15 }}>{icon}</span>
    <span style={{ fontFamily: C.ui }}>{children}</span>
  </div>
);

const H2 = ({ children, sub, id }) => (
  <div id={id} style={{ marginBottom: 20, scrollMarginTop: 80 }}>
    <h2 style={{ fontSize: 18, fontWeight: 700, color: C.text, fontFamily: C.ui, margin: "0 0 6px" }}>{children}</h2>
    {sub && <p style={{ fontSize: 13, color: C.muted, margin: 0, lineHeight: 1.75, fontFamily: C.ui }}>{sub}</p>}
  </div>
);

const H3 = ({ children }) => (
  <h3 style={{ fontSize: 14, fontWeight: 700, color: C.text, fontFamily: C.ui, margin: "20px 0 10px", letterSpacing: "0.3px" }}>{children}</h3>
);


// FAQ Item component — hooks outside map
function FAQItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: 8, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
      <button onClick={() => setOpen(o => !o)} style={{ width: "100%", padding: "14px 18px", background: open ? "rgba(123,47,255,0.08)" : "transparent", border: "none", color: C.text, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: C.ui, textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        {q}
        <span style={{ color: C.purple, fontSize: 16 }}>{open ? "−" : "+"}</span>
      </button>
      {open && <div style={{ padding: "0 18px 16px", fontSize: 12, color: C.muted, lineHeight: 1.75, fontFamily: C.ui }}>{a}</div>}
    </div>
  );
}
function AIQuickLinks() {
  const [open, setOpen] = useState(false);

  const docsUrl = import.meta.env.VITE_DOCS_MD_URL;

  const prompt = encodeURIComponent(
    `Read from ${docsUrl} so I can ask questions about it.`
  );

  const links = [
    {
      name: "Open in ChatGPT",
      url: `https://chatgpt.com/?hints=search&q=${prompt}`,
    },
    {
      name: "Open in Claude",
      url: `https://claude.ai/new?q=${prompt}`,
    },
    {
      name: "Open in Perplexity",
      url: `https://www.perplexity.ai/?q=${prompt}`,
    },
  ];

  return (
    <>
      {/* Floating Button */}
      <button
        onClick={() => setOpen(!open)}
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          zIndex: 1000,
          width: 54,
          height: 54,
          borderRadius: "50%",
          border: "none",
          cursor: "pointer",
          background: "linear-gradient(135deg,#7B2FFF,#5a1fd4)",
          color: "#fff",
          fontSize: 22,
          boxShadow: "0 8px 30px rgba(123,47,255,0.45)",
        }}
      >
        ✦
      </button>

      {/* Popup */}
      {open && (
  <div
    style={{
      position: "fixed",
      bottom: 88,
      right: 24,
      width: 320,
      background: "rgba(15,15,20,0.92)",
      backdropFilter: "blur(24px)",
      WebkitBackdropFilter: "blur(24px)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 24,
      overflow: "hidden",
      zIndex: 999,
      boxShadow:
        "0 20px 80px rgba(0,0,0,0.65), 0 0 0 1px rgba(123,47,255,0.08)",
    }}
  >
    {/* Header */}
    <div
      style={{
        padding: "18px 18px 14px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div
        style={{
          fontSize: 15,
          fontWeight: 700,
          color: "#fff",
          fontFamily: C.ui,
          marginBottom: 6,
        }}
      >
        Ask AI About Docs
      </div>

      <div
        style={{
          fontSize: 12,
          lineHeight: 1.6,
          color: "rgba(255,255,255,0.45)",
          fontFamily: C.ui,
        }}
      >
        Read directly from your markdown docs inside AI tools.
      </div>
    </div>

    {/* Links */}
    <div style={{ padding: 10 }}>
      {[
        {
          name: "Open in ChatGPT",
          icon: "✦",
          url: `https://chatgpt.com/?hints=search&q=${prompt}`,
        },
        {
          name: "Open in Claude",
          icon: "✳",
          url: `https://claude.ai/new?q=${prompt}`,
        },
        {
          name: "Open in Perplexity",
          icon: "⬢",
          url: `https://www.perplexity.ai/?q=${prompt}`,
        },
      ].map((item) => (
        <a
          key={item.name}
          href={item.url}
          target="_blank"
          rel="noreferrer"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "14px 14px",
            borderRadius: 16,
            textDecoration: "none",
            transition: "all 0.18s ease",
            marginBottom: 4,
            border: "1px solid transparent",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background =
              "rgba(123,47,255,0.10)";
            e.currentTarget.style.border =
              "1px solid rgba(123,47,255,0.18)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.border =
              "1px solid transparent";
          }}
        >
          {/* Icon */}
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 12,
              background: "rgba(123,47,255,0.14)",
              border: "1px solid rgba(123,47,255,0.14)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#caa6ff",
              fontSize: 15,
              flexShrink: 0,
            }}
          >
            {item.icon}
          </div>

          {/* Text */}
          <div style={{ flex: 1 }}>
            <div
              style={{
                color: "#fff",
                fontSize: 13,
                fontWeight: 600,
                fontFamily: C.ui,
                marginBottom: 2,
              }}
            >
              {item.name}
            </div>

            <div
              style={{
                color: "rgba(255,255,255,0.42)",
                fontSize: 11,
                fontFamily: C.ui,
              }}
            >
              Ask questions about this documentation
            </div>
          </div>

          {/* Arrow */}
          <div
            style={{
              color: "rgba(255,255,255,0.25)",
              fontSize: 16,
            }}
          >
            ↗
          </div>
        </a>
      ))}
    </div>
  </div>
)}
    </>
  );
}

// NAV SECTIONS
const NAV = [
  { label: "Getting Started", items: [
    { id: "overview", label: "Overview" },
    { id: "quickstart", label: "Quick Start" },
    { id: "how-it-works", label: "How It Works" },
  ]},
  { label: "Integration Guides", items: [
    { id: "unity", label: "Unity WebGL" },
    { id: "godot", label: "Godot HTML5" },
    { id: "phaser", label: "Phaser.js" },
    { id: "vanilla", label: "Plain HTML/JS" },
  ]},
  { label: "Reference", items: [
    { id: "api", label: "API Reference" },
    { id: "events", label: "Events" },
  ]},
];

export default function SDK() {
  const [activeSection, setActiveSection] = useState("overview");
  const [copied, setCopied] = useState("");
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 900);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 900);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const copy = (text, id) => { navigator.clipboard.writeText(text); setCopied(id); setTimeout(() => setCopied(""), 2000); };

  const renderContent = () => {
    switch (activeSection) {

      case "overview": return (
        <div>
          <div style={{ marginBottom: 36 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 14px", border: `1px solid ${C.border}`, borderRadius: 20, fontSize: 10, color: C.dim, marginBottom: 20, textTransform: "uppercase", letterSpacing: "1px", fontFamily: C.ui, fontWeight: 600, background: C.purpleDim }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.purple, display: "inline-block" }} />
              Developer Documentation
            </div>
            <h1 style={{ fontSize: isMobile ? 32 : 46, fontWeight: 700, fontFamily: C.display, letterSpacing: "-1px", lineHeight: 1.1, margin: "0 0 14px" }}>
              ARCADE<span style={{ background: `linear-gradient(90deg,${C.purple},${C.cyan})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>X</span>{" "}
              <span style={{ color: C.muted, fontWeight: 400 }}>SDK</span>
            </h1>
            <p style={{ color: C.muted, fontSize: 15, maxWidth: 600, lineHeight: 1.8, marginBottom: 32, fontFamily: C.ui }}>
              Integrate your game with ArcadeX in minutes. Submit on-chain scores, reward players with ARCADE tokens, and connect to BOTChain — works with any game engine.
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {[{ label: "Unity WebGL", color: C.green, icon: "🎮" }, { label: "Godot HTML5", color: C.cyan, icon: "🔵" }, { label: "Phaser.js", color: C.purple, icon: "⚡" }, { label: "Plain JS", color: C.gold, icon: "🌐" }].map(e => (
                <div key={e.label} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", background: e.color + "11", border: `1px solid ${e.color}33`, borderRadius: 20, fontSize: 11, color: e.color, fontFamily: C.ui, fontWeight: 600 }}>
                  <span>{e.icon}</span>{e.label}
                </div>
              ))}
            </div>
          </div>

          {/* Download cards */}
          <H2 id="downloads">SDK Files</H2>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 32 }}>
            {[
              { file: "arcade-sdk.js",        icon: "🌐", color: C.gold,   badge: "v2.0.0",      tag: "All / Plain HTML", desc: "Core SDK — works with any web-based game engine", href: "/arcade-sdk.js" },
              { file: "arcade-sdk-unity.js",   icon: "🎮", color: C.green,  badge: "Unity",       tag: "WebGL Build/",     desc: "Unity WebGL SDK with jslib bridge & SendMessage support", href: "/arcade-sdk-unity.js" },
              { file: "arcade-sdk-godot.js",   icon: "🔵", color: C.cyan,   badge: "Godot",       tag: "HTML5 Export/",    desc: "Godot 3.x & 4.x HTML5 export integration", href: "/arcade-sdk-godot.js" },
              { file: "arcade-sdk-phaser.js",  icon: "⚡", color: C.purple, badge: "Phaser 3",    tag: "project/",         desc: "Phaser 3 SDK — global + optional Scene Plugin", href: "/arcade-sdk-phaser.js" },
              { file: "ArcadeBridge.jslib",    icon: "🔌", color: C.orange, badge: "Unity Plugin", tag: "Assets/Plugins/WebGL/", desc: "Bridges Unity C# DllImport → JavaScript calls", href: "/ArcadeBridge.jslib" },
            ].map(f => (
              <div key={f.file} style={{ background: C.surface, border: `1px solid ${f.color}33`, borderRadius: 14, padding: "18px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ width: 42, height: 42, borderRadius: 10, background: f.color + "11", border: `1px solid ${f.color}33`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>{f.icon}</div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: f.color, fontFamily: C.mono }}>{f.file}</span>
                      <Badge color={f.color}>{f.badge}</Badge>
                      <Badge color={C.gold}>→ {f.tag}</Badge>
                    </div>
                    <div style={{ fontSize: 11, color: C.dim, fontFamily: C.ui }}>{f.desc}</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <a href={f.href} download style={{ padding: "8px 18px", background: `linear-gradient(135deg,${f.color},${f.color}99)`, borderRadius: 8, color: "#040c08", fontSize: 12, fontWeight: 700, textDecoration: "none", fontFamily: C.ui }}>↓ Download</a>
                  <a href={f.href} target="_blank" rel="noreferrer" style={{ padding: "8px 18px", background: "transparent", border: `1px solid ${f.color}44`, borderRadius: 8, color: f.color, fontSize: 12, fontWeight: 600, textDecoration: "none", fontFamily: C.ui }}>View</a>
                </div>
              </div>
            ))}
          </div>

          {/* Engine cards */}
          <H2 id="engines" sub="Choose your game engine to get started">Supported Engines</H2>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4,1fr)", gap: 12 }}>
            {[
              { id: "unity", icon: "🎮", name: "Unity", desc: "WebGL export with jslib bridge", color: C.green },
              { id: "godot", icon: "🔵", name: "Godot", desc: "HTML5 export with JS singleton", color: C.cyan },
              { id: "phaser", icon: "⚡", name: "Phaser.js", desc: "Direct SDK integration", color: C.purple },
              { id: "vanilla", icon: "🌐", name: "Plain JS", desc: "Any HTML5 game", color: C.gold },
            ].map(e => (
              <div key={e.id} onClick={() => setActiveSection(e.id)} style={{ background: C.surface, border: `1px solid ${e.color}22`, borderRadius: 12, padding: "18px 16px", cursor: "pointer", transition: "all 0.2s" }}
                onMouseEnter={el => { el.currentTarget.style.borderColor = e.color + "55"; el.currentTarget.style.background = e.color + "08"; }}
                onMouseLeave={el => { el.currentTarget.style.borderColor = e.color + "22"; el.currentTarget.style.background = C.surface; }}>
                <div style={{ fontSize: 28, marginBottom: 10 }}>{e.icon}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text, fontFamily: C.ui, marginBottom: 4 }}>{e.name}</div>
                <div style={{ fontSize: 11, color: C.muted, fontFamily: C.ui, lineHeight: 1.5 }}>{e.desc}</div>
                <div style={{ marginTop: 10, fontSize: 11, color: e.color, fontFamily: C.ui, fontWeight: 600 }}>View guide →</div>
              </div>
            ))}
          </div>
        </div>
      );

      case "quickstart": return (
        <div>
          <H2 id="qs" sub="From zero to a fully integrated blockchain game in under 10 minutes.">Quick Start</H2>
          <InfoBox color={C.green} icon="✅">Works with any web-based game engine — Unity, Godot, Phaser.js, or plain HTML/JS.</InfoBox>

          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4,1fr)", gap: 12, marginBottom: 28 }}>
            {[
              { n: "01", title: "Build your game", desc: "Export as WebGL/HTML5 from your engine", color: C.purple },
              { n: "02", title: "Add arcade-sdk.js", desc: "Place SDK in same folder as index.html", color: C.cyan },
              { n: "03", title: "Add 3 lines of code", desc: "Init, updateScore, gameOver — that's it", color: C.green },
              { n: "04", title: "Deploy & Submit", desc: "Deploy to Vercel, submit your URL on ArcadeX", color: C.gold },
            ].map(s => (
              <div key={s.n} style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
                <div style={{ fontSize: 32, fontWeight: 700, color: s.color + "33", fontFamily: C.display, lineHeight: 1, marginBottom: 8 }}>{s.n}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text, fontFamily: C.ui, marginBottom: 6 }}>{s.title}</div>
                <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.6, fontFamily: C.ui }}>{s.desc}</div>
              </div>
            ))}
          </div>

          <H3>Minimal integration (any engine)</H3>
          <CodeBlock id="qs-minimal" copied={copied} onCopy={copy} lang="html" code={`<!-- 1. Add script tag to your index.html -->
<script src="arcade-sdk.js"></script>

<!-- 2. Initialize with your Game ID -->
<script>
  ArcadeSDK.init("YOUR_GAME_ID");
</script>

<!-- 3. Call these in your game code -->
<script>
  // Update score during gameplay
  ArcadeSDK.updateScore(1500);

  // Submit final score on game over (triggers blockchain tx)
  ArcadeSDK.gameOver(9999);
</script>`} />

          <InfoBox color={C.gold} icon="💡">Get your Game ID from the Creator Dashboard after submitting your game for review. Leave it empty on first deploy.</InfoBox>
        </div>
      );

      case "how-it-works": return (
        <div>
          <H2 id="hiw" sub="How ArcadeX SDK communicates between your game and the blockchain">How It Works</H2>
          <div style={{ background: "#050408", borderRadius: 12, padding: 24, border: `1px solid ${C.border}`, marginBottom: 24 }}>
            {[
              { color: C.purple, label: "Your Game", desc: "Calls ArcadeSDK.gameOver(score) when player finishes" },
              { isArrow: true },
              { color: C.cyan, label: "arcade-sdk.js", desc: "Sends postMessage event to parent window" },
              { isArrow: true },
              { color: C.blue, label: "ArcadeX Platform", desc: "Receives event, triggers blockchain transaction" },
              { isArrow: true },
              { color: C.green, label: "BOTChain", desc: "Score saved + ARCADE tokens minted on-chain ✅" },
            ].map((item, i) => item.isArrow ? (
              <div key={i} style={{ fontSize: 18, color: C.border, padding: "4px 0 4px 20px" }}>↓</div>
            ) : (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", background: C.surface2, borderRadius: 8, border: `1px solid ${C.border}`, marginBottom: 4 }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: item.color, flexShrink: 0, boxShadow: `0 0 8px ${item.color}88` }} />
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: item.color, fontFamily: C.ui }}>{item.label}</div>
                  <div style={{ fontSize: 11, color: C.dim, marginTop: 2, fontFamily: C.ui }}>{item.desc}</div>
                </div>
              </div>
            ))}
          </div>

          <H3>Token Split</H3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 24 }}>
            {[{ label: "Player gets", value: "80%", color: C.green, desc: "ARCADE tokens for playing" }, { label: "Creator gets", value: "20%", color: C.purple, desc: "ARCADE tokens from each play" }].map(s => (
              <div key={s.label} style={{ background: C.surface, border: `1px solid ${s.color}33`, borderRadius: 12, padding: "20px 24px" }}>
                <div style={{ fontSize: 32, fontWeight: 700, color: s.color, fontFamily: C.display, marginBottom: 6 }}>{s.value}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text, fontFamily: C.ui, marginBottom: 4 }}>{s.label}</div>
                <div style={{ fontSize: 11, color: C.muted, fontFamily: C.ui }}>{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      );

      case "unity": return (
        <div>
          <H2 id="unity" sub="Unity WebGL integration with ArcadeX SDK">Unity WebGL Setup</H2>
          <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
            <Badge color={C.green}>Unity 2021+</Badge><Badge color={C.cyan}>WebGL Build</Badge><Badge color={C.gold}>ArcadeBridge.jslib</Badge>
          </div>

          <H3>Step 1 — Download files</H3>
          <p style={{ fontSize: 13, color: C.muted, fontFamily: C.ui, marginBottom: 12 }}>Download both files from the Overview page:</p>
          <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16, marginBottom: 20 }}>
            {[["arcade-sdk-unity.js", "Place in WebGLBuild/ folder (same as index.html)"], ["ArcadeBridge.jslib", "Place in Assets/Plugins/WebGL/"]].map(([f, d]) => (
              <div key={f} style={{ display: "flex", gap: 12, padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
                <code style={{ color: C.green, fontFamily: C.mono, fontSize: 12, minWidth: 200 }}>{f}</code>
                <span style={{ fontSize: 12, color: C.muted, fontFamily: C.ui }}>{d}</span>
              </div>
            ))}
          </div>

          <H3>Step 2 — Configure Unity Build Settings</H3>
          <InfoBox color={C.blue} icon="ℹ">File → Build Settings → WebGL → Switch Platform. Then Player Settings → Publishing Settings → Enable "Decompression Fallback".</InfoBox>

          <H3>Step 3 — ArcadeManager.cs</H3>
          <CodeBlock id="arcade-manager" copied={copied} onCopy={copy} lang="csharp" code={`using UnityEngine;
using System.Runtime.InteropServices;

public class ArcadeManager : MonoBehaviour
{
    public static ArcadeManager Instance;
    public string gameId = "YOUR_GAME_ID"; // Update after approval

    // Import JS functions from ArcadeBridge.jslib
    [DllImport("__Internal")] private static extern void arcade_init(string gameId);
    [DllImport("__Internal")] private static extern void arcade_updateScore(int score);
    [DllImport("__Internal")] private static extern void arcade_gameOver(int finalScore);

    void Awake()
    {
        if (Instance == null) { Instance = this; DontDestroyOnLoad(gameObject); }
        else { Destroy(gameObject); return; }
    }

    void Start()
    {
        #if !UNITY_EDITOR
        arcade_init(gameId);
        #endif
    }

    public void UpdateScore(int score)
    {
        #if !UNITY_EDITOR
        arcade_updateScore(score);
        #endif
    }

    public void SubmitScore()
    {
        #if !UNITY_EDITOR
        arcade_gameOver(score);
        #endif
    }
}`} />

          <H3>Step 4 — Use in your game</H3>
          <CodeBlock id="unity-use" copied={copied} onCopy={copy} lang="csharp" code={`public class GameController : MonoBehaviour
{
    private int score = 0;

    void Update()
    {
        // Update score in real time
        score += 1;
        if (score % 50 == 0)
            ArcadeManager.Instance.UpdateScore(score);
    }

    public void OnGameOver()
    {
        // Submit final score on-chain
        ArcadeManager.Instance.SubmitScore();
    }
}`} />
        </div>
      );

      case "godot": return (
        <div>
          <H2 id="godot" sub="Godot HTML5 export integration with ArcadeX SDK">Godot HTML5 Setup</H2>
          <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
            <Badge color={C.cyan}>Godot 3.x / 4.x</Badge><Badge color={C.green}>HTML5 Export</Badge>
          </div>
          <InfoBox color={C.blue} icon="ℹ">Godot uses JavaScript singleton to call browser JS. Works in both Godot 3.x and 4.x.</InfoBox>

          <H3>Step 1 — Add SDK to index.html</H3>
          <p style={{ fontSize: 13, color: C.muted, fontFamily: C.ui, marginBottom: 12 }}>After Godot exports, add arcade-sdk-godot.js to your HTML template:</p>
          <CodeBlock id="godot-html" copied={copied} onCopy={copy} lang="html" code={`<!-- In your Godot export index.html, add before </head> -->
<script src="arcade-sdk-godot.js"></script>`} />

          <H3>Step 2 — GDScript integration</H3>
          <CodeBlock id="godot-script" copied={copied} onCopy={copy} lang="gdscript" code={`# ArcadeSDK.gd — autoload singleton
extends Node

var game_id = "YOUR_GAME_ID"

func _ready():
    if OS.has_feature("JavaScript"):
        JavaScript.eval("ArcadeSDK.init('" + game_id + "')")

func update_score(score: int):
    if OS.has_feature("JavaScript"):
        JavaScript.eval("ArcadeSDK.updateScore(" + str(score) + ")")

func game_over(final_score: int):
    if OS.has_feature("JavaScript"):
        JavaScript.eval("ArcadeSDK.gameOver(" + str(final_score) + ")")`} />

          <H3>Step 3 — Use in your game</H3>
          <CodeBlock id="godot-use" copied={copied} onCopy={copy} lang="gdscript" code={`# In your game script
extends Node

var score = 0

func _on_enemy_killed():
    score += 10
    ArcadeSDK.update_score(score)

func _on_player_died():
    ArcadeSDK.game_over(score)`} />

          <InfoBox color={C.gold} icon="💡">For Godot 4.x replace JavaScript.eval() with JavaScriptBridge.eval()</InfoBox>
        </div>
      );

      case "phaser": return (
        <div>
          <H2 id="phaser" sub="Phaser.js integration with ArcadeX SDK">Phaser.js Setup</H2>
          <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
            <Badge color={C.purple}>Phaser 3</Badge><Badge color={C.green}>Direct Integration</Badge>
          </div>

          <H3>Step 1 — Add SDK</H3>
          <CodeBlock id="phaser-html" copied={copied} onCopy={copy} lang="html" code={`<!DOCTYPE html>
<html>
<head>
  <script src="arcade-sdk.js"></script>
  <script src="phaser.min.js"></script>
</head>
<body>
  <script src="game.js"></script>
</body>
</html>`} />

          <H3>Step 2 — Initialize in your game</H3>
          <CodeBlock id="phaser-init" copied={copied} onCopy={copy} lang="js" code={`// game.js
const config = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  scene: { preload, create, update }
};

const game = new Phaser.Game(config);
let score = 0;

function create() {
  // Initialize ArcadeX SDK
  ArcadeSDK.init("YOUR_GAME_ID");
}

function update() {
  score += 1;
  if (score % 100 === 0) {
    // Update score in real time
    ArcadeSDK.updateScore(score);
  }
}

function onGameOver() {
  // Submit final score on-chain
  ArcadeSDK.gameOver(score);
}`} />

          <H3>Scene-based integration</H3>
          <CodeBlock id="phaser-scene" copied={copied} onCopy={copy} lang="js" code={`class GameScene extends Phaser.Scene {
  constructor() { super("GameScene"); }

  create() {
    ArcadeSDK.init("YOUR_GAME_ID");
    this.score = 0;

    // Listen for score events
    this.events.on("addScore", (points) => {
      this.score += points;
      ArcadeSDK.updateScore(this.score);
    });
  }

  onPlayerDeath() {
    ArcadeSDK.gameOver(this.score);
    this.scene.start("GameOverScene");
  }
}`} />
        </div>
      );

      case "vanilla": return (
        <div>
          <H2 id="vanilla" sub="Plain HTML/JavaScript integration — works with any web game">Plain HTML/JS Setup</H2>
          <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
            <Badge color={C.gold}>No Framework</Badge><Badge color={C.green}>Any HTML5 Game</Badge><Badge color={C.cyan}>Canvas / WebGL</Badge>
          </div>
          <InfoBox color={C.green} icon="✅">Simplest integration — just add one script tag and call 3 functions!</InfoBox>

          <H3>Complete example</H3>
          <CodeBlock id="vanilla-full" copied={copied} onCopy={copy} lang="html" code={`<!DOCTYPE html>
<html>
<head>
  <title>My Game</title>
  <!-- 1. Add ArcadeX SDK -->
  <script src="arcade-sdk.js"></script>
</head>
<body>
  <canvas id="gameCanvas" width="800" height="600"></canvas>

  <script>
    // 2. Initialize with your Game ID
    ArcadeSDK.init("YOUR_GAME_ID");

    let score = 0;
    let gameRunning = true;

    // Your game loop
    function gameLoop() {
      if (!gameRunning) return;

      // Your game logic here
      score += 1;

      // 3. Update score in real time
      if (score % 100 === 0) {
        ArcadeSDK.updateScore(score);
      }

      requestAnimationFrame(gameLoop);
    }

    // 4. Submit score on game over
    function onGameOver() {
      gameRunning = false;
      ArcadeSDK.gameOver(score); // Triggers blockchain tx!
    }

    gameLoop();
  </script>
</body>
</html>`} />

          <H3>Listen for player info</H3>
          <CodeBlock id="vanilla-player" copied={copied} onCopy={copy} lang="js" code={`// Get connected wallet info
window.addEventListener("message", (event) => {
  if (event.data.type === "PLAYER_INFO") {
    const { address, balance } = event.data.player;
    console.log("Player wallet:", address);
    console.log("ARCADE balance:", balance);

    // Show in your game UI
    document.getElementById("wallet").textContent = address.slice(0,8) + "...";
  }
});

// Request player info
ArcadeSDK.getPlayerInfo();`} />
        </div>
      );

      case "api": return (
        <div>
          <H2 id="api" sub="Complete API reference for ArcadeX SDK">API Reference</H2>
          {[
            { fn: "ArcadeSDK.init(gameId)", color: C.green, desc: "Initialize the SDK. Call this once when your game loads.", params: [["gameId", "string", "Your Game ID from Creator Dashboard. Pass '' on first deploy."]] },
            { fn: "ArcadeSDK.updateScore(score)", color: C.cyan, desc: "Send real-time score to ArcadeX UI. Does NOT trigger blockchain tx. Call frequently.", params: [["score", "number", "Current player score"]] },
            { fn: "ArcadeSDK.gameOver(finalScore)", color: C.purple, desc: "Submit final score on-chain. Triggers blockchain tx. 80% tokens to player, 20% to creator.", params: [["finalScore", "number", "Player's final score"]] },
            { fn: "ArcadeSDK.getPlayerInfo()", color: C.gold, desc: "Request connected player's wallet info. Returns via PLAYER_INFO postMessage event.", params: [] },
          ].map((api, i) => (
            <div key={i} style={{ marginBottom: 16, padding: 20, background: "#050408", borderRadius: 10, border: `1px solid ${C.border}` }}>
              <code style={{ background: api.color + "15", color: api.color, padding: "5px 14px", borderRadius: 6, fontSize: 13, fontWeight: 600, fontFamily: C.mono, border: `1px solid ${api.color}30`, display: "inline-block", marginBottom: 12 }}>{api.fn}</code>
              <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.75, marginBottom: 12, fontFamily: C.ui }}>{api.desc}</p>
              {api.params.length > 0 && (
                <>
                  <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 8, fontFamily: C.ui, fontWeight: 700 }}>Parameters</div>
                  {api.params.map(([name, type, desc]) => (
                    <div key={name} style={{ display: "flex", gap: 14, padding: "8px 12px", background: C.surface, borderRadius: 6, border: `1px solid ${C.border}`, alignItems: "flex-start", marginBottom: 4 }}>
                      <code style={{ color: api.color, fontSize: 11, minWidth: 120, flexShrink: 0, fontFamily: C.mono }}>{name}</code>
                      <code style={{ color: C.dim, fontSize: 11, minWidth: 60, flexShrink: 0, fontFamily: C.mono }}>{type}</code>
                      <span style={{ fontSize: 11, color: C.muted, lineHeight: 1.6, fontFamily: C.ui }}>{desc}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          ))}
        </div>
      );

      case "events": return (
        <div>
          <H2 id="events" sub="postMessage events sent from ArcadeX platform to your game">Events</H2>
          <InfoBox color={C.blue} icon="ℹ">Your game receives these events via window.postMessage. Listen with window.addEventListener("message", handler).</InfoBox>
          <CodeBlock id="events-listen" copied={copied} onCopy={copy} lang="js" code={`window.addEventListener("message", (event) => {
  const { type, data } = event.data;

  switch(type) {
    case "PLAYER_INFO":
      // Player connected their wallet
      console.log("Address:", data.address);
      console.log("ARCADE Balance:", data.balance);
      break;

    case "TRANSACTION_SUCCESS":
      // Score submitted on-chain successfully
      console.log("TX Hash:", data.txHash);
      console.log("Tokens earned:", data.tokensEarned);
      break;

    case "TRANSACTION_FAILED":
      // Blockchain tx failed
      console.error("Failed:", data.error);
      break;
  }
});`} />

          <H3>Event Reference</H3>
          {[
            { event: "PLAYER_INFO", color: C.cyan, desc: "Sent when player info is requested. Contains wallet address and ARCADE balance.", fields: [["type", '"PLAYER_INFO"'], ["data.address", "string — EVM wallet address"], ["data.balance", "string — ARCADE token balance"]] },
            { event: "TRANSACTION_SUCCESS", color: C.green, desc: "Sent when score is successfully submitted on-chain.", fields: [["type", '"TRANSACTION_SUCCESS"'], ["data.txHash", "string — blockchain tx hash"], ["data.tokensEarned", "number — ARCADE tokens earned"]] },
            { event: "TRANSACTION_FAILED", color: C.red, desc: "Sent when blockchain transaction fails.", fields: [["type", '"TRANSACTION_FAILED"'], ["data.error", "string — error message"]] },
          ].map((e, i) => (
            <div key={i} style={{ marginBottom: 14, padding: 18, background: "#050408", borderRadius: 10, border: `1px solid ${C.border}` }}>
              <code style={{ background: e.color + "15", color: e.color, padding: "4px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, fontFamily: C.mono, border: `1px solid ${e.color}30`, display: "inline-block", marginBottom: 10 }}>{e.event}</code>
              <p style={{ fontSize: 12, color: C.muted, marginBottom: 10, fontFamily: C.ui }}>{e.desc}</p>
              {e.fields.map(([f, d]) => (
                <div key={f} style={{ display: "flex", gap: 14, padding: "6px 10px", background: C.surface, borderRadius: 5, border: `1px solid ${C.border}`, marginBottom: 4 }}>
                  <code style={{ color: e.color, fontSize: 11, minWidth: 180, flexShrink: 0, fontFamily: C.mono }}>{f}</code>
                  <span style={{ fontSize: 11, color: C.muted, fontFamily: C.ui }}>{d}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      );

      case "faq": return (
        <div>
          <H2 id="faq" sub="Common questions about ArcadeX SDK integration">FAQ</H2>
          {[
            { q: "What Game ID do I use on first deploy?", a: "Leave it empty or use '' (empty string). After admin approves your game, you'll get a Game ID. Update it in your code and redeploy — Vercel auto-redeploys in ~30s." },
            { q: "Does the player need to connect a wallet?", a: "Yes, players need to connect a MetaMask or compatible wallet on BOTChain Testnet to earn ARCADE tokens. The Connect Wallet button is in the ArcadeX navbar." },
            { q: "My game is in an iframe, will postMessage work?", a: "Yes! ArcadeX embeds your game in an iframe. The SDK uses window.parent.postMessage to communicate with the platform." },
            { q: "Can I test locally without deploying?", a: "Yes, use the 'Simulate Game Over' button on the gameplay page, or use the Debug panel (🐛 button) to test score submission." },
            { q: "What happens if the transaction fails?", a: "Your game receives a TRANSACTION_FAILED event. The score is NOT saved on-chain. You can show the player an error or retry." },
            { q: "How do I get my Game ID?", a: "Submit your game at /publish on ArcadeX. After admin approval (usually within 24 hours), your Game ID appears in your Creator Dashboard." },
          ].map((item, i) => {
            const [open, setOpen] = useState(false);
            return (
              <div key={i} style={{ marginBottom: 8, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
                <button onClick={() => setOpen(o => !o)} style={{ width: "100%", padding: "14px 18px", background: open ? "rgba(123,47,255,0.08)" : "transparent", border: "none", color: C.text, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: C.ui, textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  {item.q}
                  <span style={{ color: C.purple, fontSize: 16 }}>{open ? "−" : "+"}</span>
                </button>
                {open && <div style={{ padding: "0 18px 16px", fontSize: 12, color: C.muted, lineHeight: 1.75, fontFamily: C.ui }}>{item.a}</div>}
              </div>
            );
          })}
        </div>
      );

      default: return null;
    }
  };

  return (
    <div style={{ minHeight: "calc(100vh - 54px)", background: C.bg, position: "relative" }}>
      <style>{`
        ::-webkit-scrollbar { width: 4px; } 
        ::-webkit-scrollbar-track { background: transparent; } 
        ::-webkit-scrollbar-thumb { background: rgba(123,47,255,0.3); border-radius: 2px; }
        .sdk-nav-item:hover { color: #c4a0ff !important; background: rgba(123,47,255,0.06) !important; }
      `}</style>

      {/* Grid BG */}
      <div style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none" }}>
        <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse 80% 50% at 50% -10%, rgba(123,47,255,0.1) 0%, transparent 65%), #08070f` }} />
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.025 }}>
          <defs><pattern id="sdkgrid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 40" fill="none" stroke="#7B2FFF" strokeWidth="0.5" /></pattern></defs>
          <rect width="100%" height="100%" fill="url(#sdkgrid)" />
        </svg>
      </div>

      <div style={{ position: "relative", zIndex: 1, display: "grid", gridTemplateColumns: isMobile ? "1fr" : "240px 1fr 200px", minHeight: "calc(100vh - 54px)" }}>

        {/* LEFT SIDEBAR */}
        {!isMobile && (
          <div style={{ borderRight: `1px solid ${C.border}`, padding: "28px 0", position: "sticky", top: 54, height: "calc(100vh - 54px)", overflowY: "auto" }}>
            {NAV.map(section => (
              <div key={section.label} style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 700, fontFamily: C.ui, padding: "0 20px", marginBottom: 6 }}>{section.label}</div>
                {section.items.map(item => (
                  <button key={item.id} className="sdk-nav-item" onClick={() => setActiveSection(item.id)} style={{ width: "100%", padding: "8px 20px", background: activeSection === item.id ? "rgba(123,47,255,0.12)" : "transparent", border: "none", borderLeft: activeSection === item.id ? `2px solid ${C.purple}` : "2px solid transparent", color: activeSection === item.id ? "#c4a0ff" : C.dim, fontSize: 13, cursor: "pointer", fontFamily: C.ui, fontWeight: activeSection === item.id ? 600 : 400, textAlign: "left", transition: "all 0.15s" }}>
                    {item.label}
                  </button>
                ))}
              </div>
            ))}
            <div style={{ margin: "20px 16px 0", padding: 14, background: "rgba(123,47,255,0.06)", border: `1px solid ${C.border}`, borderRadius: 10 }}>
              <div style={{ fontSize: 11, color: C.purple, fontWeight: 700, fontFamily: C.ui, marginBottom: 4 }}>✦ Ask AI</div>
              <div style={{ fontSize: 10, color: C.dim, fontFamily: C.ui, lineHeight: 1.6 }}>Open docs directly in ChatGPT, Claude, or Perplexity</div>
            </div>
          </div>
        )}

        {/* MAIN CONTENT */}
        <div style={{ padding: isMobile ? "20px 16px" : "36px 48px", maxWidth: 760, overflowX: "hidden" }}>
          {/* Mobile nav */}
          {isMobile && (
            <div style={{ display: "flex", gap: 6, overflowX: "auto", marginBottom: 24, paddingBottom: 8 }}>
              {NAV.flatMap(s => s.items).map(item => (
                <button key={item.id} onClick={() => setActiveSection(item.id)} style={{ padding: "6px 14px", background: activeSection === item.id ? "rgba(123,47,255,0.2)" : "transparent", border: `1px solid ${activeSection === item.id ? C.purple : C.border}`, borderRadius: 20, color: activeSection === item.id ? "#c4a0ff" : C.dim, fontSize: 11, cursor: "pointer", fontFamily: C.ui, fontWeight: 600, flexShrink: 0, transition: "all 0.15s" }}>
                  {item.label}
                </button>
              ))}
            </div>
          )}

          {renderContent()}

          {/* Bottom nav */}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 48, paddingTop: 24, borderTop: `1px solid ${C.border}` }}>
            <Link to="/publish" style={{ padding: "10px 20px", background: "rgba(123,47,255,0.08)", border: `1px solid ${C.border}`, borderRadius: 8, color: C.purple, fontSize: 12, fontWeight: 700, textDecoration: "none", fontFamily: C.ui }}>
              ← Creator Dashboard
            </Link>
            <Link to="/games" style={{ padding: "10px 20px", background: `linear-gradient(135deg,${C.purple},#5a1fd4)`, border: "none", borderRadius: 8, color: "#fff", fontSize: 12, fontWeight: 700, textDecoration: "none", fontFamily: C.ui }}>
              Play Games →
            </Link>
          </div>
        </div>

        {/* RIGHT SIDEBAR — On this page */}
        {!isMobile && (
          <div style={{ borderLeft: `1px solid ${C.border}`, padding: "28px 20px", position: "sticky", top: 54, height: "calc(100vh - 54px)", overflowY: "auto" }}>
            <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 700, fontFamily: C.ui, marginBottom: 12 }}>On this page</div>
            {(activeSection === "overview" ? ["downloads", "engines"] :
              activeSection === "quickstart" ? ["qs", "qs-minimal"] :
              activeSection === "unity" ? ["unity"] :
              activeSection === "godot" ? ["godot"] :
              activeSection === "phaser" ? ["phaser"] :
              activeSection === "vanilla" ? ["vanilla"] :
              activeSection === "api" ? ["api"] :
              activeSection === "events" ? ["events"] :
              ["faq"]).map(anchor => (
              <a key={anchor} href={`#${anchor}`} style={{ display: "block", padding: "5px 0 5px 12px", borderLeft: `1px solid ${C.border}`, color: C.dim, fontSize: 12, textDecoration: "none", fontFamily: C.ui, marginBottom: 2, transition: "color 0.15s" }}
                onMouseEnter={e => e.target.style.color = "#c4a0ff"}
                onMouseLeave={e => e.target.style.color = C.dim}>
                {anchor.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
              </a>
            ))}

            <div style={{ marginTop: 28, padding: 14, background: "rgba(0,255,136,0.05)", border: "1px solid rgba(0,255,136,0.15)", borderRadius: 10 }}>
              <div style={{ fontSize: 11, color: C.green, fontWeight: 700, fontFamily: C.ui, marginBottom: 6 }}>SDK Version</div>
              <div style={{ fontSize: 12, color: C.muted, fontFamily: C.mono }}>v2.0.0</div>
              <div style={{ fontSize: 10, color: C.dim, fontFamily: C.ui, marginTop: 4 }}>BOTChain EVM</div>
            </div>
          </div>
        )}
      </div>

      <AIQuickLinks />
    </div>
  );
}