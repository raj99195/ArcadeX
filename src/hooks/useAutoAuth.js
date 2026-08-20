// src/hooks/useAutoAuth.js
//
// Automatically authenticates the connected wallet against /api/auth the
// moment it connects, and stores the resulting JWT in localStorage as
// "arcadex_jwt" — the key every JWT-protected route (comments, likes,
// score submission, admin actions, badge claims, etc.) reads from.
//
// Before this hook existed, wallet "connect" only gave you an on-chain
// signer (via wagmi) — it never produced the off-chain JWT that the
// backend's verifyToken() checks for. Every JWT-gated request was
// silently failing with "Unauthorized" because arcadex_jwt was always
// null. This closes that gap with a single MetaMask signature, fired
// once per wallet connection (not once per page).
//
// Mount this once near the app root (see Providers.jsx) — it has no UI,
// it just runs the side effect.
//
// ── Named exports ──────────────────────────────────────────────────
// Also exports `signInAndGetJwt(address, walletClient)` and
// `hasValidJwtForWallet(address)` for imperative use from components
// (e.g. GamePlay.submitScore triggers sign-in on-demand if the user
// dismissed the auto-auth prompt earlier or their token expired
// mid-session).

import { useEffect, useRef } from "react";
import { useAccount, useWalletClient } from "wagmi";

const TOKEN_KEY = "arcadex_jwt";
const TOKEN_ADDRESS_KEY = "arcadex_jwt_address"; // which wallet this token belongs to

function getStoredAuth() {
  const token = localStorage.getItem(TOKEN_KEY);
  const tokenAddress = localStorage.getItem(TOKEN_ADDRESS_KEY);
  return { token, tokenAddress };
}

function isTokenStillValid(token) {
  if (!token) return false;
  try {
    // JWTs are base64url header.payload.signature — decode the payload to
    // check `exp` ourselves rather than waiting for a 401 from the server.
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (!payload.exp) return true; // no exp claim — assume valid, server will reject if not
    return Date.now() < payload.exp * 1000;
  } catch {
    return false; // malformed token — treat as invalid, will re-auth
  }
}

// ── Public helper ─────────────────────────────────────────────────
// Cheap sync check — is there a valid JWT already stored for this
// exact wallet? Callers use this to decide whether to trigger a fresh
// sign-in flow.
export function hasValidJwtForWallet(address) {
  if (!address) return false;
  const { token, tokenAddress } = getStoredAuth();
  if (!token) return false;
  if (tokenAddress?.toLowerCase() !== address.toLowerCase()) return false;
  return isTokenStillValid(token);
}

// ── Public helper ─────────────────────────────────────────────────
// Reusable sign-in: asks the wallet to sign a challenge message, posts
// it to /api/auth, stores the returned JWT, and returns it. Throws on
// failure (user rejection, network, invalid signature).
//
// Both `useAutoAuth` (on wallet-connect) and imperative callers like
// GamePlay's submitScore share this exact flow so behaviour is identical
// everywhere. Previously the same logic was inlined inside the hook's
// useEffect and couldn't be re-triggered on demand.
export async function signInAndGetJwt(address, walletClient) {
  if (!address) throw new Error("No wallet address");

  const message = `Sign in to ArcadeX\n${Date.now()}`;

  // walletClient.signMessage kuch wallets mein EIP-712 format use karta hai
  // jo ethers.verifyMessage se verify nahi hota — isliye directly
  // personal_sign use karo jo standard Ethereum prefix lagata hai.
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
    body: JSON.stringify({ address, signature, message }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Sign-in failed");

  localStorage.setItem(TOKEN_KEY, data.token);
  localStorage.setItem(TOKEN_ADDRESS_KEY, address.toLowerCase());
  return data.token;
}

export function useAutoAuth() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const signingRef = useRef(false); // guards against double-firing (e.g. fast re-renders, StrictMode)

  useEffect(() => {
    if (!isConnected || !address || !walletClient) return;
    if (hasValidJwtForWallet(address)) return; // already have a valid token for this exact wallet
    if (signingRef.current) return; // a sign-in attempt is already in flight
    signingRef.current = true;

    (async () => {
      try {
        await signInAndGetJwt(address, walletClient);
      } catch (err) {
        // User rejecting the signature is a normal, expected outcome (not
        // an error to surface loudly) — they just won't get JWT-gated
        // features (comments, badge claims, admin actions) until they
        // accept it. Everything else (wallet connect, on-chain plays,
        // reading public data) keeps working fine without it.
        //
        // Score submission specifically re-triggers sign-in on-demand
        // via signInAndGetJwt(), so a rejection here doesn't permanently
        // lock the user out of submitting scores.
        console.warn("Auto sign-in skipped:", err.message);
      } finally {
        signingRef.current = false;
      }
    })();
  }, [isConnected, address, walletClient]);
}
