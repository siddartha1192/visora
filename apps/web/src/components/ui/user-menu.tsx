"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LogOut, ChevronDown, User } from "lucide-react";
import { api, type UserProfile } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Deterministic, muted background from the user's name — restrained, not candy-colored */
function avatarColor(name: string): string {
  const palette = [
    "bg-blue-600", "bg-indigo-600", "bg-teal-600",
    "bg-rose-600", "bg-amber-600",  "bg-cyan-600",
    "bg-fuchsia-600", "bg-emerald-600",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
}

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

interface AvatarProps {
  user: UserProfile;
  size?: "sm" | "md";
}

export function UserAvatar({ user, size = "md" }: AvatarProps) {
  const dim = size === "sm" ? "h-7 w-7 text-[10px]" : "h-9 w-9 text-xs";

  if (user.avatarUrl) {
    return (
      <img
        src={user.avatarUrl}
        alt={user.name}
        className={cn("rounded-full object-cover ring-2 ring-border", dim)}
      />
    );
  }

  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
        avatarColor(user.name || user.email),
        dim,
      )}
    >
      {user.name ? initials(user.name) : <User className="h-3.5 w-3.5" />}
    </span>
  );
}

interface UserMenuProps {
  onLogout: () => void;
}

export function UserMenu({ onLogout }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.getMe(),
    staleTime: 5 * 60_000,
    retry: false,
  });

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (!user) {
    return (
      <div className="h-9 w-9 animate-pulse rounded-full bg-secondary" />
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-md px-2 py-1 transition-colors duration-150 hover:bg-secondary/60"
      >
        <UserAvatar user={user} />
        <span className="hidden max-w-[140px] truncate text-sm font-medium sm:block">
          {user.name || user.email}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="animate-fade-in absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-border bg-card shadow-elevate-lg">
          {/* Identity */}
          <div className="flex items-center gap-3 px-4 py-3.5">
            <UserAvatar user={user} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{user.name}</p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            </div>
          </div>

          <div className="border-t border-border" />

          {/* Actions */}
          <div className="p-1.5">
            <button
              onClick={() => { setOpen(false); onLogout(); }}
              className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors duration-150 hover:bg-destructive/10 hover:text-destructive"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
