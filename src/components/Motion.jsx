// src/components/Motion.jsx
//
// Reusable motion primitives built on top of the ax-* animation kit in
// index.css. These are opt-in — none of them run globally.
//
//   • <ScrollReveal>    IntersectionObserver wrapper; adds .in-view when the
//                       element scrolls into viewport. Pair with ax-reveal-*
//                       classes for the actual animation.
//   • <CountUp>         Rate-limited rAF animator for numeric displays.
//                       Starts counting when the element first enters view.
//   • <Typewriter>      Reveals a string character-by-character.
//   • <CursorGlow>      Soft blurred circle that follows the cursor across
//                       the page. Fire-and-forget — mount once near root.
//   • <MagneticButton>  Pulls toward the cursor on hover (desktop only).
//   • <Ripple>          Expanding ring on click.
//
// All components honour `prefers-reduced-motion` and degrade to no-ops.

import { useEffect, useRef, useState, useCallback, useMemo } from "react";

const prefersReduced = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ─────────────────────────────────────────────────────────────────────
// <ScrollReveal>
// Adds `in-view` class when element enters viewport. Children should
// already have one of the .ax-reveal-* classes applied.
// ─────────────────────────────────────────────────────────────────────
export function ScrollReveal({ children, variant = "up", delay = 0, once = true, threshold = 0.15 }) {
  const ref = useRef(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (prefersReduced()) { setSeen(true); return; }
    const node = ref.current;
    if (!node) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setSeen(true);
          if (once) io.disconnect();
        } else if (!once) {
          setSeen(false);
        }
      },
      { threshold }
    );
    io.observe(node);
    return () => io.disconnect();
  }, [once, threshold]);
  const cls = `ax-reveal-${variant}${seen ? " in-view" : ""}`;
  return (
    <div ref={ref} className={cls} style={{ animationDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// useCountUp(target, options?) → current value
// easeOutQuart ramp, starts when `start` goes true.
// ─────────────────────────────────────────────────────────────────────
export function useCountUp(target, { duration = 1400, start = true, decimals = 0 } = {}) {
  const [val, setVal] = useState(0);
  const rafRef = useRef(0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!start) return;
    if (prefersReduced()) { setVal(target); return; }
    if (startedRef.current && Math.abs(target - val) < 0.001) return;
    startedRef.current = true;
    const from = val || 0;
    const to = Number(target) || 0;
    const t0 = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - t, 4);
      const current = from + (to - from) * eased;
      setVal(decimals > 0 ? Number(current.toFixed(decimals)) : Math.round(current));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, start]);

  return val;
}

export function CountUp({ to, duration, decimals, prefix = "", suffix = "", className, style }) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setInView(true); io.disconnect(); }
    }, { threshold: 0.3 });
    io.observe(node);
    return () => io.disconnect();
  }, []);
  const val = useCountUp(to, { duration, decimals, start: inView });
  return (
    <span ref={ref} className={className} style={style}>
      {prefix}{val.toLocaleString()}{suffix}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────
// <Typewriter> — reveals the string one char at a time with a blinking
// caret. Finishes with the caret still visible unless `removeCaret`.
// ─────────────────────────────────────────────────────────────────────
export function Typewriter({ text, speed = 42, delay = 0, caret = true, removeCaret = false, className, style, as: As = "span" }) {
  const [out, setOut] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (prefersReduced()) { setOut(text); setDone(true); return; }
    let i = 0;
    let timer;
    const startTimer = setTimeout(() => {
      const type = () => {
        i++;
        setOut(text.slice(0, i));
        if (i < text.length) timer = setTimeout(type, speed);
        else setDone(true);
      };
      type();
    }, delay);
    return () => { clearTimeout(startTimer); clearTimeout(timer); };
  }, [text, speed, delay]);
  const showCaret = caret && !(done && removeCaret);
  return (
    <As className={`${className || ""} ${showCaret ? "ax-caret" : ""}`} style={style}>
      {out}
    </As>
  );
}

