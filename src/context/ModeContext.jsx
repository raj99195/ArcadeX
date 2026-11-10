import { createContext, useState } from "react";

export const ModeContext = createContext(null);
export const WEB2_ENABLED = import.meta.env.VITE_ENABLE_WEB2 === "true";

const STORAGE_KEY = "arcadex_mode";

/**
 * Mode = "web2" | "web3" | null (null = first visit, show selector).
 * Persisted in localStorage so returning users skip the picker.
 *
 * Place at: src/context/ModeContext.jsx
 */
export function ModeProvider({ children }) {
  const [mode, setModeState] = useState(() => {
    if (!WEB2_ENABLED) return "web3";
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      return saved === "web2" || saved === "web3" ? saved : null;
    } catch {
      return null;
    }
  });

  const hasSelectedMode = mode === "web2" || mode === "web3";

  const setMode = (newMode) => {
    if (!WEB2_ENABLED) return;
    if (newMode !== "web2" && newMode !== "web3") return;
    setModeState(newMode);
    try { window.localStorage.setItem(STORAGE_KEY, newMode); } catch {}
  };

  const clearMode = () => {
    if (!WEB2_ENABLED) return;
    setModeState(null);
    try { window.localStorage.removeItem(STORAGE_KEY); } catch {}
  };

  return (
    <ModeContext.Provider value={{ mode, hasSelectedMode, setMode, clearMode }}>
      {children}
    </ModeContext.Provider>
  );
}
