// src/context/TurnstileContext.jsx
//
// Provides a single app-wide Turnstile widget instance + a `getToken()`
// function via context. Mount <TurnstileProvider> once high in the tree
// (see Providers.jsx). Anywhere below can then do:
//
//   const { getToken } = useTurnstile();
//   const token = await getToken();
//   // pass `token` to backend along with the auth request
//
// The widget itself is invisible for 99%+ of users (Cloudflare "managed"
// mode + "interaction-only" appearance). Suspicious traffic sees a small
// 1-tap checkbox rendered by Cloudflare — we don't control that overlay.
//
// `getToken()` returns the cached token if one is fresh, otherwise waits
// for the widget's next `onSuccess`. Times out after 30s.

import { createContext, useCallback, useContext, useRef } from "react";
import TurnstileWidget from "../components/TurnstileWidget";

const TurnstileContext = createContext(null);

export function TurnstileProvider({ children }) {
  const widgetRef = useRef(null);

  const getToken = useCallback(async () => {
    if (!widgetRef.current) {
      // Widget didn't mount (site key missing, or SSR). Return null so
      // callers can proceed without a token — the backend will decide
      // whether to accept the request based on TURNSTILE_SECRET_KEY.
      return null;
    }
    return widgetRef.current.execute();
  }, []);

  return (
    <TurnstileContext.Provider value={{ getToken }}>
      <TurnstileWidget ref={widgetRef} />
      {children}
    </TurnstileContext.Provider>
  );
}

export function useTurnstile() {
  const ctx = useContext(TurnstileContext);
  // Fallback for tests / components rendered outside the provider:
  // getToken() returns null → backend will accept or reject based on its
  // own config, not force a crash.
  if (!ctx) return { getToken: async () => null };
  return ctx;
}
