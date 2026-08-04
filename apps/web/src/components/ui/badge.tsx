import type { HTMLAttributes } from "react";
import type { PostStatus } from "@visora/shared";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  draft:          "bg-muted text-muted-foreground ring-1 ring-inset ring-border",
  queued:         "bg-warning/12 text-warning ring-1 ring-inset ring-warning/25",
  processing:     "bg-primary/12 text-primary ring-1 ring-inset ring-primary/25 animate-pulse",
  pending_review: "bg-warning/15 text-warning ring-1 ring-inset ring-warning/30",
  ready:          "bg-accent/12 text-accent ring-1 ring-inset ring-accent/25",
  scheduled:      "bg-primary/12 text-primary ring-1 ring-inset ring-primary/25",
  publishing:     "bg-primary/12 text-primary ring-1 ring-inset ring-primary/25 animate-pulse",
  published:      "bg-success/12 text-success ring-1 ring-inset ring-success/25",
  failed:         "bg-destructive/12 text-destructive ring-1 ring-inset ring-destructive/25",
  cancelled:      "bg-muted text-muted-foreground/70 ring-1 ring-inset ring-border",
  rejected:       "bg-destructive/10 text-destructive/90 ring-1 ring-inset ring-destructive/20",
};

export function StatusBadge({ status }: { status: PostStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize tracking-[-0.005em]",
        STATUS_STYLES[status] ?? STATUS_STYLES.draft,
      )}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-border bg-secondary/50 px-2.5 py-0.5 text-xs font-medium",
        className,
      )}
      {...props}
    />
  );
}
