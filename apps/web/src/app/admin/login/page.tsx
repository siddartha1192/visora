"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Shield, AlertCircle, KeyRound, ScrollText, TimerOff } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { adminApi, setAdminToken } from "@/lib/admin-api";
import { clearAuth, clearLogoutReason, peekLogoutReason, setRefreshToken, setToken } from "@/lib/api";

const inputCls =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-shadow duration-150 focus:ring-2 focus:ring-ring placeholder:text-muted-foreground/50";

const SAFEGUARDS = [
  { icon: KeyRound, title: "Role-based access", desc: "Admin and root roles gate every privileged route" },
  { icon: ScrollText, title: "Audit-logged", desc: "Every administrative action is recorded" },
  { icon: TimerOff, title: "Idle auto-lock", desc: "Sessions expire after 15 minutes of inactivity" },
];

export default function AdminLoginPage() {
  const router = useRouter();
  // See the matching comment in apps/web/src/app/login/page.tsx — pure read
  // in state, clear in an effect, so Strict Mode's double-invoke can't eat it.
  const [loggedOutReason] = useState(peekLogoutReason);
  useEffect(() => { clearLogoutReason(); }, []);
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await adminApi.login(email, password);
      // Evict any previous session's cached data before entering the new admin session.
      clearAuth();
      queryClient.clear();
      // Set both tokens — same JWT works for both regular and admin API calls.
      setAdminToken(res.tokens.accessToken);
      setToken(res.tokens.accessToken);
      setRefreshToken(res.tokens.refreshToken);
      // Verify the account actually has admin access
      await adminApi.me();
      router.replace("/admin/users");
    } catch (err) {
      setAdminToken(null);
      const msg = (err as Error).message;
      setError(msg === "Admin access required" ? "This account does not have admin access." : msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      {/* Security panel — hidden on mobile */}
      <div className="bg-grid relative hidden flex-col justify-between overflow-hidden border-r border-border bg-card p-12 lg:flex">
        <div className="pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_75%_65%_at_15%_15%,black,transparent)]" />

        <Link
          href="/"
          className="relative flex animate-fade-in-up items-center gap-3"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-secondary ring-1 ring-border">
            <Shield className="h-5 w-5 text-primary" />
          </span>
          <span className="text-xl font-semibold tracking-[-0.02em]">Visora Admin</span>
        </Link>

        <div className="relative max-w-md space-y-10">
          <h1
            className="animate-fade-in-up text-balance bg-gradient-to-b from-foreground to-foreground/70 bg-clip-text text-4xl font-semibold tracking-[-0.03em] text-transparent"
            style={{ animationDelay: "80ms" }}
          >
            Secured administrative access
          </h1>
          <div className="space-y-5">
            {SAFEGUARDS.map((s, i) => (
              <div
                key={s.title}
                className="group flex animate-fade-in-up items-start gap-3.5 rounded-lg -m-2 p-2 transition-colors duration-150 hover:bg-secondary/40"
                style={{ animationDelay: `${160 + i * 70}ms` }}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary ring-1 ring-border transition-transform duration-150 group-hover:scale-105">
                  <s.icon className="h-4 w-4 text-primary" />
                </span>
                <div>
                  <p className="text-sm font-semibold">{s.title}</p>
                  <p className="text-sm text-muted-foreground">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p
          className="relative animate-fade-in-up text-xs text-muted-foreground/60"
          style={{ animationDelay: "430ms" }}
        >
          This portal is restricted to accounts with admin or root privileges.
        </p>
      </div>

      {/* Form panel */}
      <div className="relative flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-sm animate-fade-in-up space-y-8" style={{ animationDelay: "120ms" }}>
          {/* Compact mark — mobile only */}
          <div className="flex flex-col items-center gap-3 text-center lg:hidden">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-secondary ring-1 ring-border">
              <Shield className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-[-0.02em]">Admin Portal</h1>
              <p className="mt-0.5 text-sm text-muted-foreground">Visora system administration</p>
            </div>
          </div>

          <div className="hidden text-center lg:block">
            <h2 className="text-xl font-semibold tracking-[-0.02em]">Admin sign in</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter your credentials to continue.
            </p>
          </div>

          {loggedOutReason === "idle" && (
            <p className="rounded-md border border-border bg-muted/50 px-3 py-2 text-center text-sm text-muted-foreground">
              You were signed out after 15 minutes of inactivity.
            </p>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-border bg-card p-6 shadow-elevate-sm">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground/90">Email</label>
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground/90">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className={inputCls}
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-primary py-2.5 text-sm font-semibold text-primary-foreground shadow-elevate-xs transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <Link
            href="/login"
            className="block text-center text-xs text-muted-foreground/50 transition-colors duration-150 hover:text-muted-foreground"
          >
            ← Back to regular sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
