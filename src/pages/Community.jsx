import { useState, useEffect, useRef } from "react";
import { useAccount } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { getActiveAvatarStyle } from "../utils/avatarUtils";

const CHANNELS = [
  { id: "general",       icon: "💬", label: "general",       desc: "General chat" },
  { id: "game-talk",     icon: "🎮", label: "game-talk",     desc: "Discuss games" },
  { id: "flex",          icon: "🏆", label: "flex",          desc: "Show your scores" },
  { id: "announcements", icon: "📢", label: "announcements", desc: "Platform updates", adminOnly: true },
];

const ADMIN_ADDRESS = import.meta.env.VITE_ADMIN_ADDRESS?.toLowerCase();
const X_HANDLE = import.meta.env.VITE_X_HANDLE || "ArcadeXOnChain";

const P = {
  bg:"#08070f", sidebar:"#0d0b1a", card:"#12102a",
  border:"rgba(123,47,255,0.15)", purple:"#7B2FFF", purpleL:"#B088FF",
  cyan:"#00D4FF", green:"#00FF88", gold:"#FFB700", dim:"#9977CC", dimMore:"#5533AA",
  raj:"'Rajdhani', sans-serif", mono:"monospace",
};

function Avatar({ address, style, size = 32 }) {
  const avatarStyle = style || getActiveAvatarStyle(address);
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", overflow: "hidden", border: "1.5px solid rgba(123,47,255,0.4)", flexShrink: 0, background: "#0e0c1a" }}>
      <img src={`https://api.dicebear.com/9.x/${avatarStyle}/svg?seed=${address}`} alt="" style={{ width: "100%", height: "100%" }} />
    </div>
  );
}

function timeAgo(ts) {
  if (!ts) return "";
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// API helpers
async function fetchMessages(channel) {
  const res = await fetch(`/api/community?channel=${channel}`);
  const data = await res.json();
  return data.messages || [];
}

async function postMessage(channel, text, avatarStyle) {
  const token = localStorage.getItem("arcadex_jwt");
  const res = await fetch("/api/community", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ channel, text, avatarStyle }),
  });
  return res.json();
}

async function deleteMessage(channel, messageId) {
  const token = localStorage.getItem("arcadex_jwt");
  const res = await fetch("/api/community", {
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ channel, messageId }),
  });
  return res.json();
}

