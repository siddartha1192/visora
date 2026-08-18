"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { PLANS, type PlanId } from "@visora/shared";
import { api, ApiError, clearAuth, setRefreshToken, setToken } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { VisoraLogo } from "@/components/ui/logo";
import { cn } from "@/lib/utils";

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

export default function SignupPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [organizationName, setOrganizationName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [planId, setPlanId] = useState<PlanId>("basic");
  const [cardNumber, setCardNumber] = useState("");
  const [expMonth, setExpMonth] = useState("");
  const [expYear, setExpYear] = useState("");
  const [cvc, setCvc] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const plan = PLANS[planId];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await api.signup({
        organizationName,
        ownerName,
        email,
        password,
        planId,
        card: {
          number: cardNumber,
          expMonth: Number(expMonth),
          expYear: Number(expYear),
          cvc,
        },
      });
      clearAuth();
      queryClient.clear();
      setToken(res.tokens.accessToken);
      setRefreshToken(res.tokens.refreshToken);
      router.push("/compose");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4 py-10 sm:p-8">
      <div className="w-full max-w-lg animate-fade-in-up space-y-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <VisoraLogo animated />
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-[-0.02em]">Create your organization</h1>
            <p className="text-sm text-muted-foreground">
              Set up Visora for your team in a couple of minutes.
            </p>
          </div>
        </div>

        <Card className="p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Organization + owner details */}
            <div className="space-y-4">
              <Field label="Organization name">
                <input
                  required
                  value={organizationName}
                  onChange={(e) => setOrganizationName(e.target.value)}
                  placeholder="Acme Corp"
                  maxLength={160}
                  className={inputCls}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Your name">
                  <input
                    required
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    placeholder="Jane Doe"
                    maxLength={120}
                    className={inputCls}
                  />
                </Field>
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
              </div>
              <Field label="Password">
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min 8 characters"
                  className={inputCls}
                />
              </Field>
            </div>

            {/* Plan picker */}
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground/90">Choose a plan</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {Object.values(PLANS).map((p) => {
                  const selected = p.id === planId;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPlanId(p.id)}
                      className={cn(
                        "rounded-lg border p-4 text-left transition-colors duration-150",
                        selected
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "border-border hover:bg-secondary/40",
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">{p.name}</span>
                        {selected && <Check className="h-4 w-4 text-primary" />}
                      </div>
                      <p className="mt-0.5 text-lg font-semibold tracking-[-0.02em]">
                        ${p.priceUsd}
                        <span className="text-xs font-normal text-muted-foreground">/mo</span>
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">{p.description}</p>
                      <ul className="mt-2 space-y-1">
                        {p.features.map((f) => (
                          <li key={f} className="text-xs text-muted-foreground">
                            • {f}
                          </li>
                        ))}
                      </ul>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Mock payment */}
            <div className="space-y-3 rounded-lg border border-border bg-secondary/20 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground/90">Payment</p>
                <p className="text-xs text-muted-foreground/70">No real gateway is connected yet — test data only.</p>
              </div>
              <Field label="Card number">
                <input
                  required
                  value={cardNumber}
                  onChange={(e) => setCardNumber(e.target.value)}
                  placeholder="4242 4242 4242 4242"
                  maxLength={19}
                  className={inputCls}
                />
              </Field>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Month">
                  <input
                    required
                    value={expMonth}
                    onChange={(e) => setExpMonth(e.target.value)}
                    placeholder="12"
                    maxLength={2}
                    className={inputCls}
                  />
                </Field>
                <Field label="Year">
                  <input
                    required
                    value={expYear}
                    onChange={(e) => setExpYear(e.target.value)}
                    placeholder="2030"
                    maxLength={4}
                    className={inputCls}
                  />
                </Field>
                <Field label="CVC">
                  <input
                    required
                    value={cvc}
                    onChange={(e) => setCvc(e.target.value)}
                    placeholder="123"
                    maxLength={4}
                    className={inputCls}
                  />
                </Field>
              </div>
            </div>

            {error && (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Creating your organization…" : `Complete signup — $${plan.priceUsd}/mo`}
            </Button>

            <p className="pt-1 text-center text-xs text-muted-foreground/70">
              Already have an account? <Link href="/login" className="text-primary hover:underline">Sign in</Link>
            </p>
          </form>
        </Card>
      </div>
    </main>
  );
}
