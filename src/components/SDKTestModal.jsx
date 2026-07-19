// src/components/SDKTestModal.jsx
//
// Pre-launch SDK verification modal — tests whether a game correctly
// integrates the ArcadeX SDK before it goes live. Works by loading the
// game in a sandboxed iframe and listening for postMessage events that
// the SDK sends (all tagged with _arcadex: true).
//
// Props:
//   iframeUrl  — the game's iframe URL
//   gameName   — displayed in the modal header
//   onClose    — called when the user closes the modal
//
// Usage (in CreatorGameDetail.jsx or Admin.jsx):
//   <SDKTestModal iframeUrl={game.iframeUrl} gameName={game.name} onClose={() => setShowTest(false)} />

import { useState, useEffect, useRef, useCallback } from "react";

// ── Design tokens (matches ArcadeX's existing palette) ──────────────────
const C = {
  bg: "#08070f",
  surface: "#0e0c1a",
  border: "rgba(123,47,255,0.15)",
  borderBright: "rgba(123,47,255,0.35)",
  purple: "#7B2FFF",
  cyan: "#00d4ff",
  green: "#00FF88",
  yellow: "#FFB700",
  red: "#ff4444",
  dim: "#5533aa",
  dimmer: "#3a2a5a",
  raj: "'Rajdhani', sans-serif",
  orb: "'Orbitron', sans-serif",
};

// ── Checklist definition ─────────────────────────────────────────────────
const CHECKS = [
  {
    id: "sdk_ready",
    label: "SDK Initialized",
    desc: "ArcadeSDK.init() was called",
    trigger: "ARCADE_SDK_READY",
    required: true,
  },
  {
    id: "score_update",
    label: "Score Updates",
    desc: "ArcadeSDK.updateScore() fired at least once",
    trigger: "SCORE_UPDATE",
    required: true,
  },
  {
    id: "game_over",
    label: "Game Over",
    desc: "ArcadeSDK.gameOver() called with a valid score",
    trigger: "GAME_OVER",
    required: true,
    validate: (event) => event.score > 0,
  },
  {
    id: "pause_resume",
    label: "Pause / Resume",
    desc: "ArcadeSDK.pause() and resume() fire correctly",
    triggers: ["GAME_PAUSED", "GAME_RESUMED"],
    required: false,
  },
  {
    id: "no_spam",
    label: "No Event Spam",
    desc: "No single event type fires more than 20 times",
    required: false,
  },
];

const initialChecks = () =>
  Object.fromEntries(CHECKS.map(c => [c.id, { status: "pending", detail: null }]));

