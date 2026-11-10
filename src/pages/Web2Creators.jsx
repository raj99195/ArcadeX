// src/pages/Web2Creators.jsx
//
// Full Web2 creator portal — mirrors the Web3 Creator.jsx flow but off-chain.
// Sections:
//   • Not signed in           → sign-in nudge
//   • Signed in, not creator  → onboarding card (register)
//   • Creator                 → tabs: Dashboard | Submit Game | My Games
//   • Admin (email allow-list) → extra tab: Admin Queue
//
// All data lives in Firestore (web2Creators / web2Games); approved games
// are mirrored into the `games` collection so useGames() picks them up.

import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useWeb2Auth } from "../hooks/useWeb2Auth";
import { Icon } from "../components/Icon";

const C = {
  bg: "#07090e",
  cyan: "#00d4ff", cyanD: "#0088ff", cyanL: "#9ee8ff",
  gold: "#FFD56A", goldD: "#b58500",
  purple: "#c4a0ff",
  green: "#00FF88", red: "#ff6b7f",
  dim: "#6fb8d4", dimMore: "#5a7f93",
  raj: "'Rajdhani',sans-serif", orb: "'Orbitron',sans-serif",
};

const STATUS = {
  approved: { bg: "rgba(0,255,136,0.1)", color: "#00FF88", border: "rgba(0,255,136,0.3)", label: "Live",            icon: "check" },
  pending:  { bg: "rgba(255,183,0,0.1)", color: "#FFB700", border: "rgba(255,183,0,0.3)", label: "Pending Review",  icon: "clock" },
  rejected: { bg: "rgba(255,68,68,0.1)", color: "#ff4444", border: "rgba(255,68,68,0.3)", label: "Rejected",        icon: "x" },
  banned:   { bg: "rgba(255,68,68,0.1)", color: "#ff4444", border: "rgba(255,68,68,0.3)", label: "Banned",          icon: "ban" },
};

const CATEGORIES = ["Action", "Runner", "Strategy", "Puzzle", "Casual", "Shooter", "Adventure"];

