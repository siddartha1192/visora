import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-secondary", className)} />;
}

/** Placeholder shaped like a PostRow card — thumbnail + two text lines + badges row. */
export function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-border bg-card p-4">
      <Skeleton className="h-20 w-20 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-4 w-24 rounded-full" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  );
}
