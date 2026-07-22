{/* ───────────────── HOW TO PLAY MODAL ───────────────── */}
{showHelpModal && (
  <div
    onClick={() => setShowHelpModal(false)}
    style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,.78)",
      backdropFilter: "blur(10px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 20,
      zIndex: 99999,
    }}
  >
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        width: "100%",
        maxWidth: 720,
        maxHeight: "85vh",
        overflowY: "auto",
        background: "linear-gradient(180deg,#141026,#0d0b1a)",
        border: "1px solid rgba(123,47,255,.25)",
        borderRadius: 18,
        boxShadow: "0 20px 60px rgba(0,0,0,.6)",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "18px 22px",
          borderBottom: "1px solid rgba(123,47,255,.15)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <div
            style={{
              fontFamily: C.orb,
              fontSize: 22,
              color: "#fff",
              fontWeight: 700,
            }}
          >
            ❓ How to Play
          </div>

          <div
            style={{
              fontSize: 11,
              color: C.dimMore,
              marginTop: 4,
              fontFamily: C.raj,
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            {game.name}
          </div>
        </div>

        <button
          onClick={() => setShowHelpModal(false)}
          style={{
            width: 38,
            height: 38,
            borderRadius: "50%",
            border: "1px solid rgba(123,47,255,.25)",
            background: "rgba(123,47,255,.08)",
            color: "#fff",
            cursor: "pointer",
            fontSize: 18,
          }}
        >
          ✕
        </button>
      </div>

      {/* Content */}
      <div
        style={{
          padding: 22,
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        {[
          {
            icon: "🎯",
            title: "Objective",
            value: game.helpContent?.objective,
          },
          {
            icon: "🎮",
            title: "Controls",
            value: game.helpContent?.controls,
          },
          {
            icon: "📖",
            title: "Instructions",
            value: game.helpContent?.instructions,
          },
          {
            icon: "💡",
            title: "Tips",
            value: game.helpContent?.tips,
          },
        ]
          .filter((x) => x.value)
          .map((item) => (
            <div
              key={item.title}
              style={{
                background: "rgba(123,47,255,.05)",
                border: "1px solid rgba(123,47,255,.12)",
                borderRadius: 12,
                padding: 18,
              }}
            >
              <div
                style={{
                  color: "#fff",
                  fontWeight: 700,
                  marginBottom: 10,
                  fontFamily: C.raj,
                  fontSize: 14,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span>{item.icon}</span>
                {item.title}
              </div>

              <div
                style={{
                  color: "#c9b8ff",
                  lineHeight: 1.7,
                  fontSize: 13,
                  whiteSpace: "pre-wrap",
                  fontFamily: C.raj,
                }}
              >
                {item.value}
              </div>
            </div>
          ))}

        {game.helpContent?.videoUrl && (
          <div
            style={{
              background: "rgba(123,47,255,.05)",
              border: "1px solid rgba(123,47,255,.12)",
              borderRadius: 12,
              padding: 18,
            }}
          >
            <div
              style={{
                color: "#fff",
                fontWeight: 700,
                marginBottom: 14,
                fontFamily: C.raj,
              }}
            >
              ▶ Tutorial Video
            </div>

            <iframe
              src={game.helpContent.videoUrl.replace(
                "watch?v=",
                "embed/"
              )}
              title="Tutorial"
              width="100%"
              height="320"
              style={{
                border: "none",
                borderRadius: 12,
              }}
              allowFullScreen
            />
          </div>
        )}
      </div>
    </div>
  </div>
)}