"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronLeft, ChevronRight, Calendar, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

interface DateTimePickerProps {
  value: Date | null;
  onChange: (date: Date | null) => void;
  minDate?: Date;
  placeholder?: string;
}

export function DateTimePicker({
  value,
  onChange,
  minDate,
  placeholder = "Pick a date & time",
}: DateTimePickerProps) {
  const [open, setOpen] = useState(false);
  const [showYearPicker, setShowYearPicker] = useState(false);
  const [viewYear, setViewYear] = useState(() => (value ?? new Date()).getFullYear());
  const [viewMonth, setViewMonth] = useState(() => (value ?? new Date()).getMonth());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setShowYearPicker(false);
      }
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open]);

  // Keep view in sync when value changes externally
  useEffect(() => {
    if (value) {
      setViewYear(value.getFullYear());
      setViewMonth(value.getMonth());
    }
  }, [value]);

  const selectedHour = value?.getHours() ?? 9;
  const selectedMinute = value?.getMinutes() ?? 0;

  function setHour(h: number) {
    const base = value ?? new Date(viewYear, viewMonth, 1);
    const d = new Date(base);
    d.setHours(h);
    onChange(d);
  }

  function setMinute(m: number) {
    const base = value ?? new Date(viewYear, viewMonth, 1);
    const d = new Date(base);
    d.setMinutes(m);
    onChange(d);
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); }
    else setViewMonth((m) => m - 1);
    setShowYearPicker(false);
  }

  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); }
    else setViewMonth((m) => m + 1);
    setShowYearPicker(false);
  }

  function selectDay(day: number) {
    const d = new Date(viewYear, viewMonth, day, selectedHour, selectedMinute);
    onChange(d);
  }

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  function isDayDisabled(day: number) {
    if (!minDate) return false;
    return new Date(viewYear, viewMonth, day, 23, 59) < minDate;
  }

  function isSelected(day: number) {
    if (!value) return false;
    return value.getFullYear() === viewYear && value.getMonth() === viewMonth && value.getDate() === day;
  }

  function isToday(day: number) {
    const now = new Date();
    return now.getFullYear() === viewYear && now.getMonth() === viewMonth && now.getDate() === day;
  }

  const displayValue = value
    ? value.toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : null;

  const thisYear = new Date().getFullYear();
  const yearRange = Array.from({ length: 8 }, (_, i) => thisYear + i);

  return (
    <div ref={ref} className="relative inline-block">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex items-center gap-2 rounded-lg border border-border bg-transparent px-3 py-1.5 text-sm transition-colors hover:bg-secondary/50",
          open && "ring-2 ring-ring",
          !displayValue && "text-muted-foreground",
        )}
      >
        <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
        {displayValue ?? placeholder}
      </button>

      {/* Popover */}
      {open && (
        <div className="animate-fade-in absolute left-0 z-50 mt-2 w-72 rounded-lg border border-border bg-card shadow-elevate-lg">

          {/* ── Month / year header ── */}
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <button
              type="button"
              onClick={prevMonth}
              className="rounded p-1 transition-colors hover:bg-secondary/50"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setShowYearPicker((y) => !y)}
              className="text-sm font-semibold transition-colors hover:text-primary"
            >
              {MONTHS[viewMonth]} {viewYear}
            </button>
            <button
              type="button"
              onClick={nextMonth}
              className="rounded p-1 transition-colors hover:bg-secondary/50"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* ── Year picker ── */}
          {showYearPicker ? (
            <div className="grid grid-cols-4 gap-1 px-4 pb-4">
              {yearRange.map((y) => (
                <button
                  key={y}
                  type="button"
                  onClick={() => { setViewYear(y); setShowYearPicker(false); }}
                  className={cn(
                    "rounded-lg py-1.5 text-sm transition-colors",
                    y === viewYear
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-secondary/50",
                  )}
                >
                  {y}
                </button>
              ))}
            </div>
          ) : (
            <>
              {/* ── Day-of-week labels ── */}
              <div className="grid grid-cols-7 px-3 pb-1">
                {DAY_LABELS.map((d) => (
                  <span key={d} className="py-1 text-center text-xs text-muted-foreground">
                    {d}
                  </span>
                ))}
              </div>

              {/* ── Day grid ── */}
              <div className="grid grid-cols-7 px-3 pb-3">
                {Array.from({ length: firstDay }).map((_, i) => <span key={`e${i}`} />)}
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
                  const disabled = isDayDisabled(day);
                  const selected = isSelected(day);
                  const today = isToday(day);
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
                        !selected && !disabled && "hover:bg-secondary/50",
                        disabled && "cursor-not-allowed opacity-30",
                      )}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>

              {/* ── Time picker ── */}
              <div className="border-t border-border px-4 py-3">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Time</span>
                  <div className="ml-auto flex items-center gap-1.5">
                    <select
                      value={selectedHour}
                      onChange={(e) => setHour(Number(e.target.value))}
                      className="rounded-md border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {Array.from({ length: 24 }, (_, i) => (
                        <option key={i} value={i}>
                          {String(i).padStart(2, "0")}
                        </option>
                      ))}
                    </select>
                    <span className="font-medium text-muted-foreground">:</span>
                    <select
                      value={selectedMinute}
                      onChange={(e) => setMinute(Number(e.target.value))}
                      className="rounded-md border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                        <option key={m} value={m}>
                          {String(m).padStart(2, "0")}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
