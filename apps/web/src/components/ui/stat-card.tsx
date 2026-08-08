import type { ElementType } from "react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  icon: ElementType;
  accent?: string;
  size?: "default" | "compact";
  className?: string;
}

/** KPI tile — shared by admin analytics and any page that wants a slim stat strip. */
export function StatCard({ label, value, sub, icon: Icon, accent, size = "default", className }: StatCardProps) {
  if (size === "compact") {
    return (
      <div
        className={cn(
          "flex items-center gap-3 rounded-lg border border-border bg-secondary/10 px-4 py-3",
          className,
        )}
      >
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", accent ?? "bg-secondary/50")}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-lg font-semibold tracking-[-0.02em] leading-none">{value}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{label}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-xl border border-border bg-secondary/10 p-5 text-center",
        className,
      )}
    >
      <div className={cn("flex h-7 w-7 items-center justify-center rounded-lg", accent ?? "bg-secondary/50")}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <p className="mt-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-[-0.02em]">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
