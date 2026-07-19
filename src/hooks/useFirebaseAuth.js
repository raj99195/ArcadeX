// src/hooks/useFirebaseAuth.js
// Firebase Social Auth (Google + X/Twitter)
// Wallet auth ke liye useAuth.js use karo — ye alag hai
import { useState, useEffect } from "react";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { auth, googleProvider, twitterProvider } from "../lib/firebase";

export function useFirebaseAuth() {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  const loginWithGoogle = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      return result.user;
    } catch (err) {
      console.error("Google login failed:", err.message);
      throw err;
    }
  };

  const loginWithTwitter = async () => {
    try {
      const result = await signInWithPopup(auth, twitterProvider);
      return result.user;
    } catch (err) {
      console.error("Twitter login failed:", err.message);
      throw err;
    }
  };

  const logout = async () => {
    try { await signOut(auth); }
    catch (err) { console.error("Logout failed:", err.message); }
  };

  return {
    user,
    loading,
    isLoggedIn:  !!user,
    loginWithGoogle,
    loginWithTwitter,
    logout,
    displayName: user?.displayName || null,
    email:       user?.email || null,
    photoURL:    user?.photoURL || null,
    uid:         user?.uid || null,
  };
}
