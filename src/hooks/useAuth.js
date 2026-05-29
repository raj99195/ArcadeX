// src/hooks/useAuth.js
import { useState, useEffect, useCallback } from "react";
import { useAccount, useSignMessage } from "wagmi";

const TOKEN_KEY = "arcadex_jwt";
const ADDR_KEY = "arcadex_address";

export function useAuth() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [signing, setSigning] = useState(false);

  // Clear token if address changes
  useEffect(() => {
    const saved = localStorage.getItem(ADDR_KEY);
    if (address && saved && saved !== address.toLowerCase()) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(ADDR_KEY);
      setToken(null);
    }
  }, [address]);

  // Clear on disconnect
  useEffect(() => {
    if (!isConnected) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(ADDR_KEY);
      setToken(null);
    }
  }, [isConnected]);

  const login = useCallback(async () => {
    if (!address || signing) return null;
    setSigning(true);
    try {
      const message = `ArcadeX Login\nWallet: ${address}\nTimestamp: ${Date.now()}`;
      const signature = await signMessageAsync({ message });
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, signature, message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Auth failed");
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(ADDR_KEY, address.toLowerCase());
      setToken(data.token);
      return data.token;
    } catch (err) {
      console.error("Login failed:", err);
      return null;
    } finally { setSigning(false); }
  }, [address, signing, signMessageAsync]);

  // API call with auto-login
  const api = useCallback(async (url, options = {}) => {
    let t = token;
    if (!t && isConnected) t = await login();
    return fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(t ? { Authorization: `Bearer ${t}` } : {}),
        ...options.headers,
      },
      body: options.body ? (typeof options.body === "string" ? options.body : JSON.stringify(options.body)) : undefined,
    });
  }, [token, isConnected, login]);

  return { token, isAuthenticated: !!token, login, signing, api };
}
