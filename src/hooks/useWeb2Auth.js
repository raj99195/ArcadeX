// Place at: src/hooks/useWeb2Auth.js
//
// Thin re-export so existing imports (`src/hooks/useWeb2Auth`) keep working.
// Real state lives in Web2AuthProvider; the hook is colocated with the
// Provider in context/Web2AuthContext to avoid HMR context-identity drift.
export { useWeb2AuthShared as useWeb2Auth } from "../context/Web2AuthContext";
