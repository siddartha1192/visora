"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Shield, AlertCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { adminApi, setAdminToken } from "@/lib/admin-api";
import { clearAuth, setToken } from "@/lib/api";

const inputCls =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-shadow duration-150 focus:ring-2 focus:ring-ring placeholder:text-muted-foreground/50";

export default function AdminLoginPage() {
  const router = useRouter();
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
    <main className="bg-grid relative flex min-h-screen items-center justify-center bg-background p-4">
      <div className="pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_50%_50%_at_50%_0%,black,transparent)]" />

      <div className="relative w-full max-w-sm space-y-8">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-secondary ring-1 ring-border">
            <Shield className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-[-0.02em]">Admin Portal</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">Visora system administration</p>
          </div>
        </div>

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
            <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
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
      </div>
    </main>
  );
}