export default function Community() {
  const { address, isConnected } = useAccount();
  const { open } = useAppKit();
  const [activeChannel, setActiveChannel] = useState("general");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [showSidebar, setShowSidebar] = useState(false);
  const [onlineCount, setOnlineCount] = useState(0);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const pollRef = useRef(null);

  const isAdmin = address?.toLowerCase() === ADMIN_ADDRESS;
  const channel = CHANNELS.find(c => c.id === activeChannel);

  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);

  // Poll messages every 5s (no Firebase realtime needed)
  useEffect(() => {
    const load = async () => {
      try {
        const msgs = await fetchMessages(activeChannel);
        setMessages(msgs);
      } catch (e) { console.error(e); }
    };
    load();
    pollRef.current = setInterval(load, 5000);
    return () => clearInterval(pollRef.current);
  }, [activeChannel]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    setOnlineCount(Math.floor(Math.random() * 8) + 2);
  }, [activeChannel]);

  const shortAddr = (addr) => addr ? addr.slice(0, 6) + "..." + addr.slice(-4) : "";

  const sendMessage = async () => {
    if (!input.trim() || !isConnected || sending) return;
    if (channel?.adminOnly && !isAdmin) return;
    setSending(true);
    const text = input.trim();
    setInput("");
    try {
      // Optimistic update
      setMessages(prev => [...prev, {
        id: Date.now(), text, address: address.toLowerCase(),
        avatarStyle: getActiveAvatarStyle(address), isAdmin, createdAt: new Date().toISOString()
      }]);
      await postMessage(activeChannel, text, getActiveAvatarStyle(address));
    } catch (err) {
      console.error(err);
      setInput(text);
    } finally { setSending(false); }
  };

  const handleDelete = async (msgId) => {
    if (!isAdmin) return;
    setMessages(prev => prev.filter(m => m.id !== msgId));
    try { await deleteMessage(activeChannel, msgId); } catch (e) { console.error(e); }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const Sidebar = () => (
    <div style={{ width: isMobile ? "100%" : 220, background: P.sidebar, borderRight: `1px solid ${P.border}`, display: "flex", flexDirection: "column", flexShrink: 0, height: "100%" }}>
      <div style={{ padding: "16px 14px 10px", borderBottom: `1px solid ${P.border}` }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", fontFamily: P.raj, textTransform: "uppercase", letterSpacing: "1px", marginBottom: 2 }}>ArcadeX</div>
        <div style={{ fontSize: 10, color: P.dimMore, fontFamily: P.raj }}>Community Hub</div>
      </div>
      <div style={{ padding: "8px 14px", display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: P.green, boxShadow: `0 0 6px ${P.green}` }} />
        <span style={{ fontSize: 10, color: P.dim, fontFamily: P.raj }}>{onlineCount} online</span>
      </div>
      <div style={{ padding: "4px 8px", flex: 1 }}>
        <div style={{ fontSize: 9, color: P.dimMore, fontFamily: P.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", padding: "6px 6px 4px" }}>Channels</div>
        {CHANNELS.map(ch => (
          <div key={ch.id} onClick={() => { setActiveChannel(ch.id); setShowSidebar(false); }}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 8px", borderRadius: 6, cursor: "pointer", marginBottom: 2, background: activeChannel === ch.id ? "rgba(123,47,255,0.15)" : "transparent", border: activeChannel === ch.id ? "1px solid rgba(123,47,255,0.3)" : "1px solid transparent", transition: "all 0.15s" }}
            onMouseEnter={e => { if (activeChannel !== ch.id) e.currentTarget.style.background = "rgba(123,47,255,0.07)"; }}
            onMouseLeave={e => { if (activeChannel !== ch.id) e.currentTarget.style.background = "transparent"; }}>
            <span style={{ fontSize: 14 }}>{ch.icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: activeChannel === ch.id ? P.purpleL : P.dim, fontFamily: P.raj, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}># {ch.label}</div>
            </div>
            {ch.adminOnly && <span style={{ fontSize: 8, color: P.gold, fontFamily: P.raj, fontWeight: 700 }}>ADMIN</span>}
          </div>
        ))}
      </div>
      <div style={{ margin: "8px", padding: "10px 12px", background: "rgba(0,0,0,0.3)", border: "1px solid rgba(123,47,255,0.2)", borderRadius: 8 }}>
        <div style={{ fontSize: 10, color: P.dim, fontFamily: P.raj, marginBottom: 6 }}>Stay updated</div>
        <a href={`https://x.com/${X_HANDLE}`} target="_blank" rel="noreferrer"
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", background: "#000", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, textDecoration: "none" }}>
          <span style={{ fontSize: 12 }}>𝕏</span>
          <span style={{ fontSize: 11, color: "#fff", fontFamily: P.raj, fontWeight: 700 }}>@{X_HANDLE}</span>
        </a>
      </div>
      {isConnected && (
        <div style={{ padding: "10px 12px", borderTop: `1px solid ${P.border}`, display: "flex", alignItems: "center", gap: 8 }}>
          <Avatar address={address} size={28} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, color: P.purpleL, fontFamily: P.raj, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortAddr(address)}</div>
            {isAdmin && <div style={{ fontSize: 9, color: P.gold, fontFamily: P.raj }}>ADMIN</div>}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div style={{ minHeight: "calc(100vh - 54px)", background: P.bg, display: "flex", overflow: "hidden", position: "relative" }}>
      <style>{`
        @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        .msg-row:hover .delete-btn { opacity: 1 !important; }
        .channel-input:focus { border-color: rgba(123,47,255,0.45) !important; outline: none; }
        .channel-input::placeholder { color: #3a2a5a; }
        * { scrollbar-width: none; }
        *::-webkit-scrollbar { display: none; }
      `}</style>
      {isMobile && showSidebar && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex" }}>
          <div style={{ width: 240, height: "100%", zIndex: 101 }}><Sidebar /></div>
          <div style={{ flex: 1, background: "rgba(0,0,0,0.6)" }} onClick={() => setShowSidebar(false)} />
        </div>
      )}
      {!isMobile && <Sidebar />}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, height: "calc(100vh - 54px)" }}>
        <div style={{ padding: "12px 20px", borderBottom: `1px solid ${P.border}`, background: "rgba(13,11,26,0.8)", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          {isMobile && <button onClick={() => setShowSidebar(true)} style={{ background: "rgba(123,47,255,0.1)", border: `1px solid ${P.border}`, borderRadius: 6, padding: "4px 8px", color: P.purpleL, cursor: "pointer", fontSize: 14 }}>☰</button>}
          <span style={{ fontSize: 18 }}>{channel?.icon}</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", fontFamily: P.raj }}>#{channel?.label}</div>
            <div style={{ fontSize: 10, color: P.dimMore, fontFamily: P.raj }}>{channel?.desc}</div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: P.green }} />
            <span style={{ fontSize: 10, color: P.dim, fontFamily: P.raj }}>{onlineCount} online</span>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 2 }}>
          {messages.length === 0 && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, opacity: 0.5 }}>
              <span style={{ fontSize: 48 }}>{channel?.icon}</span>
              <div style={{ fontFamily: P.raj, fontSize: 14, color: P.dim }}>No messages yet — be the first!</div>
            </div>
          )}
          {messages.map((msg, i) => {
            const isOwn = msg.address === address?.toLowerCase();
            const isAdminMsg = msg.isAdmin;
            const prevMsg = messages[i - 1];
            const prevTime = prevMsg?.createdAt ? new Date(prevMsg.createdAt?.toDate ? prevMsg.createdAt.toDate() : prevMsg.createdAt).getTime() : 0;
            const curTime = msg.createdAt ? new Date(msg.createdAt?.toDate ? msg.createdAt.toDate() : msg.createdAt).getTime() : 0;
            const grouped = prevMsg?.address === msg.address && (curTime - prevTime) < 120000;
            return (
              <div key={msg.id} className="msg-row" style={{ display: "flex", gap: 10, padding: grouped ? "1px 0" : "6px 0 0", animation: "fadeIn 0.2s ease", position: "relative" }}>
                <div style={{ width: 36, flexShrink: 0, paddingTop: 2 }}>
                  {!grouped && <Avatar address={msg.address} style={msg.avatarStyle} size={36} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {!grouped && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: isOwn ? P.purpleL : isAdminMsg ? P.gold : "#d4b8ff", fontFamily: P.raj }}>{shortAddr(msg.address)}</span>
                      {isAdminMsg && <span style={{ fontSize: 9, padding: "1px 6px", background: "rgba(255,183,0,0.12)", border: "1px solid rgba(255,183,0,0.25)", borderRadius: 3, color: P.gold, fontFamily: P.raj, fontWeight: 700 }}>ADMIN</span>}
                      <span style={{ fontSize: 10, color: P.dimMore, fontFamily: P.mono }}>{timeAgo(msg.createdAt)}</span>
                    </div>
                  )}
                  <div style={{ fontSize: 13, color: "#c4b8e0", fontFamily: "'Inter', sans-serif", lineHeight: 1.5, wordBreak: "break-word" }}>{msg.text}</div>
                </div>
                {isAdmin && (
                  <button className="delete-btn" onClick={() => handleDelete(msg.id)}
                    style={{ opacity: 0, position: "absolute", right: 0, top: 4, background: "rgba(255,68,68,0.1)", border: "1px solid rgba(255,68,68,0.2)", borderRadius: 4, color: "#ff4444", cursor: "pointer", fontSize: 10, padding: "2px 6px", transition: "opacity 0.15s", fontFamily: P.raj }}>
                    ✕
                  </button>
                )}
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
        <div style={{ padding: "12px 20px 16px", borderTop: `1px solid ${P.border}`, background: "rgba(13,11,26,0.8)", flexShrink: 0 }}>
          {!isConnected ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: "rgba(123,47,255,0.06)", border: `1px solid ${P.border}`, borderRadius: 10 }}>
              <span style={{ fontSize: 14 }}>🔒</span>
              <span style={{ fontSize: 12, color: P.dim, fontFamily: P.raj, flex: 1 }}>Connect wallet to join the conversation</span>
              <button onClick={() => open()} style={{ padding: "7px 16px", background: "linear-gradient(135deg,#7B2FFF,#5a1fd4)", border: "none", borderRadius: 7, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: P.raj }}>Connect</button>
            </div>
          ) : channel?.adminOnly && !isAdmin ? (
            <div style={{ padding: "12px 16px", background: "rgba(255,183,0,0.05)", border: "1px solid rgba(255,183,0,0.15)", borderRadius: 10, fontSize: 12, color: P.gold, fontFamily: P.raj, textAlign: "center" }}>📢 Only admins can post in announcements</div>
          ) : (
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
              <Avatar address={address} size={32} />
              <div style={{ flex: 1, position: "relative" }}>
                <textarea ref={inputRef} className="channel-input" value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
                  placeholder={`Message #${channel?.label}...`} rows={1}
                  style={{ width: "100%", padding: "10px 14px", background: "rgba(123,47,255,0.07)", border: "1px solid rgba(123,47,255,0.2)", borderRadius: 10, color: "#d4b8ff", fontSize: 13, fontFamily: "'Inter', sans-serif", resize: "none", boxSizing: "border-box", lineHeight: 1.5, maxHeight: 120, overflowY: "auto", transition: "border-color 0.18s" }} />
              </div>
              <button onClick={sendMessage} disabled={!input.trim() || sending}
                style={{ width: 38, height: 38, borderRadius: 9, border: "none", cursor: !input.trim() || sending ? "not-allowed" : "pointer", background: !input.trim() || sending ? "rgba(123,47,255,0.2)" : "linear-gradient(135deg,#7B2FFF,#5a1fd4)", color: !input.trim() || sending ? P.dimMore : "#fff", fontSize: 16, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.18s" }}>
                ↑
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}