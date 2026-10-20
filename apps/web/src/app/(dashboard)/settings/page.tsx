"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PLATFORMS, type ApiKeyDTO } from "@visora/shared";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Settings as SettingsIcon, Globe2, KeyRound, X, Copy, Check, Loader2, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";

const inputCls =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-shadow duration-150 placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-ring";

const EXPIRY_OPTIONS: Array<{ value: string; label: string; days: 30 | 90 | 365 | null }> = [
  { value: "30", label: "30 days", days: 30 },
  { value: "90", label: "90 days", days: 90 },
  { value: "365", label: "1 year", days: 365 },
  { value: "never", label: "No expiry", days: null },
];

/**
 * Settings: social account connections + API keys. The connect flows and key
 * minting hit the workspace endpoints; rendered here as the management surface.
 * API keys are self-service — any logged-in user manages keys for their own
 * workspace, same as OpenAI/Stripe/GitHub. Admin/root additionally get a
 * cross-workspace oversight view under Admin → API Keys.
 */
export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        icon={<SettingsIcon className="h-5 w-5" />}
        title="Settings"
        description="Connect networks and manage programmatic access."
      />

      <Card>
        <CardHeader>
          <CardTitle>Social accounts</CardTitle>
          <CardDescription>
            Each platform publishes through its own OAuth-backed adapter.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {PLATFORMS.map((p) => (
            <div
              key={p}
              className="flex items-center justify-between rounded-lg border border-border bg-secondary/10 p-3 transition-colors hover:bg-secondary/20"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-secondary/60 text-muted-foreground">
                  <Globe2 className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-medium capitalize">{p}</p>
                  <Badge className="mt-0.5 border-none bg-transparent px-0 text-muted-foreground/70">
                    Not connected
                  </Badge>
                </div>
              </div>
              <Button variant="outline" size="sm">
                Connect
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <ApiKeysCard />
    </div>
  );
}

function ApiKeysCard() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<ApiKeyDTO | null>(null);

  const { data: keys = [], isLoading } = useQuery({
    queryKey: ["api-keys"],
    queryFn: api.listApiKeys,
  });

  const revokeMutation = useMutation({
    mutationFn: (keyId: string) => api.revokeApiKey(keyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      setConfirmRevoke(null);
    },
  });

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            API keys
          </CardTitle>
          <CardDescription>
            Trigger any of the 5 workflows programmatically via{" "}
            <code className="rounded bg-secondary px-1">x-api-key</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>
            Generate new key
          </Button>

          {isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : keys.length === 0 ? (
            <p className="text-sm text-muted-foreground">No API keys yet.</p>
          ) : (
            <div className="divide-y divide-border rounded-lg border border-border">
              {keys.map((k) => {
                const expired = k.expiresAt ? new Date(k.expiresAt) < new Date() : false;
                return (
                  <div key={k.keyId} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{k.label}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Created {new Date(k.createdAt).toLocaleDateString()} ·{" "}
                        {k.expiresAt
                          ? `${expired ? "Expired" : "Expires"} ${new Date(k.expiresAt).toLocaleDateString()}`
                          : "Never expires"}
                        {k.lastUsedAt && ` · Last used ${new Date(k.lastUsedAt).toLocaleDateString()}`}
                      </p>
                      {k.revoked && k.revokedAt && (
                        <p className="mt-0.5 text-xs text-destructive/80">
                          Revoked by {k.revokedBy ?? "unknown"} on {new Date(k.revokedAt).toLocaleString()}
                        </p>
                      )}
                    </div>
                    {k.revoked || expired ? (
                      <Badge className="border-none bg-muted text-muted-foreground">
                        {k.revoked ? "Revoked" : "Expired"}
                      </Badge>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => setConfirmRevoke(k)}>
                        Revoke
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {showCreate && (
        <CreateApiKeyModal
          onClose={() => setShowCreate(false)}
          onCreated={(secret) => {
            setShowCreate(false);
            setRevealed(secret);
            queryClient.invalidateQueries({ queryKey: ["api-keys"] });
          }}
        />
      )}

      {revealed && <RevealSecretModal secret={revealed} onClose={() => setRevealed(null)} />}

      {confirmRevoke && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setConfirmRevoke(null)}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-elevate-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-semibold">Revoke key?</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{confirmRevoke.label}</span> will
              immediately stop authenticating. This cannot be undone.
            </p>
            <div className="mt-5 flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setConfirmRevoke(null)}>
                Cancel
              </Button>
              <Button
                className="flex-1 bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={revokeMutation.isPending}
                onClick={() => revokeMutation.mutate(confirmRevoke.keyId)}
              >
                {revokeMutation.isPending ? "Revoking…" : "Revoke"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function CreateApiKeyModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (secret: string) => void;
}) {
  const [label, setLabel] = useState("");
  const [expiry, setExpiry] = useState(EXPIRY_OPTIONS[1].value);
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: () => {
      const days = EXPIRY_OPTIONS.find((o) => o.value === expiry)?.days ?? null;
      return api.createApiKey(label, days);
    },
    onSuccess: (res) => onCreated(res.secret),
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-elevate-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-semibold">Generate API key</h2>
          <button onClick={onClose} className="rounded-full p-1 text-muted-foreground hover:bg-secondary">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Label</label>
            <input
              required
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. CI pipeline"
              className={inputCls}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Expires in</label>
            <select value={expiry} onChange={(e) => setExpiry(e.target.value)} className={inputCls}>
              {EXPIRY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          {error && (
            <p className="flex items-center gap-1.5 text-sm text-destructive">
              <AlertCircle className="h-3.5 w-3.5" />
              {error}
            </p>
          )}
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={mutation.isPending}>
              {mutation.isPending ? "Generating…" : "Generate"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RevealSecretModal({ secret, onClose }: { secret: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-elevate-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-semibold">Your new API key</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Copy it now — for your security, it won&apos;t be shown again.
        </p>
        <div className="mt-4 flex items-center gap-2 rounded-md border border-border bg-secondary/30 p-3">
          <code className="min-w-0 flex-1 truncate text-xs">{secret}</code>
          <button
            onClick={() => {
              navigator.clipboard.writeText(secret);
              setCopied(true);
            }}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-secondary"
            title="Copy"
          >
            {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
        <Button className="mt-5 w-full" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}
