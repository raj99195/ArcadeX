// src/components/ConfettiBurst.jsx
//
// Fire-and-forget particle burst overlay. Mount it to fire — animation runs
// for `duration` ms and then can be unmounted. Non-interactive (pointer-events
// none) so it never blocks UI underneath.
//
// Usage:
//   const [burst, setBurst] = useState(false);
//   // fire it:
//   setBurst(true);
//   setTimeout(() => setBurst(false), 4500);
//   // render:
//   {burst && <ConfettiBurst colors={["#ffb700","#8b5cf6"]} />}
//
// The parent controls lifetime — remount to replay.

import { useEffect, useRef } from "react";

const DEFAULT_COLORS = ["#ffb700", "#8b5cf6", "#00e5ff", "#ec4899", "#00ff88", "#ffffff"];

export default function ConfettiBurst({
  colors = DEFAULT_COLORS,
  count = 180,
  duration = 4000,
  originX = null,     // null = window center
  originY = null,
  includeCannons = true,  // side cannons that shoot up from bottom
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const setSize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    setSize();
    window.addEventListener("resize", setSize);

    const cx = originX ?? window.innerWidth  / 2;
    const cy = originY ?? window.innerHeight / 2;

    // Center burst
    const particles = [];
    const spawnBurst = (x, y, n, speedRange = [6, 18], angleFn) => {
      for (let i = 0; i < n; i++) {
        const angle = angleFn ? angleFn(i, n) : Math.random() * Math.PI * 2;
        const speed = speedRange[0] + Math.random() * (speedRange[1] - speedRange[0]);
        particles.push({
          x: x + (Math.random() - 0.5) * 30,
          y: y + (Math.random() - 0.5) * 30,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          gravity: 0.32,
          drag: 0.995,
          color: colors[Math.floor(Math.random() * colors.length)],
          size: Math.random() * 8 + 4,
          rotation: Math.random() * Math.PI * 2,
          rotationSpeed: (Math.random() - 0.5) * 0.35,
          lifespan: 0,
          maxLifespan: 100 + Math.random() * 80,
          shape: Math.random() < 0.35 ? "circle" : "rect",
        });
      }
    };

    spawnBurst(cx, cy, count);

    // Side cannons — staggered upward bursts from bottom
    if (includeCannons) {
      const cannonX = [0.15, 0.5, 0.85];
      cannonX.forEach((posX, i) => {
        setTimeout(() => {
          spawnBurst(
            window.innerWidth * posX,
            window.innerHeight,
            70,
            [12, 22],
            () => -Math.PI / 2 + (Math.random() - 0.5) * 0.5,
          );
        }, 250 + i * 200);
      });
    }

    let raf;
    const start = performance.now();
    const draw = () => {
      const elapsed = performance.now() - start;
      if (elapsed > duration) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= p.drag;
        p.vy = p.vy * p.drag + p.gravity;
        p.rotation += p.rotationSpeed;
        p.lifespan++;
        const opacity = Math.max(0, 1 - p.lifespan / p.maxLifespan);
        if (opacity <= 0) continue;
        if (p.y > canvas.height + 40) continue;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.globalAlpha = opacity;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 12;
        if (p.shape === "rect") {
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.55);
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      raf = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", setSize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 10500,
      }}
    />
  );
}
