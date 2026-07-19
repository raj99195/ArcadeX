import { useState, useEffect } from "react";
import { useAccount } from "wagmi";

function BrandIcon({ name, size = 22 }) {
  const paths = {
    telegram: "M9.78 18.65l.28-4.23 7.68-6.92c.34-.3-.07-.46-.52-.16L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71l-4.14-3.05-2 1.93c-.21.21-.4.4-.79.4z",
    discord: "M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.076.076 0 0 0-.04.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.029 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.055c.5-5.177-.838-9.674-3.548-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.955 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z",
    x: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z",
    linkedin: "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.125 2.062 2.062 0 0 1 0 4.125zM7.114 20.452H3.558V9h3.556v11.452z",
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d={paths[name]} />
    </svg>
  );
}

const S = {
  bg: "#08070f", card: "#0d0b1a", card2: "#12102a",
  border: "rgba(123,47,255,0.14)", border2: "rgba(123,47,255,0.28)",
  purple: "#7B2FFF", purpleL: "#B088FF", cyan: "#00D4FF",
  green: "#00FF88", gold: "#FFB700", red: "#FF4444",
  dim: "#9977CC", dimMore: "#5533AA",
  raj: "'Rajdhani', sans-serif", orb: "'Orbitron', sans-serif",
};

const ISSUE_TYPES = [
  { id: "sdk", label: "🛠 SDK Issue", desc: "Integration, events, score submission" },
  { id: "payment", label: "💰 Payment / Rewards", desc: "Missing tokens, reward errors" },
  { id: "game_rejected", label: "🚫 Game Rejected", desc: "Review feedback, resubmission" },
  { id: "tournament", label: "🏆 Tournament", desc: "Join issues, prize disputes" },
  { id: "account", label: "👤 Account / NFT", desc: "Creator NFT, wallet issues" },
  { id: "other", label: "💬 Other", desc: "Anything else" },
];

const COMMUNITY = [
  { iconKey: "telegram", name: "Telegram", desc: "Fastest support — usually < 1hr", label: "Join Community", url: "https://t.me/AracdeX", color: "#0088cc", border: "rgba(0,136,204,0.25)", bg: "rgba(0,136,204,0.06)" },
  { iconKey: "discord", name: "Discord", desc: "Dev discussions, bug reports, builders", label: "Join Server", url: "https://discord.gg/836Mx9XjbB", color: S.purple, border: S.border2, bg: "rgba(123,47,255,0.06)" },
  { iconKey: "x", name: "X / Twitter", desc: "Platform updates, announcements", label: "Follow Us", url: "https://x.com/PlayArcadeX", color: "#fff", border: "rgba(255,255,255,0.15)", bg: "rgba(255,255,255,0.04)" },
  { iconKey: "linkedin", name: "LinkedIn", desc: "Partnerships, enterprise inquiries", label: "Connect", url: "https://www.linkedin.com/company/playarcadex/", color: "#0077b5", border: "rgba(0,119,181,0.25)", bg: "rgba(0,119,181,0.06)" },
];

async function submitTicket(ticket) {
  console.log("🎫 submitTicket via API:", ticket);
  const res = await fetch("/api/support?action=ticket", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ticket),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "API error");
  console.log("✅ Ticket saved:", data.ticketId);
  return data;
}

