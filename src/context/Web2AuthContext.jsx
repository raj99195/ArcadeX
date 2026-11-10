// Place at: src/context/Web2AuthContext.jsx
//
// Shared Web2 auth state (Google + X via Firebase + Guest UUID).
// Previously useWeb2Auth was a plain hook with per-instance local state,
// so App.jsx, Web2LoginScreen and Navbar each held their own copy of
// `user`. Guest sign-in only updated the login screen's copy — App.jsx's
// overlay check never saw it, and guest sign-out never fired a Firebase
// event, so the Navbar's copy stayed stale too. One Provider = one truth.
//
// The hook `useWeb2Auth` is colocated here so Vite HMR can't end up with
// a stale hook pointing at a swapped-out context instance.

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { signInWithPopup, signOut as fbSignOut, onAuthStateChanged } from "firebase/auth";
import { auth, googleProvider, twitterProvider } from "../lib/firebase";

const Web2AuthContext = createContext(null);

const GUEST_UUID_KEY = "arcadex_guest_uuid";
const GUEST_NAME_KEY = "arcadex_guest_name";

export function Web2AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let unsub = () => {};
    try {
      unsub = onAuthStateChanged(auth, (fbUser) => {
        if (fbUser) {
          const providerId = fbUser.providerData?.[0]?.providerId || "";
          setUser({
            uid: fbUser.uid,
            displayName: fbUser.displayName || "Player",
            photoURL: fbUser.photoURL || null,
            provider: providerId.includes("twitter") ? "twitter"
                    : providerId.includes("google")  ? "google"
                    : providerId,
            isGuest: false,
            firebaseUser: fbUser,
          });
        } else {
          try {
            const uuid = localStorage.getItem(GUEST_UUID_KEY);
            const name = localStorage.getItem(GUEST_NAME_KEY);
            if (uuid) {
              setUser({
                uid: uuid,
                displayName: name || `Guest-${uuid.slice(0, 4).toUpperCase()}`,
                photoURL: null,
                provider: "guest",
                isGuest: true,
                firebaseUser: null,
              });
            } else {
              setUser(null);
            }
          } catch {
            setUser(null);
          }
        }
        setLoading(false);
      });
    } catch (e) {
      // Firebase not configured / blocked — fail open with no user so the
      // app still renders the login screen instead of a blank page.
      console.warn("Web2 auth init failed:", e?.message || e);
      setLoading(false);
    }
    return () => { try { unsub(); } catch {} };
  }, []);

  const signInGoogle = useCallback(async () => {
    setError(null);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      return result.user;
    } catch (e) {
      setError(e.message || "Google sign-in failed");
      throw e;
    }
  }, []);

  const signInTwitter = useCallback(async () => {
    setError(null);
    try {
      const result = await signInWithPopup(auth, twitterProvider);
      return result.user;
    } catch (e) {
      setError(e.message || "X sign-in failed");
      throw e;
    }
  }, []);

  const signInGuest = useCallback(() => {
    setError(null);
    try {
      let uuid = localStorage.getItem(GUEST_UUID_KEY);
      if (!uuid) {
        uuid = (typeof crypto !== "undefined" && crypto.randomUUID)
          ? crypto.randomUUID()
          : "guest-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
        localStorage.setItem(GUEST_UUID_KEY, uuid);
      }
      let name = localStorage.getItem(GUEST_NAME_KEY);
      if (!name) {
        name = `Guest-${uuid.slice(0, 4).toUpperCase()}`;
        localStorage.setItem(GUEST_NAME_KEY, name);
      }
      const guestUser = {
        uid: uuid,
        displayName: name,
        photoURL: null,
        provider: "guest",
        isGuest: true,
        firebaseUser: null,
      };
      setUser(guestUser);
      return guestUser;
    } catch (e) {
      setError("Browser storage blocked — guest mode needs localStorage.");
      throw e;
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      // Guests have no Firebase session, so onAuthStateChanged won't fire —
      // the state wipe below is what actually logs them out.
      if (auth.currentUser) {
        try { await fbSignOut(auth); } catch (e) { console.warn("fb signOut:", e); }
      }
      try {
        localStorage.removeItem(GUEST_UUID_KEY);
        localStorage.removeItem(GUEST_NAME_KEY);
      } catch {}
      setUser(null);
    } catch (e) {
      console.warn("Web2 signOut failed:", e);
    }
  }, []);

  const value = {
    user,
    loading,
    error,
    isAuthenticated: !!user,
    isGuest: user?.isGuest || false,
    signInGoogle,
    signInTwitter,
    signInGuest,
    signOut,
  };

  return (
    <Web2AuthContext.Provider value={value}>
      {children}
    </Web2AuthContext.Provider>
  );
}

// Colocated hook — guarantees the context identity used here matches
// what Web2AuthProvider renders, even across Vite HMR module swaps.
export function useWeb2AuthShared() {
  const ctx = useContext(Web2AuthContext);
  if (!ctx) throw new Error("useWeb2Auth must be used inside <Web2AuthProvider>");
  return ctx;
}
