"use client";

import { useCallback, useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Segmented layout picker, shared by the user Posts page and the admin All
 * Posts page. Generic over the view ids so each page can name its own default
 * density ("list" of cards vs a "table" of rows) while behaving identically.
 */
export interface ViewOption<T extends string> {
  id: T;
  label: string;
  icon: LucideIcon;
}

/**
 * Remembers the choice per storage key.
 *
 * State always starts at `fallback` so the server render and the first client
 * render agree; the stored preference is applied after mount. That costs one
 * frame but cannot produce a hydration mismatch.
 */
export function useStoredView<T extends string>(
  storageKey: string,
  options: readonly T[],
  fallback: T,
): [T, (v: T) => void] {
  const [view, setView] = useState<T>(fallback);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored && (options as readonly string[]).includes(stored)) {
        setView(stored as T);
      }
    } catch {
      // Storage unavailable (private mode) — the default is fine.
    }
    // `options` is a module-level constant at every call site; re-running on a
    // new array identity would needlessly re-read storage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const update = useCallback(
    (v: T) => {
      setView(v);
      try {
        localStorage.setItem(storageKey, v);
      } catch {
        // Preference just won't persist.
      }
    },
    [storageKey],
  );

  return [view, update];
}

export function ViewSwitcher<T extends string>({
  options,
  view,
  onChange,
  className,
}: {
  options: readonly ViewOption<T>[];
  view: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Layout"
      className={cn(
        "flex items-center gap-0.5 rounded-lg border border-border bg-secondary/40 p-0.5",
        className,
      )}
    >
      {options.map(({ id, label, icon: Icon }) => {
        const active = id === view;
        return (
          <button
            key={id}
            role="radio"
            aria-checked={active}
            aria-label={`${label} view`}
            title={`${label} view`}
            onClick={() => onChange(id)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors duration-150",
              active
                ? "bg-card text-foreground shadow-elevate-xs ring-1 ring-border"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