export default function Support() {
  const { address, isConnected } = useAccount();
  
  const [activeSection, setActiveSection] = useState("community");
  const [form, setForm] = useState({ issueType: "", description: "", email: "", screenshot: null });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [screenshotPreview, setScreenshotPreview] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  // My Tickets State
  const [tickets, setTickets] = useState([]);
  const [loadingTickets, setLoadingTickets] = useState(false);

  const handleFile = (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    setForm(f => ({ ...f, screenshot: file }));
    const reader = new FileReader();
    reader.onload = e => setScreenshotPreview(e.target.result);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    if (!form.issueType) { setError("Please select an issue type"); return; }
    if (!form.description.trim() || form.description.length < 20) { setError("Please describe the issue (min 20 chars)"); return; }
    setError(""); setSubmitting(true);
    try {
      let screenshotUrl = null;
      if (form.screenshot) {
        try {
          const cloud = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
          const preset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;
          if (cloud && preset) {
            const fd = new FormData();
            fd.append("file", form.screenshot);
            fd.append("upload_preset", preset);
            fd.append("folder", "arcadex-support");
            const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, { method: "POST", body: fd });
            const data = await res.json();
            screenshotUrl = data.secure_url;
          }
        } catch { /* screenshot upload optional */ }
      }
      await submitTicket({
        issueType: form.issueType,
        description: form.description.trim(),
        email: form.email.trim() || null,
        screenshotUrl,
        userAgent: navigator.userAgent,
        wallet: address || "guest", // Backend tracking ke liye wallet bheja
      });
      setSubmitted(true);
    } catch (err) {
      setError(`Failed: ${err.code || err.message}. Try again, or reach us on Telegram/Discord.`);
    } finally { setSubmitting(false); }
  };

  const fetchMyTickets = async () => {
    if (!isConnected) return;
    setLoadingTickets(true);
    try {
      const token = localStorage.getItem("arcadex_jwt");
      const res = await fetch("/api/support?action=my-tickets", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
        // Backend now filters by wallet server-side — no client-side filter needed
        setTickets(data.tickets || []);
      }
    } catch (err) {
      console.error("Error fetching tickets:", err);
    } finally {
      setLoadingTickets(false);
    }
  };

  useEffect(() => {
    if (activeSection === "mytickets" && isConnected) {
      fetchMyTickets();
    }
  }, [activeSection, isConnected]);

  const NAV = [
    { id: "community", icon: "🌐", label: "Community" },
    { id: "ticket",    icon: "🎫", label: "Submit Ticket" },
    { id: "mytickets", icon: "📋", label: "My Tickets" },
  ];

  const inp = {
    width: "100%", padding: "11px 14px",
    background: "rgba(123,47,255,0.06)",
    border: `1px solid ${S.border2}`,
    borderRadius: 9, color: "#fff",
    fontSize: 13, fontFamily: S.raj,
    outline: "none", boxSizing: "border-box",
  };

  return (
    <div style={{ minHeight: "calc(100vh - 54px)", background: S.bg }}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes slideUp { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        .sup-card:hover { border-color: rgba(123,47,255,0.35) !important; transform: translateY(-2px); }
        .issue-opt:hover { border-color: rgba(123,47,255,0.4) !important; background: rgba(123,47,255,0.08) !important; }
      `}</style>

      {/* BG */}
      <div style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none" }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(123,47,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(123,47,255,0.05) 1px, transparent 1px)", backgroundSize: "50px 50px" }} />
        <div style={{ position: "absolute", top: "5%", left: "40%", width: 600, height: 400, background: "radial-gradient(circle, rgba(123,47,255,0.1) 0%, transparent 70%)", borderRadius: "50%" }} />
      </div>

      <div style={{ position: "relative", zIndex: 1, maxWidth: 1000, margin: "0 auto", padding: "32px 24px" }}>

        {/* Hero */}
        <div style={{ marginBottom: 36 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: S.purpleL, letterSpacing: "3px", textTransform: "uppercase", marginBottom: 16, fontFamily: S.raj, fontWeight: 700 }}>
            <span style={{ color: S.purple, fontSize: 13 }}>◆</span> Support Center
          </div>
          <h1 style={{ fontFamily: S.raj, fontWeight: 800, fontSize: 46, color: "#fff", textTransform: "uppercase", lineHeight: 1.05, margin: "0 0 14px" }}>
            How can we<br />
            <span style={{ background: `linear-gradient(90deg,${S.purple},${S.cyan})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              help you?
            </span>
          </h1>
          <p style={{ color: S.dimMore, fontSize: 14, fontFamily: S.raj, margin: "0 0 26px", lineHeight: 1.6 }}>
            Join the community or submit a support ticket.
          </p>

          {/* Tabs — pill style */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {NAV.map(n => (
              <button key={n.id} onClick={() => setActiveSection(n.id)} style={{
                padding: "11px 20px", borderRadius: 10,
                background: activeSection === n.id ? "rgba(123,47,255,0.14)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${activeSection === n.id ? S.border2 : "rgba(255,255,255,0.08)"}`,
                color: activeSection === n.id ? "#fff" : S.dimMore,
                fontSize: 13, cursor: "pointer", fontFamily: S.raj, fontWeight: 700,
                letterSpacing: "0.5px", textTransform: "uppercase",
                transition: "all 0.18s",
                display: "flex", alignItems: "center", gap: 8,
              }}>
                {n.icon} {n.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── COMMUNITY ── */}
        {activeSection === "community" && (
          <div style={{ animation: "slideUp 0.3s ease" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 24 }}>
              <span style={{ color: S.purpleL, fontSize: 11 }}>◆</span>
              <div style={{ fontSize: 11, color: S.dimMore, fontFamily: S.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "2px" }}>
                Connect with the ArcadeX community
              </div>
              <span style={{ color: S.purpleL, fontSize: 11 }}>◆</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
              {COMMUNITY.map(c => (
                <a key={c.name} href={c.url} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                  <div className="sup-card" style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 14, padding: "22px 20px", cursor: "pointer", transition: "all 0.22s", display: "flex", flexDirection: "column", gap: 12, height: "100%", boxSizing: "border-box" }}>
                    <div style={{
                      width: 48, height: 48, borderRadius: "50%",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 22, background: `${c.color}22`, border: `1px solid ${c.color}44`,
                      color: c.color,
                    }}>
                      <BrandIcon name={c.iconKey} />
                    </div>
                    <div>
                      <div style={{ fontFamily: S.raj, fontWeight: 700, fontSize: 16, color: "#fff", marginBottom: 4 }}>{c.name}</div>
                      <div style={{ fontSize: 12, color: S.dimMore, fontFamily: S.raj, lineHeight: 1.5 }}>{c.desc}</div>
                    </div>
                    <div style={{ marginTop: "auto", padding: "8px 14px", background: "transparent", border: `1px solid ${c.border}`, borderRadius: 8, color: c.color, fontSize: 12, fontFamily: S.raj, fontWeight: 700, textAlign: "center" }}>
                      {c.label} →
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* ── TICKET ── */}
        {activeSection === "ticket" && (
          <div style={{ animation: "slideUp 0.3s ease", maxWidth: 680 }}>
            {submitted ? (
              <div style={{ textAlign: "center", padding: "60px 0" }}>
                <div style={{ width: 72, height: 72, borderRadius: "50%", background: "rgba(0,255,136,0.1)", border: "1px solid rgba(0,255,136,0.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, margin: "0 auto 20px" }}>✅</div>
                <div style={{ fontFamily: S.raj, fontWeight: 700, fontSize: 24, color: "#fff", marginBottom: 10 }}>Ticket Submitted!</div>
                <div style={{ fontSize: 13, color: S.dimMore, fontFamily: S.raj, marginBottom: 24, lineHeight: 1.7 }}>
                  We'll get back to you within 24 hours.<br />
                  For faster help, join our Telegram community.
                </div>
                <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                  <button onClick={() => { setSubmitted(false); setForm({ issueType: "", description: "", email: "", screenshot: null }); setScreenshotPreview(null); }} style={{ padding: "10px 22px", background: "rgba(123,47,255,0.1)", border: `1px solid ${S.border2}`, borderRadius: 9, color: S.purpleL, fontSize: 13, fontFamily: S.raj, fontWeight: 700, cursor: "pointer" }}>Submit Another</button>
                  <button onClick={() => setActiveSection("mytickets")} style={{ padding: "10px 22px", background: `linear-gradient(135deg,${S.purple},#5a1fd4)`, border: "none", borderRadius: 9, color: "#fff", fontSize: 13, fontFamily: S.raj, fontWeight: 700, cursor: "pointer" }}>View My Tickets →</button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                <div style={{ fontSize: 10, color: S.dimMore, fontFamily: S.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px" }}>
                  Fill out the form below
                </div>

                {/* Issue type */}
                <div>
                  <div style={{ fontSize: 11, color: S.dimMore, fontFamily: S.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", marginBottom: 10 }}>
                    Issue Type <span style={{ color: S.red }}>*</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
                    {ISSUE_TYPES.map(t => (
                      <div key={t.id} className="issue-opt" onClick={() => setForm(f => ({ ...f, issueType: t.id }))} style={{
                        padding: "12px 14px", borderRadius: 10, cursor: "pointer", transition: "all 0.18s",
                        background: form.issueType === t.id ? "rgba(123,47,255,0.15)" : "rgba(123,47,255,0.04)",
                        border: `1px solid ${form.issueType === t.id ? "rgba(123,47,255,0.5)" : S.border}`,
                      }}>
                        <div style={{ fontFamily: S.raj, fontWeight: 700, fontSize: 13, color: form.issueType === t.id ? S.purpleL : "#fff", marginBottom: 3 }}>{t.label}</div>
                        <div style={{ fontSize: 11, color: S.dimMore, fontFamily: S.raj }}>{t.desc}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Description */}
                <div>
                  <div style={{ fontSize: 11, color: S.dimMore, fontFamily: S.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", marginBottom: 8 }}>
                    Describe the issue <span style={{ color: S.red }}>*</span>
                  </div>
                  <textarea
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="What happened? Include steps to reproduce, error messages, wallet address, game ID..."
                    rows={5}
                    style={{ ...inp, resize: "vertical", lineHeight: 1.6 }}
                  />
                  <div style={{ fontSize: 10, color: S.dimMore, fontFamily: S.raj, marginTop: 5, textAlign: "right" }}>
                    {form.description.length} chars {form.description.length < 20 && form.description.length > 0 ? "— min 20" : ""}
                  </div>
                </div>

                {/* Email */}
                <div>
                  <div style={{ fontSize: 11, color: S.dimMore, fontFamily: S.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", marginBottom: 8 }}>
                    Your Email <span style={{ color: S.dimMore, fontSize: 10, fontWeight: 400 }}>(optional — for follow-up)</span>
                  </div>
                  <input
                    type="email"
                    value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="you@email.com"
                    style={inp}
                  />
                </div>

                {/* Screenshot */}
                <div>
                  <div style={{ fontSize: 11, color: S.dimMore, fontFamily: S.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", marginBottom: 8 }}>
                    Screenshot <span style={{ color: S.dimMore, fontSize: 10, fontWeight: 400 }}>(optional)</span>
                  </div>
                  <div
                    onClick={() => document.getElementById("ticket-screenshot").click()}
                    onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
                    style={{
                      border: `2px dashed ${dragOver ? S.purple : screenshotPreview ? "rgba(0,255,136,0.3)" : S.border}`,
                      borderRadius: 12, padding: "20px", textAlign: "center", cursor: "pointer",
                      background: dragOver ? "rgba(123,47,255,0.08)" : "rgba(123,47,255,0.03)",
                      transition: "all 0.2s", position: "relative", overflow: "hidden",
                    }}
                  >
                    {screenshotPreview ? (
                      <div style={{ position: "relative" }}>
                        <img src={screenshotPreview} alt="screenshot" style={{ maxHeight: 160, maxWidth: "100%", borderRadius: 8, objectFit: "contain" }} />
                        <button onClick={e => { e.stopPropagation(); setScreenshotPreview(null); setForm(f => ({ ...f, screenshot: null })); }} style={{ position: "absolute", top: -8, right: -8, width: 22, height: 22, borderRadius: "50%", background: S.red, border: "none", color: "#fff", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
                      </div>
                    ) : (
                      <>
                        <div style={{ fontSize: 28, marginBottom: 8 }}>🖼️</div>
                        <div style={{ fontSize: 12, color: S.purpleL, fontFamily: S.raj, fontWeight: 700 }}>Click or drag & drop</div>
                        <div style={{ fontSize: 11, color: S.dimMore, fontFamily: S.raj, marginTop: 4 }}>PNG, JPG — helps us understand the issue faster</div>
                      </>
                    )}
                  </div>
                  <input id="ticket-screenshot" type="file" accept="image/*" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />
                </div>

                {error && (
                  <div style={{ padding: "10px 14px", background: "rgba(255,68,68,0.07)", border: "1px solid rgba(255,68,68,0.2)", borderRadius: 9, fontSize: 12, color: "#ff6b6b", fontFamily: S.raj, fontWeight: 700 }}>
                    {error}
                  </div>
                )}

                <button onClick={handleSubmit} disabled={submitting} style={{
                  padding: "13px", background: submitting ? "rgba(123,47,255,0.2)" : `linear-gradient(135deg,${S.purple},#5a1fd4)`,
                  border: "none", borderRadius: 10, color: submitting ? S.dimMore : "#fff",
                  fontSize: 13, fontWeight: 700, cursor: submitting ? "not-allowed" : "pointer",
                  fontFamily: S.raj, letterSpacing: "1px", textTransform: "uppercase",
                }}>
                  {submitting ? "Submitting..." : "🎫 Submit Ticket"}
                </button>

                <div style={{ textAlign: "center", fontSize: 11, color: S.dimMore, fontFamily: S.raj }}>
                  Average response time: <span style={{ color: S.green, fontWeight: 700 }}>under 24 hours</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── MY TICKETS TAB ── */}
        {activeSection === "mytickets" && (
          <div style={{ animation: "slideUp 0.3s ease" }}>
            {!isConnected ? (
              <div style={{ padding: "60px 0", textAlign: "center", background: "rgba(123,47,255,0.04)", border: `1px solid ${S.border}`, borderRadius: 14 }}>
                <div style={{ fontSize: 40, marginBottom: 10 }}>🔐</div>
                <div style={{ color: "#fff", fontFamily: S.raj, fontSize: 16, fontWeight: 700 }}>Wallet Not Connected</div>
                <div style={{ color: S.dimMore, fontFamily: S.raj, fontSize: 12, marginTop: 5 }}>Please connect your wallet to view your tickets.</div>
              </div>
            ) : loadingTickets ? (
               <div style={{ padding: "40px 0", textAlign: "center", color: S.dimMore, fontFamily: S.raj, fontSize: 14 }}>Loading your tickets...</div>
            ) : tickets.length === 0 ? (
               <div style={{ padding: "60px 0", textAlign: "center", background: "rgba(123,47,255,0.04)", border: `1px solid ${S.border}`, borderRadius: 14 }}>
                 <div style={{ fontSize: 40, marginBottom: 10 }}>📭</div>
                 <div style={{ color: "#fff", fontFamily: S.raj, fontSize: 16, fontWeight: 700 }}>No tickets found</div>
                 <div style={{ color: S.dimMore, fontFamily: S.raj, fontSize: 12, marginTop: 5 }}>You haven't submitted any support requests yet.</div>
               </div>
            ) : (
               <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                 {tickets.map((ticket, i) => (
                   <div key={i} style={{ background: S.card2, border: `1px solid ${ticket.status === 'resolved' ? 'rgba(0,255,136,0.2)' : S.border}`, borderRadius: 12, padding: 20 }}>
                     <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
                       <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                          <span style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, background: "rgba(123,47,255,0.15)", color: S.cyan, fontFamily: S.raj, fontWeight: 700, textTransform: "uppercase" }}>{ticket.issueType}</span>
                          <span style={{ fontSize: 10, color: S.dimMore, fontFamily: "monospace" }}>ID: {ticket.id}</span>
                       </div>
                       <span style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, background: ticket.status === 'resolved' ? "rgba(0,255,136,0.1)" : ticket.status === 'in-progress' ? "rgba(255,183,0,0.1)" : "rgba(255,68,68,0.1)", color: ticket.status === 'resolved' ? S.green : ticket.status === 'in-progress' ? S.gold : S.red, fontFamily: S.raj, fontWeight: 700, textTransform: "uppercase" }}>
                         {ticket.status || "Pending"}
                       </span>
                     </div>
                     
                     <div style={{ fontSize: 14, color: "#e0d0ff", fontFamily: S.raj, lineHeight: 1.5, marginBottom: 12 }}>{ticket.description}</div>
                     
                     {ticket.screenshotUrl && (
                        <a href={ticket.screenshotUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: S.cyan, fontFamily: S.raj, textDecoration: "none", display: "inline-block", padding: "6px 12px", background: "rgba(0,212,255,0.1)", borderRadius: 6, marginBottom: 12 }}>🖼️ View Attached Image</a>
                     )}

                     {ticket.replies && ticket.replies.length > 0 && (
                       <div style={{ marginTop: 10, padding: 16, background: S.card, borderRadius: 10, borderLeft: `3px solid ${S.purple}` }}>
                         <div style={{ fontSize: 10, color: S.dim, fontFamily: S.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", marginBottom: 8 }}>Admin Replies</div>
                         {ticket.replies.map((reply, idx) => (
                           <div key={idx} style={{ marginBottom: idx < ticket.replies.length - 1 ? 12 : 0, paddingBottom: idx < ticket.replies.length - 1 ? 12 : 0, borderBottom: idx < ticket.replies.length - 1 ? `1px solid ${S.border}` : "none" }}>
                             <div style={{ fontSize: 13, color: "#fff", fontFamily: S.raj, lineHeight: 1.5 }}>{reply.text}</div>
                             <div style={{ fontSize: 9, color: S.dimMore, fontFamily: S.raj, marginTop: 4 }}>{new Date(reply.at).toLocaleString()}</div>
                           </div>
                         ))}
                       </div>
                     )}
                   </div>
                 ))}
               </div>
            )}
          </div>
        )}

        {/* Feature strip — always visible, matches mockup footer */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 20,
          marginTop: 48, paddingTop: 28, borderTop: `1px solid ${S.border}`,
        }}>
          {[
            { icon: "🎧", title: "24/7 Community Support", desc: "We're here for you anytime" },
            { icon: "👻", title: "Active & Friendly Community", desc: "Join thousands of gamers" },
            { icon: "✅", title: "Fast & Reliable Assistance", desc: "Your satisfaction is our priority" },
          ].map(f => (
            <div key={f.title} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{
                width: 38, height: 38, borderRadius: "50%", flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "rgba(123,47,255,0.1)", border: `1px solid ${S.border2}`, fontSize: 16,
              }}>
                {f.icon}
              </div>
              <div>
                <div style={{ fontFamily: S.raj, fontWeight: 700, fontSize: 13, color: "#fff" }}>{f.title}</div>
                <div style={{ fontFamily: S.raj, fontSize: 11.5, color: S.dimMore }}>{f.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}