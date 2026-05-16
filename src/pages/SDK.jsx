import { useState } from "react";
import { Link } from "react-router-dom";

/* ─── THEME TOKENS ─── */
const C = {
  bg:        "#08070f",
  surface:   "#0e0c1a",
  surface2:  "#13101f",
  border:    "rgba(123,47,255,0.15)",
  borderHi:  "rgba(123,47,255,0.35)",
  purple:    "#7B2FFF",
  purpleDim: "rgba(123,47,255,0.12)",
  cyan:      "#00d4ff",
  green:     "#00FF88",
  gold:      "#FFB800",
  red:       "#ff4444",
  orange:    "#ff8800",
  blue:      "#4499ff",
  text:      "#fff",
  muted:     "#aaa",
  dim:       "#555",
  mono:      "'Fira Code','Cascadia Code','Courier New',monospace",
  ui:        "'Rajdhani',sans-serif",
  display:   "'Orbitron','Rajdhani',sans-serif",
};

/* ─── CODE BLOCK ─── */
const CodeBlock = ({ code, id, copied, onCopy }) => (
  <div style={{ position: "relative" }}>
    <div style={{
      background: "#050408",
      borderRadius: 10,
      padding: "20px 20px 20px 24px",
      border: `1px solid ${C.border}`,
      overflowX: "auto",
      boxShadow: "inset 0 1px 0 rgba(123,47,255,0.08)",
    }}>
      <pre style={{
        color: "#c8b8ff",
        fontSize: 12,
        lineHeight: 1.9,
        margin: 0,
        fontFamily: C.mono,
        tabSize: 2,
        whiteSpace: "pre",
      }}>
        {code}
      </pre>
    </div>
    <button
      onClick={() => onCopy(code, id)}
      style={{
        position: "absolute", top: 12, right: 12,
        padding: "4px 12px",
        background: copied === id ? "rgba(0,255,136,0.1)" : C.purpleDim,
        border: `1px solid ${copied === id ? "rgba(0,255,136,0.3)" : C.border}`,
        borderRadius: 6,
        color: copied === id ? C.green : C.muted,
        fontSize: 11, cursor: "pointer",
        fontFamily: C.ui, fontWeight: 600,
        letterSpacing: "0.3px",
        transition: "all 0.2s",
      }}>
      {copied === id ? "✓ Copied" : "Copy"}
    </button>
  </div>
);

/* ─── BADGE ─── */
const Badge = ({ children, color = C.purple }) => (
  <span style={{
    padding: "2px 9px",
    background: color + "22",
    border: `1px solid ${color}44`,
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 700,
    color,
    fontFamily: C.ui,
    letterSpacing: "0.5px",
    textTransform: "uppercase",
  }}>{children}</span>
);

/* ─── INFO BOX ─── */
const InfoBox = ({ color = C.blue, icon = "ℹ", children }) => (
  <div style={{
    padding: "13px 18px",
    background: color + "0d",
    border: `1px solid ${color}30`,
    borderRadius: 8,
    fontSize: 12,
    color: color + "cc",
    lineHeight: 1.75,
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
  }}>
    <span style={{ flexShrink: 0, fontSize: 15 }}>{icon}</span>
    <span style={{ fontFamily: C.ui }}>{children}</span>
  </div>
);

/* ─── SECTION ─── */
const Section = ({ children, style = {} }) => (
  <div style={{
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: 14,
    padding: 32,
    ...style,
  }}>{children}</div>
);

const SectionTitle = ({ children, sub }) => (
  <div style={{ marginBottom: 22 }}>
    <h2 style={{
      fontSize: 18, fontWeight: 700,
      color: C.text, fontFamily: C.ui,
      letterSpacing: "0.3px", margin: 0,
    }}>{children}</h2>
    {sub && (
      <p style={{
        fontSize: 13, color: C.muted,
        marginTop: 7, lineHeight: 1.75, fontFamily: C.ui,
      }}>{sub}</p>
    )}
  </div>
);

/* ─── STEP CARD ─── */
const StepCard = ({ n, title, desc, tag }) => (
  <div
    style={{
      padding: 22, background: C.surface2,
      borderRadius: 12, border: `1px solid ${C.border}`,
      display: "flex", flexDirection: "column", gap: 10,
      transition: "border-color 0.2s, box-shadow 0.2s",
    }}
    onMouseEnter={e => {
      e.currentTarget.style.borderColor = C.borderHi;
      e.currentTarget.style.boxShadow = "0 4px 20px rgba(123,47,255,0.1)";
    }}
    onMouseLeave={e => {
      e.currentTarget.style.borderColor = C.border;
      e.currentTarget.style.boxShadow = "none";
    }}
  >
    <div style={{
      fontSize: 36, fontWeight: 700,
      color: "rgba(123,47,255,0.15)",
      fontFamily: C.display, letterSpacing: "-1px", lineHeight: 1,
    }}>{n}</div>
    <div style={{ fontSize: 14, fontWeight: 700, color: C.text, fontFamily: C.ui, letterSpacing: "0.3px" }}>{title}</div>
    <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.75 }}>{desc}</div>
    {tag && (
      <div style={{
        fontSize: 10, color: C.dim, fontFamily: C.mono,
        background: "#050408", padding: "5px 10px",
        borderRadius: 5, border: `1px solid ${C.border}`, marginTop: "auto",
      }}>{tag}</div>
    )}
  </div>
);

