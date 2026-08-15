"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "@/lib/admin-api";
import type { AdminApiKeyDTO } from "@visora/shared";
import { Loader2 } from "lucide-react";

/**
 * Cross-workspace audit view. Every user self-services their own workspace's
 * keys from Settings — this exists so admin/root can see everything that's
 * been minted org-wide and kill a key that isn't theirs (compromised or
 * misbehaving integration), without needing that workspace's own credentials.
 */
export default function AdminApiKeysPage() {
  const queryClient = useQueryClient();
  const [confirmRevoke, setConfirmRevoke] = useState<AdminApiKeyDTO | null>(null);

  const { data: keys = [], isLoading } = useQuery({
    queryKey: ["admin-api-keys"],
    queryFn: adminApi.listAllApiKeys,
  });

  const revokeMutation = useMutation({
    mutationFn: (keyId: string) => adminApi.revokeApiKeyAdmin(keyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-api-keys"] });
      setConfirmRevoke(null);
    },
  });

  return (
    <>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold">API Keys</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {keys.length} key{keys.length !== 1 ? "s" : ""} across every workspace
          </p>
        </div>

        <div className="overflow-hidden rounded-xl border border-border">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : keys.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">No API keys have been created yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/30 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3">Label</th>
                  <th className="px-4 py-3">Owner</th>
                  <th className="px-4 py-3">Workspace</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3">Expires</th>
                  <th className="px-4 py-3">Last used</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {keys.map((k) => {
                  const expired = k.expiresAt ? new Date(k.expiresAt) < new Date() : false;
                  return (
                    <tr key={k.keyId} className="hover:bg-secondary/20 transition-colors">
                      <td className="px-4 py-3 font-medium">{k.label}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {k.ownerName} <span className="text-muted-foreground/60">({k.ownerEmail})</span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{k.workspaceName}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {new Date(k.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {k.expiresAt ? new Date(k.expiresAt).toLocaleDateString() : "Never"}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {k.revoked || expired ? (
                          <>
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                              {k.revoked ? "Revoked" : "Expired"}
                            </span>
                            {k.revoked && k.revokedAt && (
                              <p className="mt-1 text-[11px] leading-tight text-muted-foreground/70">
                                by {k.revokedBy ?? "unknown"}
                                <br />
                                {new Date(k.revokedAt).toLocaleString()}
                              </p>
                            )}
                          </>
                        ) : (
                          <span className="rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">
                            Active
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {!k.revoked && (
                          <button
                            onClick={() => setConfirmRevoke(k)}
                            className="rounded px-2 py-1 text-xs text-muted-foreground/70 hover:bg-secondary hover:text-destructive transition-colors"
                          >
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

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
              <span className="font-medium text-foreground">{confirmRevoke.label}</span> (owned by{" "}
              {confirmRevoke.ownerEmail}, workspace &ldquo;{confirmRevoke.workspaceName}&rdquo;) will immediately
              stop authenticating. This cannot be undone.
            </p>
            <div className="mt-5 flex gap-2">
              <button
                onClick={() => setConfirmRevoke(null)}
                className="flex-1 rounded-lg border border-border py-2 text-sm text-muted-foreground hover:bg-secondary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => revokeMutation.mutate(confirmRevoke.keyId)}
                disabled={revokeMutation.isPending}
                className="flex-1 rounded-lg bg-destructive py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition-colors"
              >
                {revokeMutation.isPending ? "Revoking…" : "Revoke"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
