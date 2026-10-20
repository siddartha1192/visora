"use client";

import { useEffect, useRef, type CSSProperties } from "react";

/**
 * Ambient canvas behind the landing hero: drifting structural grid, two slow
 * cobalt blooms, a vertical scan pass, rising motes, and a pointer-tracked
 * spotlight. Everything is compositor-friendly (transform/opacity only) and the
 * pointer listener is rAF-throttled, so the whole layer costs one paint.
 */

// Fixed table rather than Math.random() — the component is server-rendered
// first, and randomised inline styles would produce a hydration mismatch.
const MOTES = [
  { left: 6, top: 78, size: 2, delay: 0, duration: 15, drift: -10 },
  { left: 14, top: 92, size: 3, delay: 2.4, duration: 18, drift: 16 },
  { left: 21, top: 66, size: 2, delay: 6.1, duration: 13, drift: 8 },
  { left: 29, top: 88, size: 2, delay: 9.3, duration: 17, drift: -14 },
  { left: 35, top: 74, size: 3, delay: 4.2, duration: 20, drift: 12 },
  { left: 42, top: 96, size: 2, delay: 11.5, duration: 14, drift: -6 },
  { left: 48, top: 70, size: 2, delay: 1.1, duration: 19, drift: 18 },
  { left: 55, top: 90, size: 3, delay: 7.8, duration: 16, drift: -12 },
  { left: 61, top: 82, size: 2, delay: 3.3, duration: 21, drift: 6 },
  { left: 67, top: 68, size: 2, delay: 12.7, duration: 15, drift: -16 },
  { left: 73, top: 94, size: 3, delay: 5.6, duration: 18, drift: 10 },
  { left: 79, top: 76, size: 2, delay: 8.9, duration: 13, drift: -8 },
  { left: 85, top: 86, size: 2, delay: 2.0, duration: 22, drift: 14 },
  { left: 91, top: 72, size: 3, delay: 10.4, duration: 17, drift: -4 },
  { left: 96, top: 90, size: 2, delay: 6.7, duration: 16, drift: 9 },
];

export function HeroBackdrop() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    let nextX = 0;
    let nextY = 0;

    const apply = () => {
      frame = 0;
      const rect = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${nextX - rect.left}px`);
      el.style.setProperty("--my", `${nextY - rect.top}px`);
      el.style.setProperty("--spot", "1");
      // Blooms lag the pointer for a shallow parallax read.
      el.style.setProperty(
        "--px",
        `${((nextX / window.innerWidth - 0.5) * 26).toFixed(2)}px`,
      );
      el.style.setProperty(
        "--py",
        `${((nextY / window.innerHeight - 0.5) * 26).toFixed(2)}px`,
      );
    };

    const onMove = (e: PointerEvent) => {
      nextX = e.clientX;
      nextY = e.clientY;
      if (!frame) frame = requestAnimationFrame(apply);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {/* Drifting grid, faded out toward the edges. */}
      <div className="bg-grid bg-grid-drift absolute -inset-8 [mask-image:radial-gradient(ellipse_75%_65%_at_50%_35%,black,transparent)]" />

      {/* Parallax wrapper for the ambient blooms. */}
      <div
        className="absolute inset-0 transition-transform duration-700 ease-out"
        style={{ transform: "translate3d(var(--px, 0px), var(--py, 0px), 0)" }}
      >
        <div className="animate-aurora-a absolute -top-40 left-1/2 h-[38rem] w-[38rem] -translate-x-1/2 rounded-full bg-primary/[0.13] blur-[120px]" />
        <div className="animate-aurora-b absolute -bottom-56 left-[12%] h-[32rem] w-[32rem] rounded-full bg-primary/[0.08] blur-[130px]" />
        <div
          className="animate-aurora-a absolute -bottom-64 right-[8%] h-[26rem] w-[26rem] rounded-full bg-accent/[0.06] blur-[140px]"
          style={{ animationDelay: "-8s", animationDuration: "26s" }}
        />
      </div>

      {/* Slow scan pass. Kept faint and centre-weighted so it never resolves
          into something that reads as a divider rule. */}
      <div className="animate-scan absolute inset-x-[15%] top-0 h-px bg-[radial-gradient(closest-side,hsl(var(--primary)/0.35),transparent)]" />

      {/* Rising motes. */}
      {MOTES.map((m, i) => (
        <span
          key={i}
          className="animate-mote absolute rounded-full bg-primary/50"
          style={{
            left: `${m.left}%`,
            top: `${m.top}%`,
            height: m.size,
            width: m.size,
            animationDelay: `-${m.delay}s`,
            animationDuration: `${m.duration}s`,
            // Lateral drift, read by the `mote` keyframes' X term.
            "--drift": `${m.drift}px`,
          } as CSSProperties}
        />
      ))}

      {/* Pointer-tracked wash. */}
      <div className="cursor-spotlight absolute inset-0" />
    </div>
  );
}
