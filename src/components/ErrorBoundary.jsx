// src/components/ErrorBoundary.jsx
//
// Catches render errors inside the <Routes> subtree so a thrown page
// (e.g. a Firestore timeout in Web2Profile or an unexpected shape in
// Web2Leaderboard) doesn't white-screen the whole app. Logs to console
// for the developer and shows the user a reset button that reloads
// without wiping their mode / wallet state.
//
// React still requires a class component for componentDidCatch — Error
// Boundaries are the one place functional components can't fully replace.

import { Component } from "react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", error, info?.componentStack);
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    const msg = String(this.state.error?.message || this.state.error || "Something went wrong.");

    return (
      <div style={{
        minHeight: "70vh", display: "flex", alignItems: "center",
        justifyContent: "center", padding: 24, color: "#fff",
        background: "#07090e",
      }}>
        <div style={{
          maxWidth: 480, padding: 28, borderRadius: 16, textAlign: "center",
          background: "linear-gradient(135deg, rgba(255,68,136,0.1), rgba(255,68,136,0.02))",
          border: "1px solid rgba(255,68,136,0.35)",
        }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
          <h2 style={{ fontFamily: "'Rajdhani',sans-serif", margin: 0, color: "#fff" }}>
            Something broke on this page
          </h2>
          <p style={{
            color: "rgba(255,200,210,0.75)", fontFamily: "'Rajdhani',sans-serif",
            fontSize: 13, marginTop: 10, wordBreak: "break-word",
          }}>
            {msg}
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 18, flexWrap: "wrap" }}>
            <button onClick={this.reset} style={{
              padding: "10px 22px",
              background: "linear-gradient(135deg,#ff4488,#b02764)", border: "none",
              borderRadius: 10, color: "#fff", fontWeight: 700, cursor: "pointer",
              fontFamily: "'Rajdhani',sans-serif", letterSpacing: "0.5px",
            }}>Try again</button>
            <button onClick={() => { window.location.href = "/"; }} style={{
              padding: "10px 22px",
              background: "rgba(123,47,255,0.15)",
              border: "1px solid rgba(180,150,255,0.35)",
              borderRadius: 10, color: "rgba(210,185,255,0.9)", fontWeight: 700, cursor: "pointer",
              fontFamily: "'Rajdhani',sans-serif", letterSpacing: "0.5px",
            }}>Go home</button>
          </div>
        </div>
      </div>
    );
  }
}