/* ─── FLOW ROW ─── */
const FlowRow = ({ color, label, desc, isArrow }) => {
  if (isArrow) return (
    <div style={{ fontSize: 18, color: C.border, padding: "2px 0 2px 20px" }}>↓</div>
  );
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 14,
      padding: "12px 16px", background: C.surface2,
      borderRadius: 8, border: `1px solid ${C.border}`, marginBottom: 4,
    }}>
      <div style={{
        width: 10, height: 10, borderRadius: "50%",
        background: color, flexShrink: 0,
        boxShadow: color !== C.dim ? `0 0 8px ${color}88` : "none",
      }} />
      <div>
        <div style={{
          fontSize: 12, fontWeight: 600,
          color: color === C.dim ? C.muted : color, fontFamily: C.ui,
        }}>{label}</div>
        <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>{desc}</div>
      </div>
    </div>
  );
};

/* ════════════════════════════════════════
   MAIN COMPONENT
════════════════════════════════════════ */
export default function SDK() {
  const [activeTab, setActiveTab] = useState("quickstart");
  const [copied, setCopied]       = useState("");

  const copy = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(""), 2000);
  };

  const tabs = [
    { id: "quickstart", label: "Quick Start"   },
    { id: "unity",      label: "Unity Setup"   },
    { id: "events",     label: "API Reference" },
    { id: "examples",   label: "Examples"      },
  ];

  return (
    <div style={{ minHeight: "calc(100vh - 54px)", background: "transparent", position: "relative" }}>

      {/* ── FIXED BG ── */}
      <div style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none" }}>
        <div style={{
          position: "absolute", inset: 0,
          background: `
            radial-gradient(ellipse 80% 50% at 50% -10%, rgba(123,47,255,0.12) 0%, transparent 65%),
            radial-gradient(ellipse 50% 40% at 90% 60%, rgba(0,212,255,0.05) 0%, transparent 50%),
            #08070f`,
        }} />
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.025 }}>
          <defs>
            <pattern id="sdkgrid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#7B2FFF" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#sdkgrid)" />
        </svg>
      </div>

      {/* ── CONTENT ── */}
      <div style={{
        position: "relative", zIndex: 1,
        padding: "36px 44px",
        maxWidth: 1000, margin: "0 auto",
      }}>

        {/* ════ HEADER ════ */}
        <div style={{ marginBottom: 48 }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "5px 14px", border: `1px solid ${C.border}`,
            borderRadius: 20, fontSize: 10, color: C.dim,
            marginBottom: 20, textTransform: "uppercase",
            letterSpacing: "1px", fontFamily: C.ui, fontWeight: 600,
            background: C.purpleDim,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.purple, display: "inline-block" }} />
            Developer Documentation
          </div>

          <h1 style={{
            fontSize: 46, fontWeight: 700,
            fontFamily: C.display, letterSpacing: "-1px",
            lineHeight: 1.1, margin: "0 0 14px",
          }}>
            INITIA
            <span style={{
              background: `linear-gradient(90deg,${C.purple},${C.cyan})`,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}>ARCADE</span>{" "}
            <span style={{ color: C.muted, fontWeight: 400 }}>SDK</span>
          </h1>

          <p style={{
            color: C.muted, fontSize: 15, maxWidth: 600,
            lineHeight: 1.8, marginBottom: 32, fontFamily: C.ui,
          }}>
            Integrate your Unity WebGL game with InitiaArcade in minutes.
            Submit on-chain scores, reward players with ARCADE tokens, and
            connect to the Initia blockchain — all with a single JS file.
          </p>

          {/* Download cards */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 740 }}>

            {/* arcade-sdk.js */}
            <div style={{
              background: C.surface, border: "1px solid rgba(0,255,136,0.2)",
              borderRadius: 14, padding: "20px 26px",
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 10, flexShrink: 0,
                  background: "rgba(0,255,136,0.08)", border: "1px solid rgba(0,255,136,0.2)",
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20,
                }}>⚡</div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: C.green, fontFamily: C.mono }}>arcade-sdk.js</span>
                    <Badge color={C.green}>v1.0.0</Badge>
                    <Badge color={C.gold}>→ Build/ folder</Badge>
                  </div>
                  <div style={{ fontSize: 11, color: C.dim, fontFamily: C.ui }}>
                    Copy to <code style={{ color: C.muted, fontFamily: C.mono }}>WebGLBuild/Build/</code> after Unity export · No dependencies
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
                <a href="/arcade-sdk.js" download style={{
                  padding: "9px 20px",
                  background: "linear-gradient(135deg,#00FF88,#00cc66)",
                  borderRadius: 8, color: "#040c08",
                  fontSize: 12, fontWeight: 700, textDecoration: "none",
                  fontFamily: C.ui, letterSpacing: "0.5px",
                }}>↓ Download</a>
                <a href="/arcade-sdk.js" target="_blank" rel="noreferrer" style={{
                  padding: "9px 20px", background: "transparent",
                  border: "1px solid rgba(0,255,136,0.25)",
                  borderRadius: 8, color: C.green,
                  fontSize: 12, fontWeight: 600, textDecoration: "none", fontFamily: C.ui,
                }}>View Source</a>
              </div>
            </div>

            {/* ArcadeBridge.jslib */}
            <div style={{
              background: C.surface, border: "1px solid rgba(0,212,255,0.2)",
              borderRadius: 14, padding: "20px 26px",
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 10, flexShrink: 0,
                  background: "rgba(0,212,255,0.08)", border: "1px solid rgba(0,212,255,0.2)",
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20,
                }}>🔌</div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: C.cyan, fontFamily: C.mono }}>ArcadeBridge.jslib</span>
                    <Badge color={C.cyan}>Unity Plugin</Badge>
                    <Badge color={C.purple}>→ Assets/Plugins/WebGL/</Badge>
                  </div>
                  <div style={{ fontSize: 11, color: C.dim, fontFamily: C.ui }}>
                    Place in <code style={{ color: C.muted, fontFamily: C.mono }}>Assets/Plugins/WebGL/</code> · Bridges C# → JavaScript calls
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
                <a href="/ArcadeBridge.jslib" download style={{
                  padding: "9px 20px",
                  background: `linear-gradient(135deg,${C.cyan},#0099bb)`,
                  borderRadius: 8, color: "#040c10",
                  fontSize: 12, fontWeight: 700, textDecoration: "none",
                  fontFamily: C.ui, letterSpacing: "0.5px",
                }}>↓ Download</a>
                <a href="/ArcadeBridge.jslib" target="_blank" rel="noreferrer" style={{
                  padding: "9px 20px", background: "transparent",
                  border: "1px solid rgba(0,212,255,0.25)",
                  borderRadius: 8, color: C.cyan,
                  fontSize: 12, fontWeight: 600, textDecoration: "none", fontFamily: C.ui,
                }}>View Source</a>
              </div>
            </div>
          </div>
        </div>

        {/* ════ TABS ════ */}
        <div style={{
          display: "flex", gap: 0, marginBottom: 36,
          borderBottom: `1px solid ${C.border}`,
        }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
              padding: "12px 26px", background: "transparent", border: "none",
              borderBottom: activeTab === t.id ? `2px solid ${C.purple}` : "2px solid transparent",
              color: activeTab === t.id ? "#fff" : C.dim,
              fontSize: 13, cursor: "pointer", transition: "all 0.2s",
              marginBottom: "-1px", fontFamily: C.ui, fontWeight: 600, letterSpacing: "0.3px",
            }}
              onMouseEnter={e => { if (activeTab !== t.id) e.currentTarget.style.color = C.muted; }}
              onMouseLeave={e => { if (activeTab !== t.id) e.currentTarget.style.color = C.dim; }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ════ QUICK START ════ */}
        {activeTab === "quickstart" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

            <Section>
              <SectionTitle sub="From zero to a fully integrated blockchain game in under 10 minutes.">
                Get started in 4 steps
              </SectionTitle>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
                <StepCard n="01" title="Build WebGL"
                  desc="Place ArcadeBridge.jslib in Assets/Plugins/ before building. Export as WebGL from File → Build Settings."
                  tag="File → Build Settings → WebGL" />
                <StepCard n="02" title="Copy arcade-sdk.js"
                  desc="After Unity exports, place arcade-sdk.js in the root of the output — same folder as index.html. The WebGL template loads it from there."
                  tag="WebGLBuild/arcade-sdk.js (next to index.html)" />
                <StepCard n="03" title="Deploy + Submit"
                  desc="Push to GitHub, deploy on Vercel. Submit your game URL on the platform — leave Game ID empty for now."
                  tag="initia-arcade.vercel.app/publish" />
                <StepCard n="04" title="Update Game ID"
                  desc="After admin approval you get a Game ID. Paste it into ArcadeManager.gameId, push again — Vercel auto-redeploys."
                  tag="git push → auto redeploy" />
              </div>
            </Section>

            {/* Game ID 3-step flow */}
            <div style={{
              background: C.surface,
              border: `1px solid ${C.borderHi}`,
              borderRadius: 14,
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 0,
              overflow: "hidden",
            }}>
              {[
                { icon: "🚀", color: C.purple, title: "1. Deploy to Vercel", desc: 'Push your WebGL build to GitHub. Connect the repo on vercel.com. Get a public URL like your-game.vercel.app' },
                { icon: "📋", color: C.cyan,   title: "2. Submit without Game ID", desc: 'Go to /publish on InitiaArcade. Fill in game details — leave Game ID blank. Submit for admin review.' },
                { icon: "✅", color: C.green,  title: "3. Update & Redeploy", desc: 'After approval paste the Game ID into ArcadeManager.cs. Push to GitHub — Vercel redeploys automatically in ~30s.' },
              ].map((item, i) => (
                <div key={i} style={{
                  padding: "24px 26px",
                  borderRight: i < 2 ? `1px solid ${C.border}` : "none",
                  background: i === 1 ? "rgba(0,212,255,0.02)" : "transparent",
                }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 10,
                    background: item.color + "18",
                    border: `1px solid ${item.color}40`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 18, marginBottom: 12,
                  }}>{item.icon}</div>
                  <div style={{
                    fontSize: 13, fontWeight: 700, color: item.color,
                    fontFamily: C.ui, marginBottom: 6, letterSpacing: "0.3px",
                  }}>{item.title}</div>
                  <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.75, fontFamily: C.ui }}>{item.desc}</div>
                </div>
              ))}
            </div>

            <Section>
              <SectionTitle sub="The SDK bridges Unity and Initia blockchain via browser postMessage. No wallet code inside Unity needed.">
                How it works
              </SectionTitle>
              <div style={{ background: "#050408", borderRadius: 10, padding: 24, border: `1px solid ${C.border}` }}>
                {[
                  { color: C.purple, label: "Unity Game (iframe)",   desc: "ArcadeManager.Instance.SubmitScore() called by your game script" },
                  { isArrow: true },
                  { color: C.cyan,   label: "ArcadeBridge.jslib",    desc: "DllImport wires C# → arcade_gameOver() JS function in jslib" },
                  { isArrow: true },
                  { color: C.blue,   label: "React Platform",         desc: "Receives postMessage event, triggers blockchain tx" },
                  { isArrow: true },
                  { color: C.dim,    label: "InterwovenKit",           desc: "Signs via Ghost Wallet (auto-sign, no popup)" },
                  { isArrow: true },
                  { color: C.green,  label: "Initia Blockchain",       desc: "Score saved + ARCADE tokens minted on-chain ✅" },
                ].map((item, i) => (
                  <FlowRow key={i} {...item} />
                ))}
              </div>
            </Section>

            <Section>
              <SectionTitle sub="Minimum C# to submit scores. Use ArcadeManager.Instance from your game scripts.">
                Minimal integration
              </SectionTitle>
              <CodeBlock id="minimal" copied={copied} onCopy={copy} code={`// In your GameController / PlayerController / wherever game ends:

void OnObstacleHit()
{
    // Update score during gameplay
    ArcadeManager.Instance.UpdateScore(score);
}

void OnGameOver()
{
    // Submit final score on-chain (called once)
    ArcadeManager.Instance.SubmitScore();
}

// ArcadeManager handles the rest automatically via DllImport → ArcadeBridge.jslib`} />
            </Section>
          </div>
        )}

        {/* ════ UNITY SETUP ════ */}
        {activeTab === "unity" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

            {/* Step 1 */}
            <Section>
              <SectionTitle sub="Open File → Build Settings, select WebGL, click Switch Platform. Then open Player Settings:">
                Step 1 — Configure WebGL Build Settings
              </SectionTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[
                  ["Resolution and Presentation",                "Enable Resizable Window"],
                  ["Publishing Settings → Compression Format",   "Disabled"],
                  ["Publishing Settings → Allow downloads HTTP", "Always allowed"],
                  ["Other Settings → Color Space",               "Linear (recommended)"],
                ].map(([setting, value]) => (
                  <div key={setting} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "12px 16px", background: "#050408",
                    borderRadius: 8, border: `1px solid ${C.border}`, gap: 16,
                  }}>
                    <span style={{ fontSize: 12, color: C.muted, fontFamily: C.mono }}>{setting}</span>
                    <span style={{
                      fontSize: 11, color: C.green, fontFamily: C.ui, fontWeight: 700,
                      background: "rgba(0,255,136,0.08)", padding: "3px 10px",
                      borderRadius: 4, border: "1px solid rgba(0,255,136,0.2)", flexShrink: 0,
                    }}>{value}</span>
                  </div>
                ))}
              </div>
            </Section>

            {/* Step 1.5 — WebGL Template */}
            <Section style={{ border: `1px solid rgba(255,184,0,0.25)` }}>
              <SectionTitle sub="Use the InitiaArcade custom WebGL template — includes themed loading screen, arcade-sdk.js, and proper canvas sizing out of the box.">
                Step 1.5 — Install InitiaArcade WebGL Template
              </SectionTitle>

              {/* Download card */}
              <div style={{
                background: C.surface2,
                border: `1px solid rgba(255,184,0,0.2)`,
                borderRadius: 14, padding: "20px 26px",
                display: "flex", alignItems: "center",
                justifyContent: "space-between", gap: 20, marginBottom: 16,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: 10, flexShrink: 0,
                    background: "rgba(255,184,0,0.08)", border: "1px solid rgba(255,184,0,0.2)",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20,
                  }}>🎨</div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: C.gold, fontFamily: C.mono }}>InitiaArcade WebGL Template</span>
                      <Badge color={C.gold}>Unity Template</Badge>
                      <Badge color={C.purple}>Assets/WebGLTemplates/</Badge>
                    </div>
                    <div style={{ fontSize: 11, color: C.dim, fontFamily: C.ui }}>
                      Place in <code style={{ color: C.muted, fontFamily: C.mono }}>Assets/WebGLTemplates/InitiaArcade/</code> · Custom loading screen + SDK ready
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
                  <a href="/WebGLTemplates.zip" download style={{
                    padding: "9px 20px",
                    background: `linear-gradient(135deg,${C.gold},#cc8800)`,
                    borderRadius: 8, color: "#0a0600",
                    fontSize: 12, fontWeight: 700, textDecoration: "none",
                    fontFamily: C.ui, letterSpacing: "0.5px",
                  }}>↓ Download Template</a>
                </div>
              </div>

              {/* File structure */}
              <CodeBlock id="templatepath" copied={copied} onCopy={copy} code={`YourUnityProject/
└── Assets/
    └── WebGLTemplates/
        └── InitiaArcade/          ← Extract downloaded zip here
            ├── index.html         ← Custom themed loading screen
            ├── arcade-sdk.js      ← SDK (already included)
            └── thumbnail.png      ← Template preview icon`} />

              <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                <InfoBox color={C.gold} icon="🎨">
                  <strong>How to select in Unity:</strong>{" "}
                  Edit → Project Settings → Player → Resolution and Presentation → WebGL Template → select <code style={{ fontFamily: C.mono }}>InitiaArcade</code>
                </InfoBox>

                {/* Width Height settings */}
                <div style={{
                  padding: "20px 22px",
                  background: C.purpleDim,
                  border: `1px solid ${C.borderHi}`,
                  borderRadius: 10,
                }}>
                  <div style={{
                    fontSize: 13, fontWeight: 700, color: C.text,
                    fontFamily: C.ui, marginBottom: 14, letterSpacing: "0.3px",
                    display: "flex", alignItems: "center", gap: 8,
                  }}>
                    📐 Set Canvas Width & Height
                  </div>
                  <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.75, marginBottom: 14, fontFamily: C.ui }}>
                    Set your game resolution under Player Settings → Resolution and Presentation.
                    The template automatically uses{" "}
                    <code style={{ background: "#050408", padding: "1px 5px", borderRadius: 3, fontSize: 11 }}>{`{{{ WIDTH }}}`}</code> and{" "}
                    <code style={{ background: "#050408", padding: "1px 5px", borderRadius: 3, fontSize: 11 }}>{`{{{ HEIGHT }}}`}</code> values from your Unity settings.
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {[
                      ["Portrait game  (mobile-style)", "Default Canvas Width", "1080", "Default Canvas Height", "1920"],
                      ["Landscape game (desktop-style)", "Default Canvas Width", "1920", "Default Canvas Height", "1080"],
                      ["Square game", "Default Canvas Width", "1080", "Default Canvas Height", "1080"],
                    ].map(([label, wLabel, w, hLabel, h]) => (
                      <div key={label} style={{
                        padding: "12px 16px",
                        background: "#050408",
                        borderRadius: 8, border: `1px solid ${C.border}`,
                      }}>
                        <div style={{ fontSize: 10, color: C.dim, fontFamily: C.ui, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 8 }}>{label}</div>
                        <div style={{ display: "flex", gap: 20 }}>
                          <div>
                            <div style={{ fontSize: 9, color: C.dim, fontFamily: C.mono, marginBottom: 3 }}>{wLabel}</div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: C.purple, fontFamily: C.mono }}>{w}</div>
                          </div>
                          <div style={{ width: 1, background: C.border }} />
                          <div>
                            <div style={{ fontSize: 9, color: C.dim, fontFamily: C.mono, marginBottom: 3 }}>{hLabel}</div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: C.cyan, fontFamily: C.mono }}>{h}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <InfoBox color={C.blue} icon="ℹ">
                      <code style={{ fontFamily: C.mono }}>Scale to Fit: true</code> — the template automatically resizes to fit the browser window while maintaining the correct aspect ratio. Portrait games will display full screen on mobile.
                    </InfoBox>
                  </div>
                </div>
              </div>
            </Section>
            <Section>
              <SectionTitle sub="ArcadeBridge.jslib is the Unity WebGL plugin that exposes arcade_* functions to C# via DllImport. Place it in Assets/Plugins/WebGL/.">
                Step 2 — Place ArcadeBridge.jslib in Assets/Plugins/WebGL/
              </SectionTitle>
              <CodeBlock id="jslibpath" copied={copied} onCopy={copy} code={`YourUnityProject/
└── Assets/
    └── Plugins/
        └── WebGL/
            └── ArcadeBridge.jslib   ✅ Here — inside the WebGL subfolder`} />
              <div style={{ marginTop: 12 }}>
                <InfoBox color={C.cyan} icon="🔌">
                  Unity automatically includes all <code style={{ fontFamily: C.mono }}>.jslib</code> files from{" "}
                  <code style={{ fontFamily: C.mono }}>Assets/Plugins/WebGL/</code> in the WebGL build.
                  This is the correct and standard location — it wires up{" "}
                  <code style={{ fontFamily: C.mono }}>DllImport("__Internal")</code> calls in C# to the
                  corresponding JavaScript functions in the jslib at runtime.
                </InfoBox>
              </div>
            </Section>

            {/* Step 3 — ArcadeManager C# */}
            <Section>
              <SectionTitle sub="Create ArcadeManager.cs and attach it to an empty GameObject in your scene. Use ArcadeManager.Instance to call it from anywhere.">
                Step 3 — Attach ArcadeManager.cs to an Empty GameObject
              </SectionTitle>
              <InfoBox color={C.gold} icon="⚠">
                <strong>Leave <code style={{ fontFamily: C.mono }}>gameId</code> as <code style={{ fontFamily: C.mono }}>"YOUR_GAME_ID"</code> on first deploy.</strong>{" "}
                Submit your game URL first to receive a Game ID from admin. Come back, paste it in the Inspector or in code, rebuild, and redeploy.
              </InfoBox>
              <div style={{ marginTop: 14 }}>
                <CodeBlock id="csharp" copied={copied} onCopy={copy} code={`using UnityEngine;
using System.Runtime.InteropServices;

public class ArcadeManager : MonoBehaviour
{
    public static ArcadeManager Instance;

    [Header("InitiaArcade Settings")]
    [SerializeField] string gameId = "YOUR_GAME_ID";
    // ⚠ Fill in after you receive your Game ID — then rebuild & redeploy

    private int currentScore;
    private bool isSubmitted = false;

    // ── DllImport wires these to ArcadeBridge.jslib at runtime ──
    [DllImport("__Internal")]
    private static extern void arcade_init(string gameId);

    [DllImport("__Internal")]
    private static extern void arcade_gameOver(int score);

    [DllImport("__Internal")]
    private static extern void arcade_updateScore(int score);

    // ── Singleton so any script can call ArcadeManager.Instance ──
    void Awake()
    {
        if (Instance == null)
        {
            Instance = this;
            DontDestroyOnLoad(gameObject);
        }
        else
        {
            Destroy(gameObject);
        }
    }

    void Start()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        arcade_init(gameId);
#else
        Debug.Log("[ArcadeManager] arcade_init: " + gameId);
#endif
    }

    // 🔥 Call this whenever the player's score changes
    public void UpdateScore(int score)
    {
        currentScore = score;
#if UNITY_WEBGL && !UNITY_EDITOR
        arcade_updateScore(currentScore);
#else
        Debug.Log("[ArcadeManager] Score Updated: " + currentScore);
#endif
    }

    // 🔥 Call this when the game ends (once only)
    public void SubmitScore()
    {
        if (isSubmitted) return;
        isSubmitted = true;
#if UNITY_WEBGL && !UNITY_EDITOR
        arcade_gameOver(currentScore);
#else
        Debug.Log("[ArcadeManager] Game Over Score: " + currentScore);
#endif
    }
}`} />
              </div>
              <div style={{ marginTop: 14 }}>
                <InfoBox color={C.blue} icon="ℹ">
                  <strong>How to use from other scripts:</strong>{" "}
                  <code style={{ fontFamily: C.mono }}>ArcadeManager.Instance.UpdateScore(score)</code> and{" "}
                  <code style={{ fontFamily: C.mono }}>ArcadeManager.Instance.SubmitScore()</code> — call these from
                  your GameController, PlayerController, or wherever your game logic lives.
                  The <code style={{ fontFamily: C.mono }}>#if UNITY_WEBGL</code> guards prevent crashes in the Editor.
                </InfoBox>
              </div>
            </Section>

            {/* Step 4 — Build + copy sdk */}
            <Section style={{ border: `1px solid rgba(0,255,136,0.25)` }}>
              <SectionTitle sub="Export WebGL from Unity. Then copy arcade-sdk.js into the root of the output — same folder as index.html.">
                Step 4 — Build WebGL + Place arcade-sdk.js next to index.html
              </SectionTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <InfoBox color={C.green} icon="📦">
                  <strong>arcade-sdk.js goes in the root of your WebGL output — same level as <code style={{ fontFamily: C.mono }}>index.html</code>.</strong>{" "}
                  The WebGL template's <code style={{ fontFamily: C.mono }}>index.html</code> loads it via{" "}
                  <code style={{ fontFamily: C.mono }}>&lt;script src="arcade-sdk.js"&gt;</code>.
                  Do NOT put it inside the <code style={{ fontFamily: C.mono }}>Build/</code> subfolder.
                </InfoBox>

                <CodeBlock id="buildfolder" copied={copied} onCopy={copy} code={`WebGLBuild/                         ← Your Unity export output folder (repo root)
├── arcade-sdk.js                   ✅ Place arcade-sdk.js HERE (next to index.html)
├── index.html                      ✅ WebGL template (already present)
├── Build/
│   ├── YourGame.data
│   ├── YourGame.framework.js
│   ├── YourGame.loader.js
│   └── YourGame.wasm
└── TemplateData/                   ✅ WebGL template assets (already present)`} />

                <InfoBox color={C.red} icon="❌">
                  <strong>Without <code style={{ fontFamily: C.mono }}>arcade-sdk.js</code> in the root, all SDK calls will silently fail.</strong>{" "}
                  The <code style={{ fontFamily: C.mono }}>index.html</code> template references it as{" "}
                  <code style={{ fontFamily: C.mono }}>src="arcade-sdk.js"</code> — if missing,{" "}
                  <code style={{ fontFamily: C.mono }}>arcade_init</code> and{" "}
                  <code style={{ fontFamily: C.mono }}>arcade_gameOver</code> are never registered.
                </InfoBox>
              </div>
            </Section>

            {/* Step 5 — Vercel */}
            <Section>
              <SectionTitle sub="Push your WebGL output to GitHub. Vercel picks it up automatically and gives you a public URL.">
                Step 5 — Deploy to Vercel
              </SectionTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <CodeBlock id="vercel" copied={copied} onCopy={copy} code={`# 1. Push your WebGL build output folder to a GitHub repo
git init
git add .
git commit -m "Initial WebGL build"
git remote add origin https://github.com/USERNAME/your-game.git
git push -u origin main

# 2. Go to vercel.com → New Project → Import your GitHub repo

# 3. Vercel settings:
#    Framework Preset : Other
#    Root Directory   : ./      (root of your repo)
#    Build Command    :         (leave empty — static files)
#    Output Directory : ./

# 4. Click Deploy
#    → Your game is live at: https://your-game.vercel.app

# 5. Submit this URL on InitiaArcade at /publish`} />
                <InfoBox color={C.blue} icon="ℹ">
                  Vercel auto-deploys on every <code style={{ fontFamily: C.mono }}>git push</code>.
                  When you update your Game ID later, just push again — no manual redeploy needed.
                </InfoBox>
              </div>
            </Section>

            {/* Step 6 — Update Game ID */}
            <Section style={{
              background: "linear-gradient(135deg,rgba(123,47,255,0.07),rgba(0,212,255,0.03))",
              border: `1px solid ${C.borderHi}`,
            }}>
              <SectionTitle sub="After admin approval you'll receive a Game ID. Update your script and push — done.">
                Step 6 — Update Game ID after approval
              </SectionTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                  <div>
                    <div style={{
                      fontSize: 11, fontWeight: 700, color: C.red,
                      fontFamily: C.ui, letterSpacing: "0.5px",
                      textTransform: "uppercase", marginBottom: 8,
                    }}>Before — first deploy</div>
                    <CodeBlock id="before" copied={copied} onCopy={copy} code={`[SerializeField] string gameId = "YOUR_GAME_ID";
// submit to platform first — Game ID pending`} />
                  </div>
                  <div>
                    <div style={{
                      fontSize: 11, fontWeight: 700, color: C.green,
                      fontFamily: C.ui, letterSpacing: "0.5px",
                      textTransform: "uppercase", marginBottom: 8,
                    }}>After approval ✅</div>
                    <CodeBlock id="after" copied={copied} onCopy={copy} code={`[SerializeField] string gameId = "abc123xyz";
// actual Game ID from admin → rebuild → redeploy`} />
                  </div>
                </div>
                <CodeBlock id="redeploy" copied={copied} onCopy={copy} code={`# After pasting Game ID in Inspector:
# 1. Rebuild Unity → File → Build → WebGL
# 2. Place arcade-sdk.js next to index.html (root) again
# 3. Push to GitHub

git add .
git commit -m "Add Game ID: abc123xyz"
git push

# Vercel auto-redeploys in ~30 seconds ✅
# Your game is now fully linked on-chain`} />
              </div>
            </Section>

            {/* Checklist */}
            <Section style={{ border: `1px solid ${C.borderHi}` }}>
              <SectionTitle sub="Verify everything before submitting your game URL.">
                ✅ Pre-Submit Checklist
              </SectionTitle>
              <CodeBlock id="checklist" copied={copied} onCopy={copy} code={`Unity Source Project:
  ✅ Assets/WebGLTemplates/InitiaArcade/   ← WebGL template installed
  ✅ Player Settings → WebGL Template → InitiaArcade selected
  ✅ Width/Height set (e.g. 1080×1920 portrait)
  ✅ Assets/Plugins/WebGL/ArcadeBridge.jslib     ← jslib plugin in WebGL subfolder
  ✅ ArcadeManager.cs attached to empty GameObject (Singleton — DontDestroyOnLoad)
  ✅ gameId = "YOUR_GAME_ID" (fill in Inspector after approval)

WebGL Build Output (repo root — pushed to GitHub):
  ✅ arcade-sdk.js                               ← placed next to index.html
  ✅ index.html                                  ← WebGL template present
  ✅ Build/YourGame.wasm
  ✅ Build/YourGame.framework.js
  ✅ TemplateData/                               ← WebGL template assets present

Vercel:
  ✅ Repo connected, framework: Other
  ✅ Public URL works and game loads

After Admin Approval:
  ⬜ Paste Game ID into gameId field in Inspector (or in code)
  ⬜ Rebuild WebGL → place arcade-sdk.js next to index.html again
  ⬜ git push → Vercel auto-redeploys ✅`} />
            </Section>
          </div>
        )}

        {/* ════ API REFERENCE ════ */}
        {activeTab === "events" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Section>
              <SectionTitle sub={
                <>
                  All methods callable from C# via{" "}
                  <code style={{ background:"#050408",padding:"2px 6px",borderRadius:4,fontSize:11,color:C.muted }}>Application.ExternalCall()</code>
                  {" "}or JS via{" "}
                  <code style={{ background:"#050408",padding:"2px 6px",borderRadius:4,fontSize:11,color:C.muted }}>window.ArcadeSDK</code>
                </>
              }>
                API Reference
              </SectionTitle>

              {[
                {
                  signature: "arcade_init(gameId: string)",
                  color: C.green,
                  desc: "Initializes the SDK. Pass empty string on first deploy — update to real Game ID after admin approval.",
                  params: [["gameId","string","Your Game ID from the platform. Pass '' (empty) on first deploy."]],
                },
                {
                  signature: "arcade_updateScore(score: number)",
                  color: C.blue,
                  desc: "Sends real-time score to the platform UI. Does NOT trigger a blockchain transaction. Call frequently during gameplay.",
                  params: [["score","number","The player's current score"]],
                },
                {
                  signature: "arcade_gameOver(finalScore: number)",
                  color: C.purple,
                  desc: "Ends the session and submits final score on-chain. Auto-sign = no popup. 80% tokens to player, 20% to creator.",
                  params: [["finalScore","number","The player's final score for this session"]],
                },
                {
                  signature: "arcade_earnTokens(amount: number)",
                  color: C.gold,
                  desc: "Awards ARCADE tokens to the player for in-game achievements like collecting items or reaching milestones.",
                  params: [["amount","number","Number of ARCADE tokens to award"]],
                },
                {
                  signature: "arcade_buyItem(itemId: string, price: number)",
                  color: C.red,
                  desc: "Deducts ARCADE tokens from the player's wallet and registers the purchase on-chain. For in-game shops.",
                  params: [["itemId","string","Unique item identifier"],["price","number","Cost in ARCADE tokens"]],
                },
                {
                  signature: "arcade_unlockAchievement(achievementId: string)",
                  color: C.orange,
                  desc: "Unlocks an achievement badge — minted as an NFT stored in the player's Initia wallet.",
                  params: [["achievementId","string","e.g. 'first_kill', 'level_10'"]],
                },
                {
                  signature: "arcade_levelComplete(level: number, score: number)",
                  color: C.cyan,
                  desc: "Records level completion on-chain. Use for multi-level games to track per-level performance.",
                  params: [["level","number","Level number completed"],["score","number","Score achieved on this level"]],
                },
              ].map((api, i) => (
                <div key={i} style={{
                  marginBottom: 14, padding: 22,
                  background: "#050408", borderRadius: 10,
                  border: `1px solid ${C.border}`,
                }}>
                  <div style={{ marginBottom: 10 }}>
                    <code style={{
                      background: api.color + "15", color: api.color,
                      padding: "5px 14px", borderRadius: 6,
                      fontSize: 12, fontWeight: 600,
                      fontFamily: C.mono, border: `1px solid ${api.color}30`,
                    }}>{api.signature}</code>
                  </div>
                  <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.75, marginBottom: 14, fontFamily: C.ui }}>{api.desc}</p>
                  <div style={{
                    fontSize: 10, color: C.dim, textTransform: "uppercase",
                    letterSpacing: "0.8px", marginBottom: 8, fontFamily: C.ui, fontWeight: 700,
                  }}>Parameters</div>
                  {api.params.map(([name, type, pdesc]) => (
                    <div key={name} style={{
                      display: "flex", gap: 14,
                      padding: "9px 14px", background: C.surface,
                      borderRadius: 6, border: `1px solid ${C.border}`,
                      alignItems: "flex-start", marginBottom: 6,
                    }}>
                      <code style={{ color: api.color, fontSize: 11, minWidth: 130, flexShrink: 0, fontFamily: C.mono }}>{name}</code>
                      <code style={{ color: C.dim, fontSize: 11, minWidth: 60, flexShrink: 0, fontFamily: C.mono }}>{type}</code>
                      <span style={{ fontSize: 11, color: C.muted, lineHeight: 1.6, fontFamily: C.ui }}>{pdesc}</span>
                    </div>
                  ))}
                </div>
              ))}
            </Section>
          </div>
        )}

        {/* ════ EXAMPLES ════ */}
        {activeTab === "examples" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

            <Section>
              <SectionTitle sub="Real-time score, coin rewards, game over — complete runner integration.">
                Endless Runner
              </SectionTitle>
              <CodeBlock id="runner" copied={copied} onCopy={copy} code={`using UnityEngine;

public class RunnerGame : MonoBehaviour
{
    private int score = 0;
    private bool isGameOver = false;

    void Update()
    {
        if (isGameOver) return;
        score += Mathf.RoundToInt(Time.deltaTime * 10);
        if (score % 50 == 0)
            ArcadeManager.Instance.UpdateScore(score);
    }

    public void OnCoinCollected()
    {
        // optional: ArcadeManager handles token rewards via arcade_earnTokens
        // if your ArcadeBridge.jslib exposes it, add DllImport there too
    }

    public void OnObstacleHit()
    {
        isGameOver = true;
        ArcadeManager.Instance.SubmitScore(); // submits on-chain
    }
}`} />
            </Section>

            <Section>
              <SectionTitle sub="Wave-based tower defense with per-wave score updates and bonus token drops.">
                Tower Defense
              </SectionTitle>
              <CodeBlock id="tower" copied={copied} onCopy={copy} code={`using UnityEngine;

public class TowerDefenseManager : MonoBehaviour
{
    private int score = 0;

    public void OnEnemyKilled(int reward)
    {
        score += reward;
        ArcadeManager.Instance.UpdateScore(score);
    }

    public void OnWaveComplete(int waveNumber)
    {
        // level complete + bonus — add DllImport for these in ArcadeManager if needed
        Debug.Log("Wave " + waveNumber + " complete, score: " + score);
    }

    public void OnBaseDestroyed()
    {
        ArcadeManager.Instance.SubmitScore();
    }
}`} />
            </Section>

            <Section>
              <SectionTitle sub="ARCADE token shop — every purchase is registered on-chain.">
                In-Game Shop
              </SectionTitle>
              <CodeBlock id="shop" copied={copied} onCopy={copy} code={`using UnityEngine;

[System.Serializable]
public class ShopItem
{
    public string id;
    public string displayName;
    public int price;
}

public class GameShop : MonoBehaviour
{
    public ShopItem[] items = new ShopItem[]
    {
        new ShopItem { id = "sword_001",   displayName = "Iron Sword",    price = 100 },
        new ShopItem { id = "shield_001",  displayName = "Wooden Shield", price = 150 },
        new ShopItem { id = "potion_001",  displayName = "Health Potion", price = 50  },
        new ShopItem { id = "speed_boost", displayName = "Speed Boost",   price = 75  },
    };

    public void PurchaseItem(int itemIndex)
    {
        if (itemIndex < 0 || itemIndex >= items.Length) return;
        ShopItem item = items[itemIndex];
        Application.ExternalCall("arcade_buyItem", item.id, item.price);
    }
}`} />
            </Section>

            {/* CTA */}
            <div style={{
              background: "linear-gradient(135deg,rgba(123,47,255,0.12),rgba(0,212,255,0.06))",
              border: `1px solid ${C.borderHi}`,
              borderRadius: 14,
              padding: "28px 32px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 24,
            }}>
              <div>
                <div style={{
                  fontSize: 17, fontWeight: 700,
                  fontFamily: C.display,
                  background: `linear-gradient(90deg,${C.purple},${C.cyan})`,
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  marginBottom: 8, letterSpacing: "0.3px",
                }}>Ready to publish?</div>
                <div style={{ fontSize: 13, color: C.muted, fontFamily: C.ui }}>
                  Deploy to Vercel, submit your URL, and start earning ARCADE tokens from every play.
                </div>
              </div>
              <Link to="/publish" style={{
                padding: "12px 28px",
                background: `linear-gradient(135deg,${C.purple},#5a1fd4)`,
                borderRadius: 10, color: "#fff",
                fontSize: 13, fontWeight: 700,
                textDecoration: "none",
                fontFamily: C.ui, letterSpacing: "0.5px",
                flexShrink: 0,
                boxShadow: "0 4px 16px rgba(123,47,255,0.3)",
              }}>
                Publish Your Game →
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}