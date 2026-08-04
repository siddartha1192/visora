"use client";

import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

interface InlineCalendarProps {
  value: Date | null;
  onChange: (date: Date) => void;
  minDate?: Date;
}

/**
 * Fully inline (no floating/absolute popover) date+time picker.
 * Designed for use inside modals where a floating popover would risk
 * overlapping action buttons and causing accidental click-through.
 */
export function InlineCalendar({ value, onChange, minDate }: InlineCalendarProps) {
  const [viewYear, setViewYear]   = useState(() => (value ?? new Date()).getFullYear());
  const [viewMonth, setViewMonth] = useState(() => (value ?? new Date()).getMonth());
  const [showYears, setShowYears] = useState(false);

  // Keep view in sync when value changes externally
  useEffect(() => {
    if (value) {
      setViewYear(value.getFullYear());
      setViewMonth(value.getMonth());
    }
  }, [value]);

  const hour   = value?.getHours()   ?? 9;
  const minute = value?.getMinutes() ?? 0;

  function commit(y: number, m: number, d: number, h: number, min: number) {
    onChange(new Date(y, m, d, h, min));
  }

  function selectDay(day: number) {
    commit(viewYear, viewMonth, day, hour, minute);
  }

  function setHour(h: number) {
    if (!value) return;
    commit(value.getFullYear(), value.getMonth(), value.getDate(), h, minute);
  }

  function setMinute(m: number) {
    if (!value) return;
    commit(value.getFullYear(), value.getMonth(), value.getDate(), hour, m);
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11); }
    else setViewMonth((m) => m - 1);
    setShowYears(false);
  }

  function nextMonth() {
    if (viewMonth === 11) { setViewYear((y) => y + 1); setViewMonth(0); }
    else setViewMonth((m) => m + 1);
    setShowYears(false);
  }

  const firstDay    = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  function isDisabled(day: number) {
    if (!minDate) return false;
    return new Date(viewYear, viewMonth, day, 23, 59) < minDate;
  }

  function isSelected(day: number) {
    if (!value) return false;
    return (
      value.getFullYear() === viewYear &&
      value.getMonth()    === viewMonth &&
      value.getDate()     === day
    );
  }

  function isToday(day: number) {
    const n = new Date();
    return n.getFullYear() === viewYear && n.getMonth() === viewMonth && n.getDate() === day;
  }

  const thisYear  = new Date().getFullYear();
  const yearRange = Array.from({ length: 8 }, (_, i) => thisYear + i);

  return (
    <div className="select-none rounded-lg border border-border bg-muted/30 p-3">
      {/* ── Month / year navigation ── */}
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={prevMonth}
          className="rounded p-1 hover:bg-secondary/60 transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={() => setShowYears((s) => !s)}
          className="text-sm font-semibold hover:text-primary transition-colors"
        >
          {MONTHS[viewMonth]} {viewYear}
        </button>

        <button
          type="button"
          onClick={nextMonth}
          className="rounded p-1 hover:bg-secondary/60 transition-colors"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* ── Year grid (toggle) ── */}
      {showYears ? (
        <div className="grid grid-cols-4 gap-1 pb-2">
          {yearRange.map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => { setViewYear(y); setShowYears(false); }}
              className={cn(
                "rounded-lg py-1 text-sm transition-colors",
                y === viewYear
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "text-muted-foreground hover:bg-secondary/60",
              )}
            >
              {y}
            </button>
          ))}
        </div>
      ) : (
        <>
          {/* ── Day-of-week labels ── */}
          <div className="grid grid-cols-7 mb-1">
            {DAY_LABELS.map((d) => (
              <span key={d} className="text-center text-[11px] text-muted-foreground py-0.5">
                {d}
              </span>
            ))}
          </div>

          {/* ── Day grid ── */}
          <div className="grid grid-cols-7">
            {Array.from({ length: firstDay }).map((_, i) => <span key={`e${i}`} />)}
            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
              const disabled = isDisabled(day);
              const selected = isSelected(day);
              const today    = isToday(day);
              return (
                <button
                  key={day}
                  type="button"
                  disabled={disabled}
                  onClick={() => selectDay(day)}
                  className={cn(
                    "mx-auto flex h-8 w-8 items-center justify-center rounded-full text-sm transition-colors",
                    selected && "bg-primary text-primary-foreground font-semibold",
                    !selected && today && "border border-primary text-primary",
                    !selected && !disabled && "hover:bg-secondary/60",
                    disabled && "cursor-not-allowed opacity-30",
                  )}
                >
                  {day}
                </button>
              );
            })}
          </div>

          {/* ── Time selector ── */}
          <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
            <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Time</span>
            <div className="ml-auto flex items-center gap-1.5">
              <select
                value={hour}
                disabled={!value}
                onChange={(e) => setHour(Number(e.target.value))}
                className="rounded-md border border-border bg-background px-2 py-1 text-sm disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>{String(i).padStart(2, "0")}</option>
                ))}
              </select>
              <span className="font-medium text-muted-foreground">:</span>
              <select
                value={minute}
                disabled={!value}
                onChange={(e) => setMinute(Number(e.target.value))}
                className="rounded-md border border-border bg-background px-2 py-1 text-sm disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                  <option key={m} value={m}>{String(m).padStart(2, "0")}</option>
                ))}
              </select>
            </div>
            {!value && (
              <span className="text-xs text-muted-foreground">pick a day first</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
