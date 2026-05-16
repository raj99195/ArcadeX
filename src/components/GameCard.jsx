import { useNavigate } from "react-router-dom";

const tagColors = {
  HOT: { bg: "#ff4444", color: "#fff" },
  NEW: { bg: "#7B2FFF", color: "#fff" },
  TOP: { bg: "linear-gradient(90deg,#7B2FFF,#00d4ff)", color: "#fff" },
};

export default function GameCard({ game }) {
  const navigate = useNavigate();

  return (
    <div
      onClick={() => navigate(`/play/${game.id}`)}
      style={{
        background: "#0e0c1a",
        border: "1px solid rgba(123,47,255,0.1)",
        borderRadius: 10,
        overflow: "hidden",
        cursor: "pointer",
        transition: "all 0.22s",
        display: "flex",
        flexDirection: "column",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = "rgba(123,47,255,0.4)";
        e.currentTarget.style.transform = "translateY(-3px)";
        e.currentTarget.style.boxShadow = "0 8px 24px rgba(123,47,255,0.15)";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = "rgba(123,47,255,0.1)";
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "none";
      }}
    >

      {/* ── THUMBNAIL ── fixed 16:9 ratio box, image always fills it */}
      <div style={{
        width: "100%",
        paddingTop: "62%",
        position: "relative",
        background: game.bg || "#0d0a1a",
        overflow: "hidden",
        flexShrink: 0,
      }}>

        {game.thumbnailUrl ? (
          <img
            src={game.thumbnailUrl}
            alt={game.name}
            loading="lazy"
            style={{
              position: "absolute",
              top: 0, left: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: "center",
              display: "block",
            }}
            onError={e => { e.target.style.display = "none"; }}
          />
        ) : (
          <span style={{
            position: "absolute",
            top: 0, left: 0,
            width: "100%", height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 44,
            filter: "drop-shadow(0 0 12px rgba(123,47,255,0.4))",
          }}>
            {game.emoji || "🎮"}
          </span>
        )}

        {/* Bottom gradient */}
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0,
          height: "50%",
          background: "linear-gradient(to top, rgba(14,12,26,0.85), transparent)",
          pointerEvents: "none",
          zIndex: 1,
        }} />

        {/* Tag badge */}
        {game.tag && (
          <span style={{
            position: "absolute", top: 9, left: 9, zIndex: 2,
            padding: "3px 8px", borderRadius: 4,
            fontSize: 8, fontWeight: 700,
            letterSpacing: "0.8px", textTransform: "uppercase",
            fontFamily: "'Rajdhani',sans-serif",
            background: tagColors[game.tag]?.bg || "#7B2FFF",
            color: tagColors[game.tag]?.color || "#fff",
          }}>
            {game.tag}
          </span>
        )}

        {/* Category badge */}
        <span style={{
          position: "absolute", bottom: 9, left: 9, zIndex: 2,
          padding: "2px 7px", borderRadius: 3,
          fontSize: 8, color: "rgba(180,150,255,0.6)",
          background: "rgba(123,47,255,0.15)",
          border: "1px solid rgba(123,47,255,0.2)",
          fontFamily: "'Rajdhani',sans-serif", fontWeight: 600, letterSpacing: "0.5px",
        }}>
          {game.category}
        </span>
      </div>

      {/* ── INFO ── */}
      <div style={{ padding: "12px 14px 0", flex: 1 }}>
        <div style={{
          fontSize: 13, fontWeight: 700, marginBottom: 3,
          fontFamily: "'Rajdhani',sans-serif", letterSpacing: "0.2px",
          color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {game.name}
        </div>
        <div style={{
          fontSize: 10, color: "#7755aa", marginBottom: 8,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          fontFamily: "'Rajdhani',sans-serif",
        }}>
          {game.description || "A blockchain game on Initia"}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontSize: 10, color: "#7755aa", fontFamily: "'Rajdhani',sans-serif" }}>
                   </span>
          <span style={{ fontSize: 10, color: "#a67fff", fontFamily: "'Orbitron',sans-serif", fontWeight: 600 }}>
            +{game.reward || game.rewardRate || 50} ARCADE
          </span>
        </div>
      </div>

      {/* ── PLAY BUTTON ── */}
      <div style={{ padding: "0 14px 12px" }}>
        <button
          className="play-btn"
          style={{
            width: "100%", padding: "8px",
            background: "linear-gradient(90deg,#7B2FFF,#5a1fd4)",
            border: "1px solid rgba(123,47,255,0.4)",
            borderRadius: 6,
            fontFamily: "'Rajdhani',sans-serif", fontWeight: 700,
            fontSize: 11, color: "#fff",
            cursor: "pointer", letterSpacing: "1.5px",
            textTransform: "uppercase", transition: "all 0.18s",
          }}
        >
          Play Now
        </button>
      </div>
    </div>
  );
}