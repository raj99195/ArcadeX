// src/hooks/useAutoAuth.js
//
// Auto-signs the connected wallet against /api/auth on connect, storing
// the returned JWT in localStorage as "arcadex_jwt". Everything JWT-gated
// (comments, likes, score submission, admin actions, badge claims) reads
// from that key.
//
// This version wires in Cloudflare Turnstile: before asking the wallet to
// sign, we fetch a Turnstile token from the app-wide widget (invisible
// for legit users) and send it alongside the signature. The backend
// verifies it before issuing a JWT.
//
// ── Named exports ───────────────────────────────────────────────────
//   signInAndGetJwt(address, walletClient, getTurnstileToken?)
//     Imperative sign-in for on-demand use (e.g. GamePlay's submitScore
//     when the user dismissed auto-auth or their token expired).
//     `getTurnstileToken` is an async function returning a Turnstile
//     token; components should get it from `useTurnstile().getToken`.
//
//   hasValidJwtForWallet(address)
//     Cheap sync check — is there a valid, non-expired JWT already
//     stored for this exact wallet?

import { useEffect, useRef } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { useTurnstile } from "../context/TurnstileContext";

const TOKEN_KEY         = "arcadex_jwt";
const TOKEN_ADDRESS_KEY = "arcadex_jwt_address";

function getStoredAuth() {
  const token        = localStorage.getItem(TOKEN_KEY);
  const tokenAddress = localStorage.getItem(TOKEN_ADDRESS_KEY);
  return { token, tokenAddress };
}

function isTokenStillValid(token) {
  if (!token) return false;
  try {
    const payload = JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))
    );
    if (!payload.exp) return true;
    return Date.now() < payload.exp * 1000;
  } catch {
    return false;
  }
}

export function hasValidJwtForWallet(address) {
  if (!address) return false;
  const { token, tokenAddress } = getStoredAuth();
  if (!token) return false;
  if (tokenAddress?.toLowerCase() !== address.toLowerCase()) return false;
  return isTokenStillValid(token);
}

// ── Imperative sign-in ──────────────────────────────────────────────
// Called by the hook on wallet-connect, and by components (GamePlay's
// submitScore) when they need to sign-in on demand.
//
// `getTurnstileToken` is optional so this helper can be called from
// contexts that don't have Turnstile mounted (tests, error paths). If
// omitted, no token is sent and the backend decides whether to accept
// based on its own env config.
export async function signInAndGetJwt(address, walletClient, getTurnstileToken) {
  if (!address) throw new Error("No wallet address");

  // ── Turnstile first, wallet signature second ──
  // Order matters: fetching the Turnstile token is invisible for legit
  // users, so doing it FIRST means they see exactly one prompt (the
  // wallet signature). If Cloudflare needs interaction, that small
  // checkbox shows before the wallet popup, not sandwiched into it.
  let turnstileToken = null;
  if (typeof getTurnstileToken === "function") {
    try {
      turnstileToken = await getTurnstileToken();
    } catch (e) {
      // Timeout or widget error — proceed without a token. The backend
      // will reject if TURNSTILE_SECRET_KEY is set; will accept if not
      // (letting us deploy the code before flipping the switch).
      console.warn("Turnstile token fetch failed:", e.message);
    }
  }

  const message = `Sign in to ArcadeX\n${Date.now()}`;

  // Some wallets (WalletConnect, Coinbase) sign with EIP-712 via
  // walletClient.signMessage and produce a signature ethers can't
  // recover. Prefer personal_sign directly when window.ethereum exists —
  // it always uses the standard Ethereum prefix.
  let signature;
  if (window.ethereum) {
    signature = await window.ethereum.request({
      method: "personal_sign",
      params: [message, address],
    });
  } else if (walletClient) {
    signature = await walletClient.signMessage({ message });
  } else {
    throw new Error("No wallet client available");
  }

  const res = await fetch("/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, signature, message, turnstileToken }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Sign-in failed");

  localStorage.setItem(TOKEN_KEY, data.token);
  localStorage.setItem(TOKEN_ADDRESS_KEY, address.toLowerCase());
  return data.token;
}

export function useAutoAuth() {
  const { address, isConnected } = useAccount();
  const { data: walletClient }   = useWalletClient();
  const { getToken: getTurnstileToken } = useTurnstile();
  const signingRef = useRef(false); // guards against double-firing (StrictMode, fast re-renders)

  useEffect(() => {
    if (!isConnected || !address || !walletClient) return;
    if (hasValidJwtForWallet(address)) return;
    if (signingRef.current) return;
    signingRef.current = true;

    (async () => {
      try {
        await signInAndGetJwt(address, walletClient, getTurnstileToken);
      } catch (err) {
        // User rejecting the signature is a normal, expected outcome.
        // They just won't get JWT-gated features until they accept it.
        // submitScore re-triggers sign-in on demand, so rejection here
        // doesn't permanently lock them out of submitting scores.
        console.warn("Auto sign-in skipped:", err.message);
      } finally {
        signingRef.current = false;
      }
    })();
  }, [isConnected, address, walletClient, getTurnstileToken]);
}