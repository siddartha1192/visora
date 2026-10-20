"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, clearAuth, setRefreshToken, setToken, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { VisoraLogo } from "@/components/ui/logo";

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

const ROLE_LABEL: Record<string, string> = {
  admin: "workspace admin",
  editor: "editor",
  viewer: "viewer",
};

export default function AcceptInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: preview, isLoading, error: previewError } = useQuery({
    queryKey: ["invite-preview", token],
    queryFn: () => api.previewInvite(token),
    retry: false,
  });

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (preview?.email) setName(preview.email.split("@")[0] ?? "");
  }, [preview?.email]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setSubmitting(true);
    try {
      await api.acceptInvite(token, { name, password });
      // Account created — log the new user straight in.
      const loginRes = await api.login(preview!.email, password);
      clearAuth();
      queryClient.clear();
      setToken(loginRes.tokens.accessToken);
      setRefreshToken(loginRes.tokens.refreshToken);
      router.push("/compose");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-sm animate-fade-in-up space-y-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <VisoraLogo animated />
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-[-0.02em]">Visora</h1>
          </div>
        </div>

        <Card className="p-6">
          {isLoading && (
            <p className="py-6 text-center text-sm text-muted-foreground">Checking your invitation…</p>
          )}

          {previewError && (
            <div className="space-y-3 text-center">
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {previewError instanceof ApiError
                  ? previewError.message
                  : "This invitation link is invalid or has expired."}
              </p>
              <Link href="/login" className="text-sm text-primary hover:underline">
                Go to sign in
              </Link>
            </div>
          )}

          {preview && (
            <>
              <div className="mb-5 text-center">
                <h2 className="text-lg font-semibold tracking-[-0.02em]">
                  Join {preview.organizationName}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  You&apos;ve been invited as a {ROLE_LABEL[preview.role] ?? preview.role} on{" "}
                  <span className="font-medium text-foreground">{preview.workspaceName}</span>.
                </p>
                <p className="mt-1 text-xs text-muted-foreground/70">{preview.email}</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <Field label="Your name">
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Jane Doe"
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

                <Field label="Confirm password">
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="••••••••"
                    className={inputCls}
                  />
                </Field>

                {error && (
                  <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </p>
                )}

                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? "Creating account…" : "Accept invitation"}
                </Button>
              </form>
            </>
          )}
        </Card>
      </div>
    </main>
  );
}