async function apiAuth(user, path, opts = {}) {
  if (!user?.firebaseUser) throw new Error("Sign in required.");
  const idToken = await user.firebaseUser.getIdToken();
  const r = await fetch(path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
      ...(opts.headers || {}),
    },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

// ── Shared field styles ─────────────────────────────────────────────
const inputStyle = {
  width: "100%", boxSizing: "border-box",
  padding: "10px 12px",
  background: "rgba(0,212,255,0.05)",
  border: "1px solid rgba(0,212,255,0.2)",
  borderRadius: 8,
  color: "#e8f4ff", fontSize: 13,
  fontFamily: C.raj, outline: "none",
};
const labelStyle = {
  display: "block", fontSize: 10, fontWeight: 700, color: C.dim,
  marginBottom: 6, fontFamily: C.raj,
  textTransform: "uppercase", letterSpacing: "1.4px",
};

// ── Pieces ─────────────────────────────────────────────────────────
function StatusChip({ status, size = 10 }) {
  const s = STATUS[status] || STATUS.pending;
  return (
    <span style={{
      padding: "3px 9px", borderRadius: 20,
      background: s.bg, border: `1px solid ${s.border}`, color: s.color,
      fontFamily: C.raj, fontSize: size, fontWeight: 700,
      letterSpacing: "0.5px",
      display: "inline-flex", alignItems: "center", gap: 4,
    }}>
      <Icon name={s.icon} size={size + 2} />
      {s.label}
    </span>
  );
}

function StatCard({ label, value, iconName, accent = C.cyan }) {
  return (
    <div style={{
      padding: "14px 16px",
      background: "rgba(6,12,18,0.82)",
      border: `1px solid ${accent}30`,
      borderRadius: 12,
      backdropFilter: "blur(16px)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <Icon name={iconName} size={16} color={accent} />
        <span style={{
          fontFamily: C.raj, fontSize: 10, fontWeight: 700,
          color: accent, textTransform: "uppercase", letterSpacing: "1.4px",
        }}>{label}</span>
      </div>
      <div style={{ fontFamily: C.orb, fontWeight: 700, fontSize: 22, color: "#fff" }}>
        {value}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children, badge }) {
  return (
    <button onClick={onClick} style={{
      padding: "10px 18px",
      background: "transparent", border: "none",
      borderBottom: active ? `2px solid ${C.cyan}` : "2px solid transparent",
      color: active ? C.cyanL : C.dimMore,
      fontFamily: C.raj, fontWeight: 700, fontSize: 12,
      letterSpacing: "0.6px", textTransform: "uppercase",
      cursor: "pointer", marginBottom: "-1px",
      display: "inline-flex", alignItems: "center", gap: 7,
      transition: "color 0.18s",
    }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.color = C.cyanL; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.color = C.dimMore; }}
    >
      {children}
      {badge > 0 && (
        <span style={{
          padding: "1px 7px", borderRadius: 20,
          background: "rgba(255,183,0,0.2)", border: "1px solid rgba(255,183,0,0.4)",
          color: "#FFB700", fontFamily: C.orb, fontSize: 10, fontWeight: 700,
        }}>{badge}</span>
      )}
    </button>
  );
}

// ─── Sign-in nudge ─────────────────────────────────────────────────
function SignInNudge() {
  return (
    <div style={{ padding: 60, textAlign: "center" }}>
      <div style={{ marginBottom: 14, color: C.dim, display: "flex", justifyContent: "center" }}>
        <Icon name="lock" size={56} />
      </div>
      <div style={{ fontFamily: C.raj, fontWeight: 700, fontSize: 20, color: "#fff", marginBottom: 8 }}>
        Sign in to publish games
      </div>
      <div style={{ fontFamily: C.raj, fontSize: 13, color: C.dim, maxWidth: 420, margin: "0 auto" }}>
        Creators sign in with Google or X. Guest accounts can play but can't
        publish — earnings need an account to attach to.
      </div>
    </div>
  );
}

// ─── Onboarding card ───────────────────────────────────────────────
function OnboardingCard({ user, onRegister, busy, error }) {
  const [displayName, setDisplayName] = useState(user?.displayName || "");
  const [bio, setBio] = useState("");
  const submit = (e) => { e.preventDefault(); onRegister({ displayName, bio }); };

  return (
    <form onSubmit={submit} style={{
      padding: "28px 26px",
      background: "rgba(6,12,18,0.86)",
      border: "1px solid rgba(0,212,255,0.25)",
      borderRadius: 16, backdropFilter: "blur(16px)",
      maxWidth: 540, margin: "0 auto",
      boxShadow: `0 12px 32px rgba(0,0,0,0.5), 0 0 24px rgba(0,212,255,0.1)`,
    }}>
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <div style={{ marginBottom: 10, color: C.cyan, display: "flex", justifyContent: "center" }}>
          <Icon name="controller" size={44} />
        </div>
        <h2 style={{
          fontFamily: C.raj, fontWeight: 700, fontSize: 24, color: "#fff",
          margin: 0, textTransform: "uppercase", letterSpacing: "-0.3px",
        }}>Become a Creator</h2>
        <p style={{ fontFamily: C.raj, fontSize: 12, color: C.dim, marginTop: 6 }}>
          Publish HTML5 games · Earn a share of every play · No wallet needed
        </p>
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>Creator name</label>
        <input value={displayName} onChange={e => setDisplayName(e.target.value)}
          maxLength={40} placeholder="How players will see you" style={inputStyle} required />
      </div>

      <div style={{ marginBottom: 18 }}>
        <label style={labelStyle}>Short bio (optional)</label>
        <textarea value={bio} onChange={e => setBio(e.target.value)}
          maxLength={400} rows={3} placeholder="Tell players what you make."
          style={{ ...inputStyle, resize: "vertical", minHeight: 70 }} />
      </div>

      {error && (
        <div style={{
          marginBottom: 14, padding: "10px 14px",
          background: "rgba(255,68,88,0.08)", border: "1px solid rgba(255,68,88,0.3)",
          borderRadius: 10, color: C.red, fontFamily: C.raj, fontSize: 12,
        }}>{error}</div>
      )}

      <button type="submit" disabled={busy} style={{
        width: "100%", padding: "12px",
        background: busy ? "rgba(0,212,255,0.3)" : `linear-gradient(135deg, ${C.cyan}, ${C.cyanD})`,
        border: "none", borderRadius: 10, color: "#001018",
        fontFamily: C.raj, fontWeight: 800, fontSize: 13,
        letterSpacing: "1.5px", textTransform: "uppercase",
        cursor: busy ? "not-allowed" : "pointer",
        boxShadow: busy ? "none" : `0 6px 24px ${C.cyan}40`,
      }}>
        {busy ? "Registering…" : "Register as Creator"}
      </button>

      <div style={{
        marginTop: 14, fontFamily: C.raj, fontSize: 11,
        color: C.dimMore, textAlign: "center",
      }}>
        By registering you agree your games will be reviewed before going live.
      </div>
    </form>
  );
}

// ─── Submit game form ──────────────────────────────────────────────
function SubmitGameForm({ onSubmit, busy }) {
  const [form, setForm] = useState({
    name: "", description: "", iframeUrl: "", thumbnailUrl: "",
    category: "Casual", rewardRate: 50,
  });
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const submit = async (e) => {
    e.preventDefault();
    setError(""); setOk("");
    try {
      await onSubmit(form);
      setOk("Submitted! Your game is now in the admin review queue.");
      setForm({ name: "", description: "", iframeUrl: "", thumbnailUrl: "", category: "Casual", rewardRate: 50 });
    } catch (e) { setError(e.message || "Submission failed."); }
  };

  return (
    <form onSubmit={submit} style={{
      padding: "22px 24px",
      background: "rgba(6,12,18,0.82)",
      border: "1px solid rgba(0,212,255,0.2)",
      borderRadius: 14, backdropFilter: "blur(16px)",
    }}>
      <h3 style={{
        fontFamily: C.raj, fontWeight: 700, fontSize: 17, color: "#fff",
        margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "-0.2px",
      }}>Submit a game</h3>
      <p style={{ fontFamily: C.raj, fontSize: 12, color: C.dim, marginTop: 0, marginBottom: 18 }}>
        Your game will enter the review queue. Approved games appear in the library.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>Game name <span style={{ color: C.red }}>*</span></label>
          <input value={form.name} onChange={e => update("name", e.target.value)}
            maxLength={60} required style={inputStyle} />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>Description</label>
          <textarea value={form.description} onChange={e => update("description", e.target.value)}
            maxLength={400} rows={2} style={{ ...inputStyle, resize: "vertical", minHeight: 60 }} />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>iframe URL <span style={{ color: C.red }}>*</span></label>
          <input type="url" value={form.iframeUrl} onChange={e => update("iframeUrl", e.target.value)}
            placeholder="https://your-game.io/play" required style={inputStyle} />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>Thumbnail URL</label>
          <input type="url" value={form.thumbnailUrl} onChange={e => update("thumbnailUrl", e.target.value)}
            placeholder="https://.../thumb.jpg (16:10 looks best)" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Category</label>
          <select value={form.category} onChange={e => update("category", e.target.value)} style={inputStyle}>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>
            Reward rate (<Icon name="coin" size={10} style={{ verticalAlign: "-1px" }} /> / play)
          </label>
          <input type="number" min={1} max={500} value={form.rewardRate}
            onChange={e => update("rewardRate", e.target.value)} style={inputStyle} />
        </div>
      </div>

      {error && (
        <div style={{
          marginBottom: 12, padding: "10px 14px",
          background: "rgba(255,68,88,0.08)", border: "1px solid rgba(255,68,88,0.3)",
          borderRadius: 10, color: C.red, fontFamily: C.raj, fontSize: 12,
        }}>{error}</div>
      )}
      {ok && (
        <div style={{
          marginBottom: 12, padding: "10px 14px",
          background: "rgba(0,255,136,0.08)", border: "1px solid rgba(0,255,136,0.3)",
          borderRadius: 10, color: C.green, fontFamily: C.raj, fontSize: 12, fontWeight: 700,
          display: "flex", alignItems: "center", gap: 8,
        }}><Icon name="check" size={14} />{ok}</div>
      )}

      <button type="submit" disabled={busy} style={{
        width: "100%", padding: "12px",
        background: busy ? "rgba(0,212,255,0.3)" : `linear-gradient(135deg, ${C.cyan}, ${C.cyanD})`,
        border: "none", borderRadius: 10, color: "#001018",
        fontFamily: C.raj, fontWeight: 800, fontSize: 13,
        letterSpacing: "1.4px", textTransform: "uppercase",
        cursor: busy ? "not-allowed" : "pointer",
      }}>
        {busy ? "Submitting…" : "Submit for Review"}
      </button>
    </form>
  );
}

// ─── My games list ────────────────────────────────────────────────
function MyGamesList({ games, onDelete, onPlay }) {
  if (!games?.length) {
    return (
      <div style={{ padding: 48, textAlign: "center" }}>
        <div style={{ marginBottom: 12, color: C.dim, display: "flex", justifyContent: "center" }}>
          <Icon name="box" size={48} />
        </div>
        <div style={{ fontFamily: C.raj, fontWeight: 700, fontSize: 15, color: C.cyanL, marginBottom: 4 }}>
          No games yet
        </div>
        <div style={{ fontFamily: C.raj, fontSize: 12, color: C.dimMore }}>
          Submit your first game from the "Submit Game" tab.
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {games.map(g => (
        <div key={g.id} style={{
          display: "grid",
          gridTemplateColumns: "80px 1fr auto",
          gap: 14, alignItems: "center",
          padding: 12,
          background: "rgba(6,12,18,0.82)",
          border: "1px solid rgba(0,212,255,0.18)",
          borderRadius: 12,
        }}>
          <div style={{
            width: 80, height: 60, borderRadius: 8, overflow: "hidden",
            background: "#0e0c1a", border: "1px solid rgba(0,212,255,0.2)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {g.thumbnailUrl ? (
              <img src={g.thumbnailUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }}
                onError={e => { e.target.style.display = "none"; }} />
            ) : (
              <span style={{ color: C.dim, opacity: 0.7 }}><Icon name="controller" size={22} /></span>
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontFamily: C.raj, fontWeight: 700, fontSize: 15, color: "#fff",
              marginBottom: 3,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{g.name}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
              <StatusChip status={g.status} size={9} />
              <span style={{ fontFamily: C.raj, fontSize: 11, color: C.dim, display: "inline-flex", alignItems: "center", gap: 4 }}>
                {g.category} · <Icon name="coin" size={11} /> {g.rewardRate}/play
              </span>
            </div>
            {g.status === "rejected" && g.rejectionReason && (
              <div style={{ fontFamily: C.raj, fontSize: 11, color: C.red, marginTop: 2 }}>
                Reason: {g.rejectionReason}
              </div>
            )}
            {g.status === "approved" && (
              <div style={{ fontFamily: C.raj, fontSize: 11, color: C.dim, display: "inline-flex", alignItems: "center", gap: 4 }}>
                {g.plays || 0} plays · {Number(g.totalCoinsPaid || 0).toLocaleString()} <Icon name="coin" size={11} /> paid out
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, flexDirection: "column" }}>
            {g.status === "approved" && g.mirrorGameId && (
              <button onClick={() => onPlay(g.mirrorGameId)} style={{
                padding: "6px 12px",
                background: "rgba(0,255,136,0.1)", border: "1px solid rgba(0,255,136,0.3)",
                borderRadius: 8, color: C.green,
                fontFamily: C.raj, fontWeight: 700, fontSize: 11,
                letterSpacing: "0.5px", textTransform: "uppercase",
                cursor: "pointer", whiteSpace: "nowrap",
                display: "inline-flex", alignItems: "center", gap: 5,
              }}><Icon name="play" size={11} fill="currentColor" /> Play</button>
            )}
            {g.status !== "approved" && (
              <button onClick={() => onDelete(g.id)} style={{
                padding: "6px 12px",
                background: "rgba(255,68,88,0.08)", border: "1px solid rgba(255,68,88,0.28)",
                borderRadius: 8, color: C.red,
                fontFamily: C.raj, fontWeight: 700, fontSize: 11,
                letterSpacing: "0.5px", textTransform: "uppercase",
                cursor: "pointer", whiteSpace: "nowrap",
                display: "inline-flex", alignItems: "center", gap: 5,
              }}><Icon name="x" size={11} /> Delete</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Create Tournament form (inside Admin Queue) ──────────────────
function CreateTournamentForm({ user, onCreated }) {
  const [games, setGames] = useState([]);
  const [form, setForm] = useState({
    gameId: "", entryFee: 50, maxPlayers: 10,
    startInMinutes: 5, durationHours: 24,
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/games?action=list");
        const d = await r.json();
        setGames(d.games || []);
      } catch {}
    })();
  }, []);

  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const submit = async (e) => {
    e.preventDefault(); setMsg(null); setBusy(true);
    try {
      const startTime = Date.now() + Math.max(0, Number(form.startInMinutes) || 0) * 60_000;
      const res = await apiAuth(user, "/api/games?action=web2-tournament-create", {
        method: "POST",
        body: JSON.stringify({
          gameId: form.gameId,
          entryFee: Number(form.entryFee),
          maxPlayers: Number(form.maxPlayers),
          startTime,
          durationHours: Number(form.durationHours),
        }),
      });
      setMsg({ type: "ok", text: `Tournament created (id ${res.id})` });
      setForm({ gameId: "", entryFee: 50, maxPlayers: 10, startInMinutes: 5, durationHours: 24 });
      onCreated?.();
    } catch (e) { setMsg({ type: "err", text: e.message || "Create failed." }); }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} style={{
      padding: "16px 18px",
      background: "rgba(255,183,0,0.04)",
      border: "1px solid rgba(255,183,0,0.25)",
      borderRadius: 12, marginBottom: 18,
    }}>
      <div style={{
        fontFamily: C.raj, fontSize: 11, fontWeight: 700, color: "#FFB700",
        textTransform: "uppercase", letterSpacing: "1.6px", marginBottom: 12,
        display: "inline-flex", alignItems: "center", gap: 6,
      }}><Icon name="plus" size={13} /> Create Tournament</div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>Game <span style={{ color: C.red }}>*</span></label>
          <select value={form.gameId} onChange={e => update("gameId", e.target.value)} required style={inputStyle}>
            <option value="">— Pick a game —</option>
            {games.map(g => (
              <option key={g.id || g.gameId} value={g.id || g.gameId}>
                {g.name} {g.source === "web2" ? "(Web2)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>
            Entry fee (<Icon name="coin" size={10} style={{ verticalAlign: "-1px" }} />)
          </label>
          <input type="number" min={0} max={10000} value={form.entryFee}
            onChange={e => update("entryFee", e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Max players</label>
          <input type="number" min={2} max={1000} value={form.maxPlayers}
            onChange={e => update("maxPlayers", e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Starts in (minutes)</label>
          <input type="number" min={0} max={10080} value={form.startInMinutes}
            onChange={e => update("startInMinutes", e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Duration (hours)</label>
          <input type="number" min={1} max={720} value={form.durationHours}
            onChange={e => update("durationHours", e.target.value)} style={inputStyle} />
        </div>
      </div>

      {msg && (
        <div style={{
          marginBottom: 10, padding: "8px 12px",
          background: msg.type === "ok" ? "rgba(0,255,136,0.08)" : "rgba(255,68,88,0.08)",
          border: `1px solid ${msg.type === "ok" ? "rgba(0,255,136,0.3)" : "rgba(255,68,88,0.3)"}`,
          borderRadius: 8, fontFamily: C.raj, fontSize: 11,
          color: msg.type === "ok" ? C.green : C.red, fontWeight: 700,
          display: "flex", alignItems: "center", gap: 7,
        }}>
          <Icon name={msg.type === "ok" ? "check" : "warning"} size={12} />
          {msg.text}
        </div>
      )}

      <button type="submit" disabled={busy || !form.gameId} style={{
        width: "100%", padding: 11,
        background: busy || !form.gameId ? "rgba(255,183,0,0.2)" : "linear-gradient(135deg, #FFB700, #FF8800)",
        border: "none", borderRadius: 10,
        color: busy || !form.gameId ? "#5a4800" : "#1a0f00",
        fontFamily: C.raj, fontWeight: 800, fontSize: 12,
        letterSpacing: "1.4px", textTransform: "uppercase",
        cursor: busy || !form.gameId ? "not-allowed" : "pointer",
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
      }}>
        {busy ? "Creating…" : <><Icon name="trophy" size={13} /> Create Tournament</>}
      </button>
    </form>
  );
}

// ─── Admin queue ──────────────────────────────────────────────────
function AdminQueue({ user, onRefresh }) {
  const [pending, setPending]       = useState([]);
  const [creators, setCreators]     = useState([]);
  const [allGames, setAllGames]     = useState([]);
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [busy, setBusy]             = useState(null);
  const [tab, setTab]               = useState("games");
  const [gameFilter, setGameFilter] = useState("all"); // all | web3 | web2

  const loadTournaments = async () => {
    try {
      const r = await fetch("/api/games?action=web2-tournaments");
      const d = await r.json();
      setTournaments(d.tournaments || []);
    } catch {}
  };
  useEffect(() => { loadTournaments(); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiAuth(user, "/api/games?action=web2-admin-queue");
      setPending(data.pending || []);
      setCreators(data.creators || []);
      setAllGames(data.allGames || []);
    } catch (e) { console.warn(e); }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const moderate = async (payload) => {
    setBusy(`${payload.kind}:${payload.id}:${payload.action}`);
    try {
      await apiAuth(user, "/api/games?action=web2-admin-moderate", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await load();
      onRefresh?.();
    } catch (e) { alert(e.message || "Action failed"); }
    finally { setBusy(null); }
  };

  const approve = (id) => moderate({ kind: "game", id, action: "approve" });
  const reject  = (id) => {
    const reason = prompt("Rejection reason (shown to the creator):", "Does not meet guidelines.");
    if (reason === null) return;
    moderate({ kind: "game", id, action: "reject", reason });
  };
  const toggleBan = (c) => {
    const op = c.status === "banned" ? "unban" : "ban";
    if (!confirm(`${op === "ban" ? "Ban" : "Unban"} ${c.displayName}?`)) return;
    moderate({ kind: "creator", id: c.uid, action: op });
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, borderBottom: "1px solid rgba(255,183,0,0.2)", overflowX: "auto" }}>
        <TabButton active={tab === "games"} onClick={() => setTab("games")} badge={pending.length}>
          <Icon name="clock" size={13} /> Pending Games
        </TabButton>
        <TabButton active={tab === "allgames"} onClick={() => setTab("allgames")}>
          <Icon name="controller" size={13} /> All Games ({allGames.length})
        </TabButton>
        <TabButton active={tab === "tournaments"} onClick={() => setTab("tournaments")}>
          <Icon name="trophy" size={13} /> Tournaments ({tournaments.length})
        </TabButton>
        <TabButton active={tab === "creators"} onClick={() => setTab("creators")}>
          <Icon name="users" size={13} /> Creators ({creators.length})
        </TabButton>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: C.dimMore, fontFamily: C.raj }}>
          Loading…
        </div>
      ) : tab === "games" ? (
        pending.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center" }}>
            <div style={{ marginBottom: 10, color: C.green, display: "flex", justifyContent: "center" }}>
              <Icon name="check" size={44} />
            </div>
            <div style={{ fontFamily: C.raj, fontWeight: 700, fontSize: 14, color: C.cyanL }}>
              Queue clear — no pending games
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {pending.map(g => (
              <div key={g.id} style={{
                padding: 14,
                background: "rgba(255,183,0,0.04)",
                border: "1px solid rgba(255,183,0,0.25)",
                borderRadius: 12,
              }}>
                <div style={{ display: "grid", gridTemplateColumns: "80px 1fr", gap: 12, marginBottom: 10 }}>
                  <div style={{
                    width: 80, height: 60, borderRadius: 8, overflow: "hidden",
                    background: "#0e0c1a", border: "1px solid rgba(255,183,0,0.3)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {g.thumbnailUrl ? (
                      <img src={g.thumbnailUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : <span style={{ color: C.dim }}><Icon name="controller" size={24} /></span>}
                  </div>
                  <div>
                    <div style={{ fontFamily: C.raj, fontWeight: 700, fontSize: 15, color: "#fff" }}>
                      {g.name}
                    </div>
                    <div style={{ fontFamily: C.raj, fontSize: 11, color: C.dim, marginTop: 2, display: "inline-flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                      by <span style={{ color: C.cyanL }}>{g.creatorName}</span> · {g.category} · <Icon name="coin" size={11} /> {g.rewardRate}/play
                    </div>
                    <div style={{ fontFamily: "monospace", fontSize: 10, color: C.dimMore, marginTop: 4, wordBreak: "break-all" }}>
                      {g.iframeUrl}
                    </div>
                    {g.description && (
                      <div style={{ fontFamily: C.raj, fontSize: 11, color: C.dim, marginTop: 4 }}>
                        {g.description}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <a href={g.iframeUrl} target="_blank" rel="noreferrer" style={{
                    padding: "7px 14px",
                    background: "rgba(0,212,255,0.08)", border: "1px solid rgba(0,212,255,0.3)",
                    borderRadius: 8, color: C.cyanL, textDecoration: "none",
                    fontFamily: C.raj, fontWeight: 700, fontSize: 11,
                    letterSpacing: "0.6px", textTransform: "uppercase",
                    display: "inline-flex", alignItems: "center", gap: 5,
                  }}>
                    <Icon name="external" size={11} /> Preview
                  </a>
                  <button onClick={() => approve(g.id)} disabled={!!busy} style={{
                    padding: "7px 14px",
                    background: `linear-gradient(135deg, ${C.green}, #00b870)`,
                    border: "none", borderRadius: 8, color: "#002410",
                    fontFamily: C.raj, fontWeight: 800, fontSize: 11,
                    letterSpacing: "0.8px", textTransform: "uppercase",
                    cursor: busy ? "wait" : "pointer",
                    display: "inline-flex", alignItems: "center", gap: 5,
                  }}>
                    {busy === `game:${g.id}:approve` ? "..." : <><Icon name="check" size={11} /> Approve</>}
                  </button>
                  <button onClick={() => reject(g.id)} disabled={!!busy} style={{
                    padding: "7px 14px",
                    background: "rgba(255,68,88,0.08)", border: "1px solid rgba(255,68,88,0.3)",
                    borderRadius: 8, color: C.red,
                    fontFamily: C.raj, fontWeight: 700, fontSize: 11,
                    letterSpacing: "0.6px", textTransform: "uppercase",
                    cursor: busy ? "wait" : "pointer",
                    display: "inline-flex", alignItems: "center", gap: 5,
                  }}>
                    <Icon name="x" size={11} /> Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      ) : tab === "allgames" ? (
        <div>
          <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
            {[
              { id: "all",  label: `All (${allGames.length})` },
              { id: "web3", label: `Web3 (${allGames.filter(g => g.source !== "web2").length})` },
              { id: "web2", label: `Web2 (${allGames.filter(g => g.source === "web2").length})` },
            ].map(f => (
              <button key={f.id} onClick={() => setGameFilter(f.id)} style={{
                padding: "5px 12px", borderRadius: 20,
                background: gameFilter === f.id ? "rgba(0,212,255,0.15)" : "rgba(0,212,255,0.04)",
                border: `1px solid ${gameFilter === f.id ? "rgba(0,212,255,0.45)" : "rgba(0,212,255,0.15)"}`,
                color: gameFilter === f.id ? C.cyanL : C.dimMore,
                fontFamily: C.raj, fontSize: 10, fontWeight: 700,
                letterSpacing: "0.6px", textTransform: "uppercase",
                cursor: "pointer",
              }}>{f.label}</button>
            ))}
          </div>
          {(() => {
            const filtered = allGames.filter(g =>
              gameFilter === "all" ? true :
              gameFilter === "web2" ? g.source === "web2" :
              g.source !== "web2"
            );
            if (filtered.length === 0) {
              return (
                <div style={{ padding: 32, textAlign: "center", color: C.dimMore, fontFamily: C.raj, fontSize: 12 }}>
                  No games in this filter.
                </div>
              );
            }
            return (
              <div style={{ display: "grid", gap: 10 }}>
                {filtered.map(g => (
                  <div key={g.id} style={{
                    display: "grid", gridTemplateColumns: "70px 1fr auto", gap: 12,
                    alignItems: "center", padding: 12,
                    background: "rgba(6,12,18,0.82)",
                    border: `1px solid ${g.source === "web2" ? "rgba(0,212,255,0.25)" : "rgba(166,127,255,0.25)"}`,
                    borderRadius: 12,
                  }}>
                    <div style={{
                      width: 70, height: 54, borderRadius: 8, overflow: "hidden",
                      background: "#0e0c1a", border: `1px solid ${g.source === "web2" ? "rgba(0,212,255,0.3)" : "rgba(166,127,255,0.3)"}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {g.thumbnailUrl ? (
                        <img src={g.thumbnailUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : <Icon name="controller" size={22} />}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: C.raj, fontWeight: 700, fontSize: 14, color: "#fff", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        {g.name}
                        <span style={{
                          padding: "2px 8px", borderRadius: 20,
                          background: g.source === "web2" ? "rgba(0,212,255,0.12)" : "rgba(166,127,255,0.12)",
                          border: `1px solid ${g.source === "web2" ? "rgba(0,212,255,0.3)" : "rgba(166,127,255,0.3)"}`,
                          color: g.source === "web2" ? C.cyanL : "#c4a0ff",
                          fontFamily: C.raj, fontSize: 9, fontWeight: 800,
                          letterSpacing: "1.2px", textTransform: "uppercase",
                        }}>{g.source === "web2" ? "Web2" : "Web3"}</span>
                      </div>
                      <div style={{ fontFamily: C.raj, fontSize: 10, color: C.dimMore, marginTop: 2 }}>
                        {g.category || "—"} · {g.plays || 0} plays
                        {g.source === "web2" && g.rewardRate ? ` · ${g.rewardRate}/play` : ""}
                        {g.creatorName ? ` · by ${g.creatorName}` : (g.creator ? ` · ${g.creator.slice(0, 6)}…${g.creator.slice(-4)}` : "")}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {g.iframeUrl && (
                        <a href={g.iframeUrl} target="_blank" rel="noreferrer" style={{
                          padding: "6px 12px",
                          background: "rgba(0,212,255,0.08)", border: "1px solid rgba(0,212,255,0.3)",
                          borderRadius: 8, color: C.cyanL, textDecoration: "none",
                          fontFamily: C.raj, fontWeight: 700, fontSize: 10,
                          letterSpacing: "0.6px", textTransform: "uppercase",
                          display: "inline-flex", alignItems: "center", gap: 5,
                        }}><Icon name="external" size={10} /> Preview</a>
                      )}
                      <button onClick={() => window.location.href = `/play/${g.gameId || g.id}`} style={{
                        padding: "6px 12px",
                        background: "rgba(0,255,136,0.08)", border: "1px solid rgba(0,255,136,0.3)",
                        borderRadius: 8, color: C.green,
                        fontFamily: C.raj, fontWeight: 700, fontSize: 10,
                        letterSpacing: "0.6px", textTransform: "uppercase",
                        cursor: "pointer",
                        display: "inline-flex", alignItems: "center", gap: 5,
                      }}><Icon name="play" size={10} fill="currentColor" /> Play</button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      ) : tab === "tournaments" ? (
        <div>
          <CreateTournamentForm user={user} onCreated={loadTournaments} />
          {tournaments.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: C.dimMore, fontFamily: C.raj, fontSize: 12 }}>
              No tournaments yet — create one above.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {tournaments
                .slice()
                .sort((a, b) => (b.startTime || 0) - (a.startTime || 0))
                .map(t => {
                  const now = Date.now();
                  const live = now >= t.startTime && now <= t.endTime && !t.prizesDistributed;
                  const ended = t.prizesDistributed || t.status === "ended" || now > t.endTime;
                  const label = t.status === "cancelled" ? "Cancelled" : live ? "Live" : ended ? "Ended" : "Upcoming";
                  const color = t.status === "cancelled" ? C.red : live ? C.green : ended ? C.dimMore : C.cyan;
                  return (
                    <div key={t.id} style={{
                      padding: 12,
                      background: "rgba(6,12,18,0.82)",
                      border: `1px solid ${color}30`,
                      borderRadius: 12,
                      display: "grid",
                      gridTemplateColumns: "70px 1fr auto",
                      gap: 12, alignItems: "center",
                    }}>
                      <div style={{
                        width: 70, height: 54, borderRadius: 8, overflow: "hidden",
                        background: "#0e0c1a", border: `1px solid ${color}30`,
                      }}>
                        {t.gameThumbnail ? (
                          <img src={t.gameThumbnail} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#FFB700" }}><Icon name="trophy" size={22} /></div>}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontFamily: C.raj, fontWeight: 700, fontSize: 14, color: "#fff" }}>
                          {t.gameName}
                          <span style={{
                            marginLeft: 8, padding: "2px 7px", borderRadius: 20,
                            background: `${color}18`, border: `1px solid ${color}40`,
                            color, fontFamily: C.raj, fontSize: 9, fontWeight: 700,
                            textTransform: "uppercase", letterSpacing: "0.8px",
                          }}>{label}</span>
                        </div>
                        <div style={{ fontFamily: C.raj, fontSize: 10, color: C.dimMore, marginTop: 2, display: "inline-flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                          <Icon name="coin" size={11} color="#FFC94A" />
                          {Number(t.prizePool || 0).toLocaleString()} pool · {t.players?.length || 0}/{t.maxPlayers} players ·{" "}
                          {t.entryFee === 0 ? "Free entry" : <>{t.entryFee} <Icon name="coin" size={10} /> entry</>}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        {!t.prizesDistributed && t.status !== "cancelled" && now > t.startTime && (
                          <button onClick={async () => {
                            if (!confirm(`End "${t.gameName}" and distribute prizes?`)) return;
                            try {
                              await apiAuth(user, "/api/games?action=web2-tournament-end", {
                                method: "POST", body: JSON.stringify({ tournamentId: t.id }),
                              });
                              await loadTournaments();
                            } catch (e) { alert(e.message); }
                          }} style={{
                            padding: "6px 10px",
                            background: "linear-gradient(135deg, #FFB700, #FF8800)",
                            border: "none", borderRadius: 8, color: "#1a0f00",
                            fontFamily: C.raj, fontWeight: 800, fontSize: 10,
                            letterSpacing: "0.6px", textTransform: "uppercase",
                            cursor: "pointer", whiteSpace: "nowrap",
                            display: "inline-flex", alignItems: "center", gap: 5,
                          }}>
                            <Icon name="trophy" size={11} /> End
                          </button>
                        )}
                        {!t.prizesDistributed && t.status !== "cancelled" && (
                          <button onClick={async () => {
                            if (!confirm(`Cancel "${t.gameName}" and refund players?`)) return;
                            try {
                              await apiAuth(user, "/api/games?action=web2-tournament-cancel", {
                                method: "POST", body: JSON.stringify({ tournamentId: t.id }),
                              });
                              await loadTournaments();
                            } catch (e) { alert(e.message); }
                          }} style={{
                            padding: "6px 10px",
                            background: "rgba(255,68,88,0.08)", border: "1px solid rgba(255,68,88,0.3)",
                            borderRadius: 8, color: C.red,
                            fontFamily: C.raj, fontWeight: 700, fontSize: 10,
                            letterSpacing: "0.6px", textTransform: "uppercase",
                            cursor: "pointer", whiteSpace: "nowrap",
                            display: "inline-flex", alignItems: "center", gap: 5,
                          }}>
                            <Icon name="ban" size={11} /> Cancel
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      ) : (
        creators.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: C.dimMore, fontFamily: C.raj }}>
            No creators yet.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {creators.map(c => (
              <div key={c.uid} style={{
                display: "grid", gridTemplateColumns: "44px 1fr auto", gap: 12,
                alignItems: "center", padding: 12,
                background: "rgba(6,12,18,0.82)",
                border: `1px solid ${c.status === "banned" ? "rgba(255,68,88,0.3)" : "rgba(0,212,255,0.18)"}`,
                borderRadius: 12,
              }}>
                <img src={c.photoURL || `https://api.dicebear.com/9.x/bottts/svg?seed=${c.uid}`}
                  alt="" style={{ width: 44, height: 44, borderRadius: "50%", border: `2px solid ${C.cyan}60` }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: C.raj, fontWeight: 700, fontSize: 14, color: "#fff" }}>
                    {c.displayName} <StatusChip status={c.status || "approved"} size={9} />
                  </div>
                  <div style={{ fontFamily: C.raj, fontSize: 10, color: C.dimMore }}>
                    {c.email || "—"} · {c.totalGames || 0} games · {Number(c.totalPlays || 0).toLocaleString()} plays
                  </div>
                </div>
                <button onClick={() => toggleBan(c)} disabled={!!busy} style={{
                  padding: "6px 12px",
                  background: c.status === "banned" ? "rgba(0,255,136,0.1)" : "rgba(255,68,88,0.08)",
                  border: `1px solid ${c.status === "banned" ? "rgba(0,255,136,0.3)" : "rgba(255,68,88,0.3)"}`,
                  borderRadius: 8, color: c.status === "banned" ? C.green : C.red,
                  fontFamily: C.raj, fontWeight: 700, fontSize: 10,
                  letterSpacing: "0.6px", textTransform: "uppercase",
                  cursor: busy ? "wait" : "pointer", whiteSpace: "nowrap",
                }}>
                  {c.status === "banned" ? "Unban" : "Ban"}
                </button>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
export default function Web2Creators() {
  const navigate = useNavigate();
  const { user } = useWeb2Auth();
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" && window.innerWidth < 820);
  const [status, setStatus] = useState({ loading: true, isCreator: false, isAdmin: false, creator: null, games: [] });
  const [tab, setTab] = useState("dashboard");
  const [busy, setBusy] = useState(false);
  const [onboardErr, setOnboardErr] = useState("");

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 820);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const refresh = useCallback(async () => {
    if (!user || user.isGuest) {
      setStatus({ loading: false, isCreator: false, isAdmin: false, creator: null, games: [] });
      return;
    }
    try {
      const data = await apiAuth(user, "/api/games?action=web2-creator-status");
      setStatus({
        loading: false,
        isCreator: !!data.isCreator,
        isAdmin: !!data.isAdmin,
        creator: data.creator || null,
        games: data.games || [],
      });
    } catch (e) {
      console.warn(e);
      setStatus({ loading: false, isCreator: false, isAdmin: false, creator: null, games: [] });
    }
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  const register = async ({ displayName, bio }) => {
    setBusy(true); setOnboardErr("");
    try {
      await apiAuth(user, "/api/games?action=web2-register-creator", {
        method: "POST",
        body: JSON.stringify({ displayName, bio }),
      });
      await refresh();
      setTab("dashboard");
    } catch (e) { setOnboardErr(e.message || "Registration failed."); }
    finally { setBusy(false); }
  };

  const submitGame = async (form) => {
    await apiAuth(user, "/api/games?action=web2-submit-game", {
      method: "POST",
      body: JSON.stringify(form),
    });
    await refresh();
  };

  const deleteGame = async (id) => {
    if (!confirm("Delete this submission?")) return;
    try {
      await apiAuth(user, `/api/games?action=web2-delete-game&id=${encodeURIComponent(id)}`, { method: "DELETE" });
      await refresh();
    } catch (e) { alert(e.message); }
  };

  const pendingCount = status.games.filter(g => g.status === "pending").length;
  const approvedCount = status.games.filter(g => g.status === "approved").length;
  const totalPlays = status.games.reduce((a, g) => a + Number(g.plays || 0), 0);
  const totalCoins = status.games.reduce((a, g) => a + Number(g.totalCoinsPaid || 0), 0);

  // ─── Body selection ───
  let body;
  if (!user) {
    body = <SignInNudge />;
  } else if (user.isGuest) {
    body = (
      <div style={{ padding: 48, textAlign: "center" }}>
        <div style={{ marginBottom: 14, color: C.dim, display: "flex", justifyContent: "center" }}>
          <Icon name="user" size={56} />
        </div>
        <div style={{ fontFamily: C.raj, fontWeight: 700, fontSize: 20, color: "#fff", marginBottom: 8 }}>
          Guests can't publish
        </div>
        <div style={{ fontFamily: C.raj, fontSize: 13, color: C.dim, maxWidth: 420, margin: "0 auto" }}>
          Sign in with Google or X to register as a creator and submit games.
        </div>
      </div>
    );
  } else if (status.loading) {
    body = <div style={{ padding: 48, textAlign: "center", color: C.dimMore, fontFamily: C.raj }}>Loading your creator profile…</div>;
  } else if (!status.isCreator && !status.isAdmin) {
    body = <OnboardingCard user={user} onRegister={register} busy={busy} error={onboardErr} />;
  } else {
    // Admin-only viewers (not registered as a creator) start on the admin
    // tab since they have no dashboard/games to show. Creators (and
    // admin-creators) keep the dashboard as the landing tab.
    const headerUid    = status.creator?.uid || user.uid;
    const headerName   = status.creator?.displayName || user.displayName;
    const headerPhoto  = status.creator?.photoURL    || user.photoURL;
    const headerEmail  = status.creator?.email       || user.email || "";
    const activeTab    = tab === "dashboard" && !status.isCreator ? "admin" : tab;

    body = (
      <>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 14,
          padding: "16px 20px", marginBottom: 20,
          background: "rgba(6,12,18,0.82)",
          border: "1px solid rgba(0,212,255,0.2)",
          borderRadius: 14, backdropFilter: "blur(16px)",
          flexWrap: "wrap",
        }}>
          <img src={headerPhoto || `https://api.dicebear.com/9.x/bottts/svg?seed=${headerUid}`}
            alt="" style={{ width: 54, height: 54, borderRadius: "50%", border: `2px solid ${C.cyan}80` }} />
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div style={{ fontFamily: C.raj, fontWeight: 700, fontSize: 18, color: "#fff" }}>
                {headerName}
              </div>
              {status.isCreator && <StatusChip status={status.creator?.status || "approved"} size={10} />}
              {status.isAdmin && (
                <span style={{
                  padding: "3px 10px", borderRadius: 20,
                  background: "linear-gradient(135deg, rgba(255,183,0,0.2), rgba(255,105,0,0.1))",
                  border: "1px solid rgba(255,183,0,0.4)", color: "#FFB700",
                  fontFamily: C.raj, fontSize: 9, fontWeight: 800, letterSpacing: "1.2px",
                  display: "inline-flex", alignItems: "center", gap: 4,
                }}>
                  <Icon name="bolt" size={10} /> ADMIN
                </span>
              )}
            </div>
            <div style={{ fontFamily: C.raj, fontSize: 11, color: C.dimMore, marginTop: 2 }}>
              {headerEmail}
            </div>
          </div>
          {status.isAdmin && !status.isCreator && (
            <button
              onClick={() => register({ displayName: user.displayName, bio: "" })}
              disabled={busy}
              style={{
                padding: "9px 14px",
                background: `linear-gradient(135deg, ${C.cyan}, ${C.cyanD})`,
                border: "none", borderRadius: 10, color: "#001018",
                fontFamily: C.raj, fontWeight: 800, fontSize: 11,
                letterSpacing: "1.2px", textTransform: "uppercase",
                cursor: busy ? "wait" : "pointer",
                whiteSpace: "nowrap",
              }}
              title="Register yourself as a creator so you can also publish games"
            >
              {busy ? "..." : <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="plus" size={12} /> Also become a creator</span>}
            </button>
          )}
        </div>

        {/* Tabs — admin-only users (no creator record) see just the Admin Queue */}
        <div style={{ display: "flex", gap: 2, borderBottom: `1px solid rgba(0,212,255,0.15)`, marginBottom: 18, overflowX: "auto" }}>
          {status.isCreator && <>
            <TabButton active={activeTab === "dashboard"} onClick={() => setTab("dashboard")}><Icon name="chart" size={13} /> Dashboard</TabButton>
            <TabButton active={activeTab === "submit"}    onClick={() => setTab("submit")}><Icon name="plus" size={13} /> Submit Game</TabButton>
            <TabButton active={activeTab === "mygames"}   onClick={() => setTab("mygames")} badge={pendingCount}><Icon name="controller" size={13} /> My Games</TabButton>
          </>}
          {status.isAdmin && (
            <TabButton active={activeTab === "admin"} onClick={() => setTab("admin")}><Icon name="bolt" size={13} /> Admin Queue</TabButton>
          )}
        </div>

        {/* Tab content */}
        {activeTab === "dashboard" && status.isCreator && (
          <div>
            <div style={{
              display: "grid", gap: 12,
              gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)",
              marginBottom: 20,
            }}>
              <StatCard label="Published"   value={approvedCount}             iconName="controller" accent={C.cyan} />
              <StatCard label="In Review"   value={pendingCount}              iconName="clock"      accent="#FFB700" />
              <StatCard label="Total Plays" value={totalPlays.toLocaleString()} iconName="trend"    accent={C.green} />
              <StatCard label="Paid Out"    value={totalCoins.toLocaleString()} iconName="coin"     accent={C.gold} />
            </div>
            <div style={{
              padding: "18px 20px",
              background: "linear-gradient(135deg, rgba(0,212,255,0.06), rgba(0,0,0,0))",
              border: "1px solid rgba(0,212,255,0.2)",
              borderRadius: 14,
            }}>
              <div style={{
                fontFamily: C.raj, fontSize: 10, color: C.dim,
                textTransform: "uppercase", letterSpacing: "1.6px", fontWeight: 700, marginBottom: 10,
              }}>How Web2 publishing works</div>
              <ol style={{ margin: 0, paddingLeft: 20, color: C.cyanL, fontFamily: C.raj, fontSize: 13, lineHeight: 1.7 }}>
                <li>Submit a game via <b>Submit Game</b> — needs an https iframe URL.</li>
                <li>Admin reviews it. Approved games appear in the library.</li>
                <li>You earn visibility; players earn ArcadeCoins per play.</li>
              </ol>
            </div>
          </div>
        )}

        {activeTab === "submit"  && status.isCreator && <SubmitGameForm onSubmit={submitGame} busy={busy} />}
        {activeTab === "mygames" && status.isCreator && <MyGamesList games={status.games} onDelete={deleteGame} onPlay={(id) => navigate(`/play/${id}`)} />}
        {activeTab === "admin"   && status.isAdmin   && <AdminQueue user={user} onRefresh={refresh} />}
      </>
    );
  }

  return (
    <div style={{ minHeight: "calc(100vh - 54px)", background: C.bg, position: "relative", overflow: "hidden" }}>
      <style>{`
        @keyframes w2cPulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(1.3)} }
        @keyframes w2cFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-14px)} }
        @keyframes w2cFadeUp { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
        @keyframes w2cGrad { to { background-position: 300% center; } }
        .w2c-title {
          background: linear-gradient(90deg,#00d4ff,#6fb8ff,#00d4ff);
          background-size: 300% auto;
          -webkit-background-clip: text; background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: w2cGrad 6s linear infinite;
        }
        select option { background: #0a0f1a; color: #e8f4ff; }
      `}</style>

      {/* Backdrop */}
      <div style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none" }}>
        <div style={{
          position: "absolute", inset: 0, opacity: 0.5,
          backgroundImage: "linear-gradient(rgba(0,212,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(0,212,255,0.045) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }} />
        <div style={{
          position: "absolute", top: "8%", left: "50%", transform: "translateX(-50%)",
          width: 700, height: 420,
          background: "radial-gradient(ellipse, rgba(0,212,255,0.12) 0%, transparent 70%)",
          animation: "w2cFloat 10s ease-in-out infinite",
        }} />
      </div>

      <div style={{ position: "relative", zIndex: 1, maxWidth: 1120, margin: "0 auto", padding: isMobile ? "20px 14px 40px" : "32px 36px 48px" }}>
        {/* Header */}
        <div style={{ marginBottom: 24, animation: "w2cFadeUp 0.5s ease both" }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "4px 11px", border: "1px solid rgba(0,212,255,0.3)",
            borderRadius: 4, fontSize: 9, color: C.dim,
            letterSpacing: "1.5px", textTransform: "uppercase",
            marginBottom: 14, background: "rgba(0,212,255,0.08)",
            fontFamily: C.raj, fontWeight: 600,
          }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#00FF88", animation: "w2cPulse 1.5s ease-in-out infinite" }} />
            Web2 Mode · Creator Portal
          </div>
          <h1 style={{
            fontFamily: C.raj, fontWeight: 700,
            fontSize: isMobile ? 30 : 48, letterSpacing: "-0.5px",
            textTransform: "uppercase", lineHeight: 1, color: "#fff", margin: 0,
          }}>
            Game <span className="w2c-title">Creators</span>
          </h1>
          <p style={{
            marginTop: 10, maxWidth: 620,
            fontFamily: C.raj, fontSize: 13, color: "rgba(180,220,255,0.65)",
          }}>
            Publish HTML5 games, reach players, and earn a share of every play — no wallet, no gas.
          </p>
        </div>

        <div style={{ animation: "w2cFadeUp 0.6s 0.1s ease both" }}>
          {body}
        </div>
      </div>
    </div>
  );
}
