"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Sparkles, Wand2, Images, CalendarClock } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { api, clearAuth, clearLogoutReason, peekLogoutReason, setRefreshToken, setToken } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { VisoraLogo } from "@/components/ui/logo";
import { cn } from "@/lib/utils";

type Tab = "login" | "register";

const HIGHLIGHTS = [
  { icon: Sparkles, title: "Generate", desc: "Studio-quality imagery from a single prompt" },
  { icon: Wand2, title: "Enhance", desc: "AI-edit uploads to studio quality" },
  { icon: Images, title: "Discover", desc: "Stock sourcing from Pexels & Unsplash" },
  { icon: CalendarClock, title: "Schedule", desc: "Plan every platform from one calendar" },
];

export default function LoginPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  // A one-shot flag, not a URL param, so a stale bookmark or autocomplete
  // suggestion can never resurrect it. Read (pure) in state, clear (effect)
  // separately — mixing the two in one initializer breaks under Strict Mode's
  // double-invoke, which would silently clear it before it's ever shown.
  const [loggedOutReason] = useState(peekLogoutReason);
  useEffect(() => { clearLogoutReason(); }, []);
  const [tab, setTab] = useState<Tab>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res =
        tab === "login"
          ? await api.login(email, password)
          : await api.register({ email, password, name });
      // Evict any previous user's cached data before entering the new session.
      clearAuth();
      queryClient.clear();
      setToken(res.tokens.accessToken);
      setRefreshToken(res.tokens.refreshToken);
      router.push("/compose");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel — hidden on mobile, this is the "enterprise studio" pitch */}
      <div className="bg-grid relative hidden flex-col justify-between overflow-hidden border-r border-border bg-card p-12 lg:flex">
        <div className="pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_75%_65%_at_15%_15%,black,transparent)]" />

        {/* Inset from the 12-unit gutter so the mark sits just right of the
            headline's left edge rather than flush with it. */}
        <Link
          href="/"
          className="group relative ml-6 flex w-fit animate-fade-in-up items-center gap-4"
        >
          <VisoraLogo animated />
          <span className="text-2xl font-semibold tracking-[-0.02em] transition-colors duration-200 group-hover:text-primary">
            Visora
          </span>
        </Link>

        <div className="relative max-w-md space-y-10">
          <h1
            className="animate-fade-in-up text-balance bg-gradient-to-b from-foreground to-foreground/70 bg-clip-text text-4xl font-semibold tracking-[-0.03em] text-transparent"
            style={{ animationDelay: "80ms" }}
          >
            The enterprise studio for AI visual content
          </h1>
          <div className="space-y-5">
            {HIGHLIGHTS.map((h, i) => (
              <div
                key={h.title}
                className="group flex animate-fade-in-up items-start gap-3.5 rounded-lg -m-2 p-2 transition-colors duration-150 hover:bg-secondary/40"
                style={{ animationDelay: `${160 + i * 70}ms` }}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 transition-transform duration-150 group-hover:scale-105">
                  <h.icon className="h-4 w-4 text-primary" />
                </span>
                <div>
                  <p className="text-sm font-semibold">{h.title}</p>
                  <p className="text-sm text-muted-foreground">{h.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p
          className="relative animate-fade-in-up text-xs text-muted-foreground/60"
          style={{ animationDelay: "500ms" }}
        >
          One pipeline: generate, optimize, schedule, publish.
        </p>
      </div>

      {/* Form panel */}
      <div className="relative flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-sm animate-fade-in-up space-y-8" style={{ animationDelay: "120ms" }}>
          {/* Compact brand mark — mobile only, replaces the hidden side panel */}
          <div className="group flex flex-col items-center gap-3 text-center lg:hidden">
            <VisoraLogo animated />
            <div className="space-y-1">
              <h1 className="text-xl font-semibold tracking-[-0.02em]">Visora</h1>
              <p className="text-sm text-muted-foreground">AI Visual Content Studio</p>
            </div>
          </div>

          <div className="hidden text-center lg:block">
            <h2 className="text-xl font-semibold tracking-[-0.02em]">
              {tab === "login" ? "Welcome back" : "Create your account"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {tab === "login"
                ? "Sign in to keep your content pipeline running."
                : "Start generating, scheduling, and publishing in minutes."}
            </p>
          </div>

          {loggedOutReason === "idle" && (
            <p className="rounded-md border border-border bg-muted/50 px-3 py-2 text-center text-sm text-muted-foreground">
              You were signed out after 15 minutes of inactivity.
            </p>
          )}
          {loggedOutReason === "expired" && (
            <p className="rounded-md border border-border bg-muted/50 px-3 py-2 text-center text-sm text-muted-foreground">
              Your session expired — please sign in again.
            </p>
          )}

          <Card className="p-6">
            {/* Admin link */}
            <div className="mb-4 flex justify-end">
              <Link
                href="/admin/login"
                className="flex items-center gap-1 text-xs text-muted-foreground/50 transition-colors duration-150 hover:text-muted-foreground"
              >
                Admin Portal →
              </Link>
            </div>

            {/* Tab switcher */}
            <div className="mb-6 flex rounded-md border border-border bg-muted/50 p-1">
              {(["login", "register"] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => { setTab(t); setError(""); }}
                  className={cn(
                    "flex-1 rounded-[5px] py-1.5 text-sm font-medium capitalize transition-all duration-150",
                    tab === t
                      ? "bg-card text-foreground shadow-elevate-xs ring-1 ring-border"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t === "login" ? "Sign in" : "Create account"}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {tab === "register" && (
                <Field label="Name">
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    className={inputCls}
                  />
                </Field>
              )}

              <Field label="Email">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className={inputCls}
                />
              </Field>

              <Field label="Password">
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className={inputCls}
                />
              </Field>

              {error && (
                <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading
                  ? "Please wait…"
                  : tab === "login"
                  ? "Sign in"
                  : "Create account"}
              </Button>
            </form>
          </Card>
        </div>
      </div>
    </main>
  );
}

const inputCls =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-shadow duration-150 placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-ring";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-foreground/90">{label}</label>
      {children}
    </div>
  );
}
