"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Layers } from "lucide-react";
import { api, setToken } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Lets a user with access to more than one workspace switch which one is
 * "active" without logging out. Calls `POST /workspaces/switch`, which
 * re-validates access server-side and returns a new access token scoped to
 * the target workspace; every workspace-scoped query is then invalidated so
 * the dashboard re-fetches under the new token.
 *
 * Renders nothing when the caller can only reach one workspace (the common
 * case today), so it costs nothing for a single-brand tenant.
 */
export function WorkspaceSwitcher() {
  const [open, setOpen] = useState(false);
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

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (!me || me.workspaces.length <= 1) return null;

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
        <span className="max-w-[140px] truncate">{active.name}</span>
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
              const isActive = ws.id === active.id;
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
        </div>
      )}
    </div>
  );
}
