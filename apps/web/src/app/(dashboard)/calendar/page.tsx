"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { PostDTO } from "@visora/shared";
import { ChevronLeft, ChevronRight, LayoutList, CalendarDays, Plus, CalendarClock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { StatusBadge, STATUS_DOT_COLORS } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type ViewMode = "month" | "list";

function dateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function buildMonthGrid(year: number, month: number) {
  const startWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7;

  return Array.from({ length: totalCells }, (_, i) => {
    const date = new Date(year, month, i - startWeekday + 1);
    return { date, inMonth: date.getMonth() === month };
  });
}

/** Content Calendar: Google Calendar-style month grid (default) with a list-view fallback. */
export default function CalendarPage() {
  const [view, setView] = useState<ViewMode>("month");

  const { data } = useQuery({
    queryKey: ["posts", "calendar"],
    queryFn: () => api.listPosts(1),
  });

  const scheduled = useMemo(
    () =>
      (data?.items ?? [])
        .filter((p) => p.schedule.mode === "scheduled" && p.schedule.runAt)
        .sort((a, b) => (a.schedule.runAt! > b.schedule.runAt! ? 1 : -1)),
    [data],
  );

  const byDay = useMemo(() => {
    const map = new Map<string, PostDTO[]>();
    for (const p of scheduled) {
      const day = new Date(p.schedule.runAt!).toDateString();
      map.set(day, [...(map.get(day) ?? []), p]);
    }
    return map;
  }, [scheduled]);

  const postsByDay = useMemo(() => {
    const map = new Map<string, PostDTO[]>();
    for (const p of scheduled) {
      const key = dateKey(new Date(p.schedule.runAt!));
      map.set(key, [...(map.get(key) ?? []), p]);
    }
    return map;
  }, [scheduled]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        icon={<CalendarClock className="h-5 w-5" />}
        title="Calendar"
        description="Upcoming scheduled posts."
        actions={<ViewToggle view={view} onChange={setView} />}
      />

      {view === "month" ? (
        <MonthCalendar postsByDay={postsByDay} />
      ) : (
        <ListView byDay={byDay} />
      )}
    </div>
  );
}

function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div className="inline-flex shrink-0 rounded-md border border-border bg-secondary/30 p-0.5">
      {(
        [
          { key: "month" as const, label: "Month", Icon: CalendarDays },
          { key: "list" as const, label: "List", Icon: LayoutList },
        ]
      ).map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={cn(
            "flex items-center gap-1.5 rounded-[5px] px-3 py-1.5 text-sm font-medium transition-colors",
            view === key
              ? "bg-background text-foreground shadow-elevate-xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="h-4 w-4" />
          {label}
        </button>
      ))}
    </div>
  );
}

