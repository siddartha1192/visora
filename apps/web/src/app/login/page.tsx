"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { api, clearAuth, setToken } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Tab = "login" | "register";

export default function LoginPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
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
      router.push("/compose");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="bg-grid relative flex min-h-screen items-center justify-center p-4">
      <div className="pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_50%_50%_at_50%_0%,black,transparent)]" />

      <div className="relative w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary shadow-elevate-md">
            <Sparkles className="h-5 w-5 text-primary-foreground" />
          </span>
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-[-0.02em]">Visora</h1>
            <p className="text-sm text-muted-foreground">AI Visual Content Studio</p>
          </div>
        </div>

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
              <p className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
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
