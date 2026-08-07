"use client";

import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { api } from "@/lib/api";

/** Lightweight scheduling view: groups upcoming scheduled posts by day. */
export default function CalendarPage() {
  const { data } = useQuery({
    queryKey: ["posts", "calendar"],
    queryFn: () => api.listPosts(1),
  });

  const scheduled = (data?.items ?? [])
    .filter((p) => p.schedule.mode === "scheduled" && p.schedule.runAt)
    .sort((a, b) => (a.schedule.runAt! > b.schedule.runAt! ? 1 : -1));

  const byDay = new Map<string, typeof scheduled>();
  for (const p of scheduled) {
    const day = new Date(p.schedule.runAt!).toDateString();
    byDay.set(day, [...(byDay.get(day) ?? []), p]);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Calendar</h1>
        <p className="text-muted-foreground">Upcoming scheduled posts.</p>
      </header>

      {byDay.size === 0 && (
        <Card className="p-8 text-center text-muted-foreground">
          Nothing scheduled. Use “Schedule” in Compose to plan ahead.
        </Card>
      )}

      <div className="space-y-6">
        {[...byDay.entries()].map(([day, posts]) => (
          <div key={day}>
            <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{day}</h2>
            <div className="space-y-2">
              {posts.map((p) => (
                <Card key={p.id} className="flex items-center justify-between p-3">
                  <div>
                    <p className="text-sm">
                      {new Date(p.schedule.runAt!).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {" · "}
                      <span className="capitalize text-muted-foreground">
                        {p.workflow.replace("_", " ")}
                      </span>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {p.input.prompt ?? p.caption.text ?? "—"}
                    </p>
                  </div>
                  <StatusBadge status={p.status} />
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
