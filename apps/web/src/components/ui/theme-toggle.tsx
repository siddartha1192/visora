"use client";

import { Moon, Sun, Circle } from "lucide-react";
import { useTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const OPTIONS: { value: Theme; label: string; Icon: typeof Moon }[] = [
  { value: "dark",  label: "Dark",  Icon: Moon   },
  { value: "grey",  label: "Grey",  Icon: Circle  },
  { value: "light", label: "Light", Icon: Sun     },
];

interface ThemeToggleProps {
  /** Icon-only mode — no labels, smaller footprint. Used in page headers. */
  compact?: boolean;
}

export function ThemeToggle({ compact = false }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();

  if (compact) {
    return (
      <div className="flex items-center rounded-md border border-border bg-muted/50 p-0.5">
        {OPTIONS.map(({ value, label, Icon }) => {
          const active = theme === value;
          return (
            <button
              key={value}
              onClick={() => setTheme(value)}
              title={`${label} theme`}
              className={cn(
                "flex items-center justify-center rounded-[5px] p-1.5 transition-all duration-150",
                active
                  ? "bg-card text-foreground shadow-elevate-xs ring-1 ring-border"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex w-full rounded-md border border-border bg-muted/50 p-0.5">
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            onClick={() => setTheme(value)}
            title={`${label} theme`}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-[5px] px-2 py-1.5 text-xs font-medium transition-all duration-150",
              active
                ? "bg-card text-foreground shadow-elevate-xs ring-1 ring-border"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3 w-3" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
