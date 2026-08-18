"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Layers, Plus, X } from "lucide-react";
import { api, setToken, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Lets a user with access to more than one workspace switch which one is
 * "active" without logging out. Calls `POST /workspaces/switch`, which
 * re-validates access server-side and returns a new access token scoped to
 * the target workspace; every workspace-scoped query is then invalidated so
 * the dashboard re-fetches under the new token.
 *
 * Always renders for an organization owner (even with one workspace today),
 * since it is also the entry point for creating additional workspaces —
 * `POST /workspaces` has no other UI. Non-owners with only one workspace see
 * nothing, matching the previous behavior: they cannot create workspaces and
 * have nothing to switch between.
 */
export function WorkspaceSwitcher() {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.getMe(),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const switchMutation = useMutation({
    mutationFn: (workspaceId: string) => api.switchWorkspace(workspaceId),
    onSuccess: (res) => {
      setToken(res.accessToken);
      // Every workspace-scoped screen (posts, assets, api keys, settings)
      // must re-fetch under the new token; "me" too so activeWorkspaceId
      // reflects the switch immediately.
      queryClient.invalidateQueries();
      setOpen(false);
    },
  });

  const createMutation = useMutation({
    mutationFn: (name: string) => api.createWorkspace(name),
    onSuccess: async (ws) => {
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      setCreating(false);
      setNewName("");
      setCreateError("");
      switchMutation.mutate(ws.id);
    },
    onError: (e: Error) => setCreateError(e instanceof ApiError ? e.message : "Could not create workspace"),
  });

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
        setCreateError("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (!me) return null;
  const isOwner = me.orgRole === "owner";
  if (!isOwner && me.workspaces.length <= 1) return null;

  const active =
    me.workspaces.find((w) => w.id === me.activeWorkspaceId) ?? me.workspaces[0];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={switchMutation.isPending}
        className="flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-2.5 py-1.5 text-sm font-medium transition-colors duration-150 hover:bg-secondary/60 disabled:opacity-60"
      >
        <Layers className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="max-w-[140px] truncate">{active?.name ?? "Workspace"}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="animate-fade-in absolute left-0 top-full z-50 mt-2 w-64 rounded-lg border border-border bg-card shadow-elevate-lg">
          <p className="px-3 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
            Switch workspace
          </p>
          <div className="p-1.5 pt-0.5">
            {me.workspaces.map((ws) => {
              const isActive = ws.id === active?.id;
              return (
                <button
                  key={ws.id}
                  onClick={() => !isActive && switchMutation.mutate(ws.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-sm transition-colors duration-150",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-foreground hover:bg-secondary/60",
                  )}
                >
                  <span className="truncate">{ws.name}</span>
                  {isActive && <Check className="h-3.5 w-3.5 shrink-0" />}
                </button>
              );
            })}
          </div>

          {isOwner && (
            <div className="border-t border-border p-1.5">
              {creating ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (newName.trim()) createMutation.mutate(newName.trim());
                  }}
                  className="space-y-1.5 p-1.5"
                >
                  <div className="flex items-center gap-1.5">
                    <input
                      autoFocus
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Workspace name"
                      maxLength={120}
                      className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                    />
                    <button
                      type="button"
                      onClick={() => { setCreating(false); setNewName(""); setCreateError(""); }}
                      className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-secondary"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {createError && <p className="text-xs text-destructive">{createError}</p>}
                  <button
                    type="submit"
                    disabled={!newName.trim() || createMutation.isPending}
                    className="w-full rounded-md bg-primary py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
                  >
                    {createMutation.isPending ? "Creating…" : "Create workspace"}
                  </button>
                </form>
              ) : (
                <button
                  onClick={() => setCreating(true)}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors duration-150 hover:bg-secondary/60 hover:text-foreground"
                >
                  <Plus className="h-3.5 w-3.5" />
                  New workspace
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
