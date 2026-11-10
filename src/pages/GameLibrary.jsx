import { useState } from "react";
import GameCard from "../components/GameCard";
import { useGames } from "../hooks/useGames";
import { Icon } from "../components/Icon";
import { useMode } from "../hooks/useMode";

const categories = ["All", "Action", "Runner", "Strategy", "Puzzle", "Casual", "Shooter", "Adventure"];

export default function GameLibrary() {
  const [active, setActive] = useState("All");
  const [search, setSearch] = useState("");
  const { games, loading } = useGames();
  const { mode } = useMode();
  const isWeb2 = mode === "web2";

  const filtered = (active === "All" ? games : games.filter(g => g.category === active))
    .filter(g => g.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{ minHeight: "calc(100vh - 54px)", background: "#08070f", position: "relative" }}>

      <style>{`
        @media (max-width: 768px) {
          .gl-grid { grid-template-columns: repeat(2, 1fr) !important; gap: 12px !important; }
          .gl-header { font-size: 28px !important; }
          .gl-content { padding: 16px !important; }
          .gl-bottom { grid-template-columns: repeat(2,1fr) !important; }
          .gl-search { width: 100% !important; }
          .gl-filter-row { flex-wrap: wrap !important; }
        }
        @media (max-width: 400px) {
          .gl-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>

      {/* Grid BG */}
      <div style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", background: "#08070f" }}>
        <div className="ax-grid-bg" style={{ position: "absolute", inset: 0 }} />
        <div
          className="ax-float"
          style={{
            position: "absolute", top: "10%", left: "50%", transform: "translateX(-50%)",
            width: 600, height: 400,
            background: "radial-gradient(circle, rgba(123,47,255,0.18) 0%, transparent 70%)",
            borderRadius: "50%",
          }} />
        <div
          className="ax-float-rotate"
          style={{
            position: "absolute", bottom: 0, right: 0, width: 400, height: 400,
            background: "radial-gradient(circle, rgba(0,212,255,0.08) 0%, transparent 70%)",
            borderRadius: "50%",
          }} />
        <div
          className="ax-breathe"
          style={{
            position: "absolute", top: "40%", left: "15%", width: 320, height: 320,
            background: "radial-gradient(circle, rgba(255,110,196,0.08) 0%, transparent 70%)",
            borderRadius: "50%",
          }} />
      </div>

      {/* Page Content */}
      <div className="gl-content" style={{ position: "relative", zIndex: 1, padding: "28px 36px", display: "flex", flexDirection: "column", minHeight: "calc(100vh - 54px)" }}>

        {/* Header */}
        <div className="ax-fade-down" style={{ marginBottom: 20 }}>
          <div
            className="ax-fade-down"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "4px 11px", border: "1px solid rgba(123,47,255,0.3)",
              borderRadius: 4, fontSize: 9, color: "#a67fff",
              letterSpacing: "1.5px", textTransform: "uppercase",
              marginBottom: 12, background: "rgba(123,47,255,0.08)",
              fontFamily: "'Rajdhani',sans-serif", fontWeight: 600,
            }}>
            <span style={{
              width: 5, height: 5, borderRadius: "50%", background: "#00FF88",
              animation: "axPulse 1.5s ease-in-out infinite",
            }} />
            {isWeb2 ? "Web2 · Instant Play" : "On-Chain · Verified"}
          </div>
          <h1 className="gl-header ax-slide-left" style={{
            fontSize: 42, fontWeight: 700, color: "#fff",
            fontFamily: "'Rajdhani',sans-serif", textTransform: "uppercase",
            margin: 0, letterSpacing: "-0.5px",
          }}>
            ALL{" "}
            <span className="ax-holo-text">GAMES</span>
          </h1>
          <p
            className="ax-fade-in"
            style={{
              color: "#d8ccf0", marginTop: 8, fontSize: 15,
              fontFamily: "'Rajdhani',sans-serif", fontWeight: 500,
              animationDelay: "0.2s",
              lineHeight: 1.5,
            }}>
            {isWeb2
              ? "Discover, play and earn ArcadeCoins — no wallet required."
              : "Discover, play and compete in on-chain games."}
          </p>
        </div>

        {/* Filter + Search */}
        <div className="ax-fade-up" style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 24, animationDelay: "0.1s" }}>
          <div className="gl-filter-row ax-stagger" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setActive(cat)}
                className="ax-beam-host"
                style={{
                  padding: "7px 16px", borderRadius: 20,
                  border: `1px solid ${active === cat ? "rgba(123,47,255,0.6)" : "rgba(123,47,255,0.12)"}`,
                  background: active === cat
                    ? "linear-gradient(135deg,rgba(123,47,255,0.35),rgba(0,212,255,0.15))"
                    : "rgba(20,15,40,0.5)",
                  color: active === cat ? "#fff" : "#aaa",
                  cursor: "pointer", fontSize: 12,
                  fontFamily: "'Rajdhani',sans-serif", fontWeight: 600,
                  letterSpacing: "0.5px",
                  transition: "all 0.25s cubic-bezier(0.2,1,0.3,1)",
                  boxShadow: active === cat ? "0 4px 16px rgba(123,47,255,0.3)" : "none",
                  transform: active === cat ? "translateY(-1px)" : "translateY(0)",
                }}
                onMouseEnter={(e) => {
                  if (active !== cat) {
                    e.currentTarget.style.borderColor = "rgba(123,47,255,0.4)";
                    e.currentTarget.style.color = "#c4a0ff";
                    e.currentTarget.style.transform = "translateY(-2px)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (active !== cat) {
                    e.currentTarget.style.borderColor = "rgba(123,47,255,0.12)";
                    e.currentTarget.style.color = "#aaa";
                    e.currentTarget.style.transform = "translateY(0)";
                  }
                }}
              >
                {cat}
              </button>
            ))}
          </div>

          <input
            className="gl-search"
            placeholder="Search games..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              padding: "10px 16px", borderRadius: 10,
              border: "1px solid rgba(123,47,255,0.2)",
              background: "rgba(20,15,40,0.6)",
              color: "#fff", outline: "none", fontSize: 13,
              fontFamily: "'Rajdhani',sans-serif",
              transition: "border-color 0.3s, box-shadow 0.3s",
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = "rgba(123,47,255,0.6)";
              e.currentTarget.style.boxShadow = "0 0 0 3px rgba(123,47,255,0.15)";
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = "rgba(123,47,255,0.2)";
              e.currentTarget.style.boxShadow = "none";
            }}
          />
        </div>

        {/* Grid */}
        {loading ? (
          <div style={{ textAlign: "center", padding: 50, color: "#aaa", fontFamily: "'Rajdhani',sans-serif", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
            <div
              className="ax-aura"
              style={{
                width: 44, height: 44, borderRadius: "50%",
                border: "3px solid rgba(123,47,255,0.2)",
                borderTopColor: "#7B2FFF",
                animation: "axOrbit 1s linear infinite, axAura 2s ease-in-out infinite",
              }} />
            <div style={{ fontSize: 11, letterSpacing: "2px", textTransform: "uppercase", color: "#a67fff" }}>Loading games...</div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="ax-fade-up" style={{ textAlign: "center", padding: 50 }}>
            <div className="ax-aura ax-float" style={{ marginBottom: 12, color: "#a67fff", display: "flex", justifyContent: "center" }}>
              <Icon name="controller" size={40} />
            </div>
            <div style={{ color: "#a67fff", fontFamily: "'Rajdhani',sans-serif", fontSize: 14 }}>No games found</div>
          </div>
        ) : (
          <div className="gl-grid ax-stagger" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20 }}>
            {filtered.map((game) => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        )}

        {/* Bottom Info */}
        <div
          className="gl-bottom ax-fade-up ax-shine-border"
          style={{
            marginTop: 24, width: "100%", maxWidth: "900px",
            alignSelf: "center", padding: "16px 20px",
            borderRadius: 14, background: "rgba(10,8,20,0.85)",
            border: "1px solid rgba(123,47,255,0.2)",
            display: "grid", gridTemplateColumns: "repeat(4,1fr)",
            gap: 12, animationDelay: "0.3s",
            backdropFilter: "blur(16px)",
            position: "relative",
          }}>
          {(isWeb2
            ? [
                ["user",       "No Wallet",    "Google / X login"],
                ["bolt",       "Instant Play", "No downloads"],
                ["coin",       "ArcadeCoins",  "500 /day free"],
                ["controller", "Any Device",   "Phone or desktop"],
              ]
            : [
                ["shield", "On-Chain",    "Fully verified"],
                ["bolt",   "Instant Play","No downloads"],
                ["trophy", "Rewards",     "Earn real"],
                ["lock",   "Secure",      "Blockchain"],
              ]
          ).map(([icon, title, desc], i) => (
            <div
              key={title}
              className="ax-lift"
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: 6, borderRadius: 10,
                transition: "background 0.25s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(123,47,255,0.08)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <div
                className="ax-aura"
                style={{
                  width: 36, height: 36, borderRadius: "50%",
                  background: "linear-gradient(135deg,rgba(123,47,255,0.3),rgba(0,212,255,0.1))",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  border: "1px solid rgba(123,47,255,0.35)",
                  flexShrink: 0, color: "#c4a0ff",
                  animationDelay: `${i * 0.3}s`,
                }}>
                <Icon name={icon} size={16} />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#e0d8f5", fontFamily: "'Rajdhani',sans-serif", letterSpacing: "0.5px" }}>{title}</div>
                <div style={{ fontSize: 12, color: "#b4a9db", fontFamily: "'Rajdhani',sans-serif", fontWeight: 500 }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}