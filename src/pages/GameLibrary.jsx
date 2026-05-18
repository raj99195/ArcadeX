import { useState } from "react";
import GameCard from "../components/GameCard";
import { useGames } from "../hooks/useGames";

const categories = ["All", "Action", "Runner", "Strategy", "Puzzle", "Casual", "Shooter", "Adventure"];

export default function GameLibrary() {
  const [active, setActive] = useState("All");
  const [search, setSearch] = useState("");
  const { games, loading } = useGames();

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
        <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(123,47,255,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(123,47,255,0.07) 1px, transparent 1px)", backgroundSize: "50px 50px" }} />
        <div style={{ position: "absolute", top: "10%", left: "50%", transform: "translateX(-50%)", width: 600, height: 400, background: "radial-gradient(circle, rgba(123,47,255,0.15) 0%, transparent 70%)", borderRadius: "50%" }} />
        <div style={{ position: "absolute", bottom: 0, right: 0, width: 400, height: 400, background: "radial-gradient(circle, rgba(0,212,255,0.06) 0%, transparent 70%)", borderRadius: "50%" }} />
      </div>

      {/* Page Content */}
      <div className="gl-content" style={{ position: "relative", zIndex: 1, padding: "28px 36px", display: "flex", flexDirection: "column", minHeight: "calc(100vh - 54px)" }}>

        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <h1 className="gl-header" style={{ fontSize: 42, fontWeight: 700, color: "#fff", fontFamily: "'Rajdhani',sans-serif", textTransform: "uppercase" }}>
            ALL{" "}
            <span style={{ background: "linear-gradient(90deg,#7B2FFF,#00d4ff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              GAMES
            </span>
          </h1>
          <p style={{ color: "#aaa", marginTop: 6, fontSize: 13 }}>Discover, play and compete in on-chain games.</p>
        </div>

        {/* Filter + Search */}
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 24 }}>
          <div className="gl-filter-row" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {categories.map(cat => (
              <button key={cat} onClick={() => setActive(cat)} style={{
                padding: "7px 14px", borderRadius: 20,
                border: `1px solid ${active === cat ? "rgba(123,47,255,0.4)" : "rgba(123,47,255,0.1)"}`,
                background: active === cat ? "rgba(123,47,255,0.25)" : "rgba(20,15,40,0.5)",
                color: active === cat ? "#fff" : "#aaa",
                cursor: "pointer", fontSize: 12,
                fontFamily: "'Rajdhani',sans-serif", fontWeight: 600,
              }}>
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
              padding: "10px 14px", borderRadius: 10,
              border: "1px solid rgba(123,47,255,0.2)",
              background: "rgba(20,15,40,0.6)",
              color: "#fff", outline: "none", fontSize: 13,
            }}
          />
        </div>

        {/* Grid */}
        {loading ? (
          <div style={{ textAlign: "center", padding: 50, color: "#aaa", fontFamily: "'Rajdhani',sans-serif" }}>
            Loading games...
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: 50 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🎮</div>
            <div style={{ color: "#a67fff", fontFamily: "'Rajdhani',sans-serif", fontSize: 14 }}>No games found</div>
          </div>
        ) : (
          <div className="gl-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20 }}>
            {filtered.map(game => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        )}

        {/* Bottom Info */}
        <div className="gl-bottom" style={{ marginTop: "auto", width: "100%", maxWidth: "900px", alignSelf: "center", padding: "14px 18px", borderRadius: 12, background: "rgba(10,8,20,0.85)", border: "1px solid rgba(123,47,255,0.2)", display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginTop: 24 }}>
          {[
            ["🛡️", "On-Chain", "Fully verified"],
            ["⚡", "Instant Play", "No downloads"],
            ["🏆", "Rewards", "Earn real"],
            ["🔒", "Secure", "Blockchain"],
          ].map(([icon, title, desc]) => (
            <div key={title} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(123,47,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, border: "1px solid rgba(123,47,255,0.3)", flexShrink: 0 }}>
                {icon}
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#c4a0ff" }}>{title}</div>
                <div style={{ fontSize: 9, color: "#777" }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}