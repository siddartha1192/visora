import type { HTMLAttributes } from "react";
import type { PostStatus } from "@visora/shared";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-500/15 text-slate-300",
  queued: "bg-amber-500/15 text-amber-300",
  processing: "bg-blue-500/15 text-blue-300 animate-pulse",
  ready: "bg-cyan-500/15 text-cyan-300",
  scheduled: "bg-violet-500/15 text-violet-300",
  publishing: "bg-blue-500/15 text-blue-300 animate-pulse",
  published: "bg-emerald-500/15 text-emerald-300",
  failed: "bg-red-500/15 text-red-300",
  cancelled: "bg-slate-500/15 text-slate-400",
};

export function StatusBadge({ status }: { status: PostStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize",
        STATUS_STYLES[status] ?? STATUS_STYLES.draft,
      )}
    >
      {status}
    </span>
  );
}

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs font-medium",
        className,
      )}
      {...props}
    />
  );
}