function MonthCalendar({ postsByDay }: { postsByDay: Map<string, PostDTO[]> }) {
  const router = useRouter();
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const cells = useMemo(() => buildMonthGrid(viewYear, viewMonth), [viewYear, viewMonth]);
  const todayKey = dateKey(today);
  const selectedKey = selectedDate ? dateKey(selectedDate) : null;
  const selectedPosts = selectedKey ? postsByDay.get(selectedKey) ?? [] : [];

  function prevMonth() {
    if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11); }
    else setViewMonth((m) => m - 1);
  }

  function nextMonth() {
    if (viewMonth === 11) { setViewYear((y) => y + 1); setViewMonth(0); }
    else setViewMonth((m) => m + 1);
  }

  function goToday() {
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
    setSelectedDate(today);
  }

  function openPost(id: string) {
    router.push(`/posts?highlight=${id}`);
  }

  function newPostOn(key: string) {
    router.push(`/compose?date=${key}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={prevMonth} aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={nextMonth} aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <h2 className="ml-2 text-lg font-semibold tracking-[-0.01em]">
            {MONTHS[viewMonth]} {viewYear}
          </h2>
        </div>
        <Button variant="secondary" size="sm" onClick={goToday}>
          Today
        </Button>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="grid grid-cols-7 border-b border-border bg-muted/30">
          {DAY_LABELS.map((d) => (
            <div key={d} className="p-2 text-center text-xs font-medium text-muted-foreground">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map(({ date, inMonth }) => {
            const key = dateKey(date);
            const dayPosts = postsByDay.get(key) ?? [];
            const isToday = key === todayKey;
            const isSelected = key === selectedKey;
            const visible = dayPosts.slice(0, 3);
            const overflow = dayPosts.length - visible.length;

            return (
              <div
                key={key}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedDate(isSelected ? null : date)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedDate(isSelected ? null : date);
                  }
                }}
                className={cn(
                  "group flex min-h-[6rem] cursor-pointer flex-col items-stretch gap-1 border-b border-r border-border p-1.5 text-left transition-colors last:border-r-0 hover:bg-secondary/30",
                  !inMonth && "bg-muted/10 text-muted-foreground/50",
                  isSelected && "bg-primary/5 ring-1 ring-inset ring-primary/40",
                )}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-full text-xs",
                      isToday && "bg-primary font-semibold text-primary-foreground",
                    )}
                  >
                    {date.getDate()}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); newPostOn(key); }}
                    className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-secondary hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                    aria-label={`New post on ${key}`}
                    title="New post"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden">
                  {visible.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={(e) => { e.stopPropagation(); openPost(p.id); }}
                      className="flex min-w-0 items-center gap-1 rounded bg-secondary/60 px-1 py-0.5 text-left text-[11px] transition-colors hover:bg-secondary"
                    >
                      <span
                        className={cn(
                          "h-1.5 w-1.5 shrink-0 rounded-full",
                          STATUS_DOT_COLORS[p.status] ?? "bg-muted-foreground",
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {formatTime(p.schedule.runAt!)} {p.caption.text ?? p.input.prompt ?? p.workflow}
                      </span>
                    </button>
                  ))}
                  {overflow > 0 && (
                    <span className="truncate px-1 text-[11px] text-muted-foreground">
                      +{overflow} more
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {selectedDate && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-muted-foreground">
              {selectedDate.toDateString()}
            </h3>
            <Button variant="outline" size="sm" onClick={() => newPostOn(selectedKey!)}>
              <Plus className="h-3.5 w-3.5" /> New post
            </Button>
          </div>
          {selectedPosts.length === 0 ? (
            <Card className="p-4 text-sm text-muted-foreground">Nothing scheduled.</Card>
          ) : (
            <div className="space-y-2">
              {selectedPosts.map((p) => (
                <ScheduledItem key={p.id} post={p} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ListView({ byDay }: { byDay: Map<string, PostDTO[]> }) {
  const router = useRouter();

  if (byDay.size === 0) {
    return (
      <Card className="p-8 text-center text-muted-foreground">
        Nothing scheduled. Use “Schedule” in Compose to plan ahead.
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {[...byDay.entries()].map(([day, posts]) => (
        <div key={day}>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-muted-foreground">{day}</h2>
            <button
              type="button"
              onClick={() => router.push(`/compose?date=${dateKey(new Date(day))}`)}
              className="flex items-center gap-1 rounded p-0.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              title="New post"
            >
              <Plus className="h-3.5 w-3.5" /> New post
            </button>
          </div>
          <div className="space-y-2">
            {posts.map((p) => (
              <ScheduledItem key={p.id} post={p} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ScheduledItem({ post }: { post: PostDTO }) {
  const router = useRouter();

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => router.push(`/posts?highlight=${post.id}`)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          router.push(`/posts?highlight=${post.id}`);
        }
      }}
      className="flex cursor-pointer items-center justify-between gap-3 p-3 transition-colors hover:bg-secondary/40"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">
          {formatTime(post.schedule.runAt!)}
          {" · "}
          <span className="capitalize text-muted-foreground">
            {post.workflow.replace("_", " ")}
          </span>
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {post.input.prompt ?? post.caption.text ?? "—"}
        </p>
      </div>
      <div className="shrink-0">
        <StatusBadge status={post.status} />
      </div>
    </Card>
  );
}