export default function SDKTestModal({ iframeUrl, gameName, onClose }) {
  const iframeRef = useRef(null);
  const [checks, setChecks] = useState(initialChecks);
  const [events, setEvents] = useState([]);
  const [eventCounts, setEventCounts] = useState({});
  const [started, setStarted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef(null);
  const startTimeRef = useRef(null);

  // ── Use a ref to track started so the postMessage listener always
  //    sees the current value without needing to re-register ──────────
  const startedRef = useRef(false);
  useEffect(() => { startedRef.current = started; }, [started]);

  const checksRef = useRef(checks);
  useEffect(() => { checksRef.current = checks; }, [checks]);

  const iframeRefCallback = useRef(null);
  iframeRefCallback.current = iframeRef.current;

  const pass = (id, detail = null) =>
    setChecks(prev => ({ ...prev, [id]: { status: "pass", detail } }));

  const fail = (id, detail = null) =>
    setChecks(prev => ({ ...prev, [id]: { status: "fail", detail } }));

  const warn = (id, detail = null) =>
    setChecks(prev => ({ ...prev, [id]: { status: "warning", detail } }));

  const addEvent = useCallback((type, data) => {
    const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
    setEvents(prev => [{ ts, type, data, id: Date.now() + Math.random() }, ...prev].slice(0, 50));
    setEventCounts(prev => {
      const next = { ...prev, [type]: (prev[type] || 0) + 1 };
      if (next[type] > 20) {
        warn("no_spam", `"${type}" fired ${next[type]} times`);
      } else if (!Object.values(next).some(v => v > 20)) {
        pass("no_spam");
      }
      return next;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── postMessage listener — registered once, uses ref for `started` ──
  useEffect(() => {
    const KNOWN_TYPES = [
      "ARCADE_SDK_READY", "SDK_READY",         // SDK_READY = InitiaArcade SDK v1.0.1 alias
      "SCORE_UPDATE", "GAME_OVER",
      "GAME_PAUSED", "GAME_RESUMED", "GAME_START",
      "TRANSACTION_SUCCESS", "TRANSACTION_FAILED", "WALLET_CONNECTED",
    ];

    const handleMessage = (e) => {
      const d = e.data;
      if (!d || typeof d !== "object") return;

      // _arcadex = new ArcadeX SDK | _sdk = old InitiaArcade SDK v1.0.1
      const isArcadeMsg = d._arcadex === true || d._sdk === true || KNOWN_TYPES.includes(d.type);
      if (!isArcadeMsg) return;

      // Always log the event
      addEvent(d.type, d);

      // FIX: read from ref, not the stale closure variable
      if (!startedRef.current) return;

      const iframe = iframeRef.current;

      switch (d.type) {
        case "ARCADE_SDK_READY":
        case "SDK_READY":          // InitiaArcade SDK v1.0.1
          pass("sdk_ready", `gameId: "${d.gameId ?? "—"}"`);
          // Send GAME_START back so the game knows it's in the platform
          iframe?.contentWindow?.postMessage(
            { _platform: true, type: "GAME_START" }, "*"
          );
          break;

        case "SCORE_UPDATE":
          if (d.score >= 0) pass("score_update", `score: ${d.score}`);
          break;

        case "GAME_OVER":
          if (d.score > 0) {
            pass("game_over", `final score: ${d.score}`);
            iframe?.contentWindow?.postMessage(
              { _platform: true, type: "TRANSACTION_SUCCESS", txHash: "0xTEST_MOCK_HASH" }, "*"
            );
          } else {
            fail("game_over", `score was ${d.score} — must be > 0`);
          }
          break;

        case "GAME_PAUSED":
        case "GAME_RESUMED":
          setChecks(prev => ({
            ...prev,
            pause_resume: {
              status: prev.pause_resume.status === "pass" ? "pass" : "warning",
              detail: d.type === "GAME_PAUSED" ? "paused ✓" : "resumed ✓",
            },
          }));
          if (d.type === "GAME_RESUMED") pass("pause_resume", "pause → resume cycle ✓");
          break;

        default:
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [addEvent]); // addEvent is stable (useCallback with empty deps)

  // ── Timer + SDK_READY timeout ────────────────────────────────────────
  useEffect(() => {
    if (!started) return;
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);

    const sdkTimeout = setTimeout(() => {
      setChecks(prev => {
        if (prev.sdk_ready.status === "pending") {
          return { ...prev, sdk_ready: { status: "fail", detail: "Not received within 15 seconds" } };
        }
        return prev;
      });
    }, 15000);

    return () => {
      clearInterval(timerRef.current);
      clearTimeout(sdkTimeout);
    };
  }, [started]);

  // ── Derived state ────────────────────────────────────────────────────
  const requiredChecks = CHECKS.filter(c => c.required);
  const allRequiredPass = requiredChecks.every(c => checks[c.id].status === "pass");
  const anyRequiredFail = requiredChecks.some(c => checks[c.id].status === "fail");

  const overallStatus = !started
    ? "idle"
    : anyRequiredFail
    ? "fail"
    : allRequiredPass
    ? "pass"
    : "running";

  const statusColor = {
    idle: C.dim,
    running: C.yellow,
    pass: C.green,
    fail: C.red,
  }[overallStatus];

  const statusLabel = {
    idle: "Ready to test",
    running: `Testing… ${elapsed}s`,
    pass: "All checks passed",
    fail: "Test failed",
  }[overallStatus];

  const checkIcon = (status) => ({
    pending: <span style={{ color: C.dimmer, fontSize: 14 }}>○</span>,
    pass: <span style={{ color: C.green, fontSize: 14 }}>✓</span>,
    fail: <span style={{ color: C.red, fontSize: 14 }}>✗</span>,
    warning: <span style={{ color: C.yellow, fontSize: 14 }}>⚠</span>,
  })[status] || null;

  const eventColor = (type) => {
    if (type === "ARCADE_SDK_READY") return C.cyan;
    if (type === "GAME_OVER") return C.green;
    if (type === "SCORE_UPDATE") return C.purple;
    if (type.includes("PAUSE") || type.includes("RESUME")) return C.yellow;
    return C.dim;
  };

  const handleStart = () => {
    setChecks(initialChecks());
    setEvents([]);
    setEventCounts({});
    setElapsed(0);
    setStarted(true);
    // Reload iframe to start fresh
    if (iframeRef.current) {
      iframeRef.current.src = iframeUrl;
    }
  };

  const handleReset = () => {
    setStarted(false);
    setChecks(initialChecks());
    setEvents([]);
    setEventCounts({});
    setElapsed(0);
    clearInterval(timerRef.current);
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "rgba(5,4,12,0.92)", backdropFilter: "blur(12px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 16,
    }}>
      <div style={{
        width: "100%", maxWidth: 1080, maxHeight: "92vh",
        background: C.bg, border: `1px solid ${C.borderBright}`,
        borderRadius: 16, overflow: "hidden", display: "flex", flexDirection: "column",
        boxShadow: `0 24px 80px rgba(123,47,255,0.25)`,
      }}>

        {/* ── Header ── */}
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
          <div style={{ fontFamily: C.orb, fontWeight: 700, fontSize: 11, color: C.purple, letterSpacing: "2px", textTransform: "uppercase" }}>SDK Test</div>
          <div style={{ height: 14, width: 1, background: C.border }} />
          <div style={{ fontFamily: C.raj, fontWeight: 700, fontSize: 14, color: "#c4a0ff" }}>{gameName}</div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            {started && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 12px", borderRadius: 20, background: `${statusColor}15`, border: `1px solid ${statusColor}44` }}>
                {overallStatus === "running" && (
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor, animation: "sdkPulse 1s ease-in-out infinite" }} />
                )}
                <span style={{ fontFamily: C.raj, fontWeight: 700, fontSize: 11, color: statusColor }}>{statusLabel}</span>
              </div>
            )}
            <button onClick={onClose} style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 4 }}>✕</button>
          </div>
        </div>

        {/* ── Body ── */}
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>

          {/* Game iframe */}
          <div style={{ flex: 1, background: "#000", position: "relative", minWidth: 0 }}>
            {!started ? (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20 }}>
                <div style={{ fontFamily: C.orb, fontSize: 28, color: C.purple, opacity: 0.15, letterSpacing: "-1px" }}>🧪</div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontFamily: C.raj, fontWeight: 700, fontSize: 16, color: "#c4a0ff", marginBottom: 8 }}>Ready to run SDK test</div>
                  <div style={{ fontSize: 11, color: C.dim, fontFamily: C.raj, maxWidth: 260, lineHeight: 1.6 }}>
                    The game will load and we'll listen for SDK events in real time.
                  </div>
                </div>
                <button onClick={handleStart} style={{
                  padding: "11px 28px", background: `linear-gradient(135deg, ${C.purple}, #5a1fd4)`,
                  border: "none", borderRadius: 8, color: "#fff", fontSize: 13, fontWeight: 700,
                  cursor: "pointer", fontFamily: C.raj, letterSpacing: "0.5px",
                }}>
                  ▶ Start Test
                </button>
              </div>
            ) : (
              <iframe
                ref={iframeRef}
                src={iframeUrl}
                title={`SDK Test — ${gameName}`}
                style={{ width: "100%", height: "100%", border: "none" }}
                allow="autoplay; fullscreen"
                sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock"
              />
            )}
          </div>

          {/* Right panel */}
          <div style={{ width: 300, flexShrink: 0, borderLeft: `1px solid ${C.border}`, display: "flex", flexDirection: "column" }}>

            {/* Checklist */}
            <div style={{ padding: "14px 16px", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ fontFamily: C.raj, fontWeight: 700, fontSize: 9, color: C.dim, textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 10 }}>Checklist</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {CHECKS.map(check => {
                  const s = checks[check.id];
                  return (
                    <div key={check.id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <div style={{ width: 16, flexShrink: 0, paddingTop: 1 }}>{checkIcon(s.status)}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontFamily: C.raj, fontWeight: 700, fontSize: 12, color: s.status === "pending" ? C.dimmer : s.status === "pass" ? "#e5e5e5" : s.status === "fail" ? C.red : C.yellow }}>
                            {check.label}
                          </span>
                          {!check.required && (
                            <span style={{ fontSize: 8, color: C.dim, fontFamily: C.raj, background: "rgba(85,51,170,0.15)", padding: "1px 5px", borderRadius: 3 }}>optional</span>
                          )}
                        </div>
                        <div style={{ fontSize: 9, color: C.dim, fontFamily: C.raj, marginTop: 1 }}>{s.detail || check.desc}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Event log */}
            <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
              <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontFamily: C.raj, fontWeight: 700, fontSize: 9, color: C.dim, textTransform: "uppercase", letterSpacing: "1.5px" }}>Event Log</div>
                {events.length > 0 && (
                  <div style={{ fontSize: 8, color: C.dim, fontFamily: C.raj }}>{events.length} events</div>
                )}
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
                {events.length === 0 ? (
                  <div style={{ padding: "20px 16px", textAlign: "center", color: C.dimmer, fontSize: 10, fontFamily: C.raj }}>
                    {started ? "Waiting for SDK events…" : "Start test to see events"}
                  </div>
                ) : events.map(ev => (
                  <div key={ev.id} style={{ padding: "5px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <span style={{ fontSize: 8, color: C.dimmer, fontFamily: "monospace", flexShrink: 0, paddingTop: 1 }}>{ev.ts}</span>
                    <span style={{ fontSize: 9, fontWeight: 700, color: eventColor(ev.type), fontFamily: C.raj, flexShrink: 0 }}>{ev.type}</span>
                    {ev.data?.score !== undefined && (
                      <span style={{ fontSize: 8, color: C.dim, fontFamily: "monospace", marginLeft: "auto" }}>score: {ev.data.score}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Footer actions */}
            <div style={{ padding: "12px 16px", borderTop: `1px solid ${C.border}`, display: "flex", gap: 8 }}>
              {started ? (
                <>
                  <button onClick={handleReset} style={{ flex: 1, padding: "8px 0", background: "rgba(85,51,170,0.12)", border: `1px solid ${C.border}`, borderRadius: 7, color: "#a67fff", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: C.raj }}>
                    ↺ Reset
                  </button>
                  <button onClick={handleStart} style={{ flex: 1, padding: "8px 0", background: "rgba(123,47,255,0.12)", border: `1px solid rgba(123,47,255,0.3)`, borderRadius: 7, color: C.purple, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: C.raj }}>
                    ▶ Re-run
                  </button>
                </>
              ) : (
                <button onClick={handleStart} style={{ flex: 1, padding: "9px 0", background: `linear-gradient(135deg, ${C.purple}, #5a1fd4)`, border: "none", borderRadius: 7, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: C.raj }}>
                  ▶ Start Test
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes sdkPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.35; transform: scale(1.5); }
        }
      `}</style>
    </div>
  );
}