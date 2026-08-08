import type { Config } from "tailwindcss";

/**
 * Enterprise-grade palette: graphite canvas, cobalt signal color, gold accent
 * reserved for premium/highlight moments. shadcn-style CSS variables drive
 * theming (see globals.css). Flat surfaces + hairline borders + restrained
 * elevation — no decorative gradients or glassmorphism.
 */
const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "2rem", screens: { "2xl": "1400px" } },
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 3px)",
        sm: "calc(var(--radius) - 5px)",
      },
      boxShadow: {
        "elevate-xs": "0 1px 2px hsl(0 0% 0% / 0.08)",
        "elevate-sm":
          "0 1px 0 hsl(0 0% 100% / 0.03) inset, 0 4px 12px -4px hsl(0 0% 0% / 0.35)",
        "elevate-md":
          "0 1px 0 hsl(0 0% 100% / 0.03) inset, 0 12px 28px -10px hsl(0 0% 0% / 0.45)",
        "elevate-lg":
          "0 1px 0 hsl(0 0% 100% / 0.03) inset, 0 24px 48px -16px hsl(0 0% 0% / 0.55)",
        "ring-primary": "0 0 0 1px hsl(var(--primary) / 0.5)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(2px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in-up": {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },

        /* ── Landing-page motion ──────────────────────────────────────────
         * Entrance reveals resolve to a neutral end state and use `both` fill
         * so reduced-motion (which collapses duration to ~0ms) still lands on
         * the final frame instead of leaving content invisible. */
        reveal: {
          from: {
            opacity: "0",
            transform: "translateY(16px)",
            filter: "blur(8px)",
          },
          to: { opacity: "1", transform: "translateY(0)", filter: "blur(0)" },
        },
        "reveal-scale": {
          from: { opacity: "0", transform: "translateY(10px) scale(0.96)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        /* Ambient backdrop: two blooms on opposing drifts keep the canvas
         * alive without ever resolving into a recognisable loop. */
        "aurora-a": {
          "0%, 100%": { transform: "translate3d(-4%, 0, 0) scale(1)" },
          "50%": { transform: "translate3d(8%, -6%, 0) scale(1.18)" },
        },
        "aurora-b": {
          "0%, 100%": { transform: "translate3d(6%, 2%, 0) scale(1.1)" },
          "50%": { transform: "translate3d(-7%, -4%, 0) scale(0.9)" },
        },
        mote: {
          "0%": { opacity: "0", transform: "translate3d(0, 0, 0)" },
          "12%, 78%": { opacity: "1" },
          "100%": {
            opacity: "0",
            transform: "translate3d(var(--drift, 14px), -180px, 0)",
          },
        },
        scan: {
          "0%": { opacity: "0", transform: "translateY(-8vh)" },
          "8%, 70%": { opacity: "1" },
          "100%": { opacity: "0", transform: "translateY(105vh)" },
        },
        /* Pipeline rail: a 20%-wide beam crossing a full-width track. The node
         * pulses below reuse the same 9s clock, offset per index, so each
         * pillar lights exactly as the beam passes it. */
        beam: {
          "0%": { opacity: "0", transform: "translateX(-100%)" },
          "8%, 92%": { opacity: "1" },
          "100%": { opacity: "0", transform: "translateX(500%)" },
        },
        "node-pulse": {
          "0%, 100%": {
            opacity: "1",
            transform: "scale(1.8)",
            boxShadow: "0 0 0 5px hsl(var(--primary) / 0.16)",
          },
          "9%, 91%": {
            opacity: "0.4",
            transform: "scale(1)",
            boxShadow: "0 0 0 0 hsl(var(--primary) / 0)",
          },
        },
        "icon-pulse": {
          "0%, 100%": {
            backgroundColor: "hsl(var(--primary) / 0.28)",
            boxShadow: "0 0 22px -2px hsl(var(--primary) / 0.55)",
          },
          "9%, 91%": {
            backgroundColor: "hsl(var(--primary) / 0.1)",
            boxShadow: "0 0 0 0 hsl(var(--primary) / 0)",
          },
        },
        halo: {
          "0%, 100%": { opacity: "0.45", transform: "scale(1)" },
          "50%": { opacity: "0.8", transform: "scale(1.06)" },
        },
        "pulse-dot": {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.35", transform: "scale(0.7)" },
        },
        "ping-ring": {
          "0%": { opacity: "0.55", transform: "scale(0.7)" },
          "100%": { opacity: "0", transform: "scale(2.6)" },
        },

        /* ── Brand mark ───────────────────────────────────────────────────
         * One 4.8s clock shared by three layers, so the beat reads as a single
         * event: light runs down both arms of the V (logo-flow), lands on the
         * vertex (logo-spark), and the glow blooms outward (logo-bloom). All
         * three carry the same delay in the `animation` shorthand below, which
         * is what keeps them in phase. Offsets are in the glyph's 32-unit
         * viewBox — see ARM_LENGTH in components/ui/logo.tsx. */
        /* Entrance: the glyph fills in from the top down, so the mark arrives
           the same way the flow later travels. */
        "logo-wipe": {
          from: { clipPath: "inset(0 0 100% 0)", opacity: "0" },
          to: { clipPath: "inset(0 0 0 0)", opacity: "1" },
        },
        "logo-flow": {
          "0%": { strokeDashoffset: "3.5", opacity: "0" },
          "8%": { opacity: "1" },
          "30%": { strokeDashoffset: "-22.5", opacity: "1" },
          "36%, 100%": { strokeDashoffset: "-22.5", opacity: "0" },
        },
        "logo-spark": {
          "0%, 27%": { opacity: "0", transform: "scale(0.4)" },
          "33%": { opacity: "0.95", transform: "scale(1)" },
          "48%, 100%": { opacity: "0", transform: "scale(2.2)" },
        },
        "logo-bloom": {
          "0%, 25%": { opacity: "0.25", transform: "scale(0.95)" },
          "36%": { opacity: "0.8", transform: "scale(1.08)" },
          "62%, 100%": { opacity: "0.25", transform: "scale(0.95)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.15s ease-out",
        "fade-in-up": "fade-in-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) both",
        reveal: "reveal 0.85s cubic-bezier(0.16, 1, 0.3, 1) both",
        "reveal-scale": "reveal-scale 0.7s cubic-bezier(0.16, 1, 0.3, 1) both",
        "aurora-a": "aurora-a 18s ease-in-out infinite",
        "aurora-b": "aurora-b 22s ease-in-out infinite",
        mote: "mote 14s linear infinite",
        scan: "scan 9s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        beam: "beam 9s cubic-bezier(0.45, 0, 0.55, 1) infinite",
        "node-pulse": "node-pulse 9s cubic-bezier(0.45, 0, 0.55, 1) infinite",
        "icon-pulse": "icon-pulse 9s cubic-bezier(0.45, 0, 0.55, 1) infinite",
        halo: "halo 4s ease-in-out infinite",
        "pulse-dot": "pulse-dot 2s ease-in-out infinite",
        "ping-ring": "ping-ring 2s cubic-bezier(0, 0, 0.2, 1) infinite",
        // Runs once on mount; the 1.1s delay on the rest lets it finish first.
        "logo-wipe": "logo-wipe 0.8s cubic-bezier(0.65, 0, 0.35, 1) 0.15s both",
        "logo-flow": "logo-flow 4.8s linear 1.1s infinite",
        "logo-spark": "logo-spark 4.8s ease-out 1.1s infinite",
        "logo-bloom": "logo-bloom 4.8s ease-in-out 1.1s infinite",
      },
    },
  },
  plugins: [],
};

export default config;