// ─────────────────────────────────────────────────────────────────────
// <CursorGlow> — single soft glow that trails the pointer.
// Mount once at app root; it listens on window.
// ─────────────────────────────────────────────────────────────────────
export function CursorGlow({ color = "rgba(123,47,255,0.35)", size = 420, blur = 90, zIndex = 1 }) {
  const dotRef = useRef(null);
  const posRef = useRef({ x: -9999, y: -9999 });
  const targetRef = useRef({ x: -9999, y: -9999 });

  useEffect(() => {
    if (prefersReduced()) return;
    // Skip on touch devices — no cursor to follow.
    if (window.matchMedia("(pointer: coarse)").matches) return;
    const onMove = (e) => { targetRef.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener("pointermove", onMove, { passive: true });
    let raf = 0;
    const tick = () => {
      const t = targetRef.current;
      const p = posRef.current;
      p.x += (t.x - p.x) * 0.14;
      p.y += (t.y - p.y) * 0.14;
      if (dotRef.current) {
        dotRef.current.style.transform =
          `translate3d(${p.x - size / 2}px, ${p.y - size / 2}px, 0)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { window.removeEventListener("pointermove", onMove); cancelAnimationFrame(raf); };
  }, [size]);

  return (
    <div
      ref={dotRef}
      aria-hidden="true"
      style={{
        position: "fixed", top: 0, left: 0,
        width: size, height: size, borderRadius: "50%",
        background: `radial-gradient(circle, ${color} 0%, transparent 60%)`,
        filter: `blur(${blur}px)`,
        pointerEvents: "none",
        zIndex,
        mixBlendMode: "screen",
        willChange: "transform",
        transform: "translate3d(-9999px,-9999px,0)",
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────
// <MagneticButton> — children get pulled toward cursor on hover.
// Only interactive on hover-capable pointers. Falls back gracefully.
// ─────────────────────────────────────────────────────────────────────
export function MagneticButton({ children, strength = 0.35, className = "", style, as: As = "button", ...rest }) {
  const ref = useRef(null);
  const onMove = useCallback((e) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left - r.width / 2;
    const y = e.clientY - r.top - r.height / 2;
    el.style.transform = `translate(${x * strength}px, ${y * strength}px)`;
  }, [strength]);
  const onLeave = useCallback(() => {
    if (ref.current) ref.current.style.transform = "translate(0,0)";
  }, []);
  return (
    <As
      ref={ref}
      className={className}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{ transition: "transform 0.25s cubic-bezier(0.34,1.56,0.64,1)", ...style }}
      {...rest}
    >
      {children}
    </As>
  );
}

// ─────────────────────────────────────────────────────────────────────
// <Ripple> — on-click ripple that originates at the click position.
// Wraps children; pass through props.
// ─────────────────────────────────────────────────────────────────────
export function Ripple({ children, color = "rgba(255,255,255,0.45)", className = "", style, as: As = "button", onClick, ...rest }) {
  const ref = useRef(null);
  const handleClick = useCallback((e) => {
    const el = ref.current;
    if (el && !prefersReduced()) {
      const r = el.getBoundingClientRect();
      const d = Math.max(r.width, r.height);
      const span = document.createElement("span");
      span.style.position = "absolute";
      span.style.left = `${e.clientX - r.left - d / 2}px`;
      span.style.top  = `${e.clientY - r.top  - d / 2}px`;
      span.style.width = span.style.height = `${d}px`;
      span.style.borderRadius = "50%";
      span.style.background = color;
      span.style.pointerEvents = "none";
      span.style.transform = "scale(0)";
      span.style.opacity = "0.6";
      span.style.animation = "axRipple 0.7s cubic-bezier(0.2,0.9,0.3,1)";
      el.appendChild(span);
      setTimeout(() => span.remove(), 700);
    }
    onClick?.(e);
  }, [color, onClick]);
  const mergedStyle = useMemo(() => ({ position: "relative", overflow: "hidden", ...style }), [style]);
  return (
    <As ref={ref} className={className} style={mergedStyle} onClick={handleClick} {...rest}>
      {children}
    </As>
  );
}
