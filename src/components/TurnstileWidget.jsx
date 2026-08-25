// src/components/TurnstileWidget.jsx
//
// Cloudflare Turnstile widget rendered in "invisible" mode with
// "interaction-only" appearance:
//   • 99%+ of users see nothing at all
//   • Suspicious traffic sees a small 1-tap checkbox rendered by
//     Cloudflare when their scoring decides interaction is needed
//   • We never render our own captcha UI
//
// Exposes an imperative `execute()` method via ref that returns a fresh
// token, waiting up to 30 seconds. Tokens are cached until Cloudflare
// expires them (~5 min TTL) — repeated execute() calls in that window
// reuse the same token, no network hit.
//
// Env var required (Vite): VITE_TURNSTILE_SITE_KEY
// If missing, widget silently disables — backend will also skip
// verification when TURNSTILE_SECRET_KEY is unset on its side.

import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";
import { Turnstile } from "@marsidev/react-turnstile";

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;

const TurnstileWidget = forwardRef(function TurnstileWidget(_props, ref) {
  const [token, setToken] = useState(null);
  const widgetRef = useRef(null);
  // Queue of pending execute() promise-resolvers waiting for the next token
  const waitersRef = useRef([]);

  const flushWaiters = useCallback((t) => {
    const list = waitersRef.current;
    waitersRef.current = [];
    for (const resolve of list) resolve(t);
  }, []);

  const handleSuccess = useCallback((t) => {
    setToken(t);
    flushWaiters(t);
  }, [flushWaiters]);

  const handleExpire = useCallback(() => {
    // Cloudflare auto-resets and issues a new token — clear our cache so
    // the next getToken() waits for the fresh one instead of returning
    // the expired string.
    setToken(null);
  }, []);

  const handleError = useCallback(() => {
    setToken(null);
    // Don't reject pending waiters — the widget will auto-retry and
    // eventually call onSuccess again. Their 30s timeout will fire if
    // that never happens.
  }, []);

  useImperativeHandle(ref, () => ({
    execute: async () => {
      if (token) return token;
      return new Promise((resolve, reject) => {
        waitersRef.current.push(resolve);
        // Force widget reset if it's been idle after an expire/error
        try { widgetRef.current?.reset(); } catch { /* noop */ }
        setTimeout(() => {
          const idx = waitersRef.current.indexOf(resolve);
          if (idx >= 0) {
            waitersRef.current.splice(idx, 1);
            reject(new Error("Turnstile timeout"));
          }
        }, 30_000);
      });
    },
    reset: () => {
      setToken(null);
      try { widgetRef.current?.reset(); } catch { /* noop */ }
    },
  }), [token]);

  if (!SITE_KEY) {
    // Site key missing — likely local dev without env var, or an
    // intentionally undeployed state. Log once so a real misconfigure in
    // prod doesn't silently degrade security.
    if (typeof window !== "undefined" && !window.__turnstileWarned) {
      window.__turnstileWarned = true;
      console.warn(
        "[TurnstileWidget] VITE_TURNSTILE_SITE_KEY is not set — widget disabled. " +
        "Auth will proceed without a Turnstile token; the backend will accept " +
        "such requests only if TURNSTILE_SECRET_KEY is also unset on its side."
      );
    }
    return null;
  }

  return (
    <Turnstile
      ref={widgetRef}
      siteKey={SITE_KEY}
      options={{
        size:       "invisible",
        appearance: "interaction-only",
        theme:      "dark",
      }}
      onSuccess={handleSuccess}
      onError={handleError}
      onExpire={handleExpire}
    />
  );
});

export default TurnstileWidget;
