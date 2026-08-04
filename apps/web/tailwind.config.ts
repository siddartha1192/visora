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
      },
      animation: {
        "fade-in": "fade-in 0.15s ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
