"use client";

import { useEffect, useRef } from "react";
import { refreshSession } from "@/lib/api";

/** No user activity for this long → forced logout. */
export const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

// Refresh the access token (15-minute TTL) well before it expires, so an
// active user never gets bounced just because time passed — only true idle
// time triggers a logout.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const TICK_MS = 30 * 1000;

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "wheel", "scroll", "touchstart"] as const;

/**
 * Wires up activity listeners and, on an interval, either force-logs-out
 * an idle user or silently refreshes their session while they're active.
 */
export function useIdleLogout(logout: () => void, opts: { enabled?: boolean } = {}) {
  const enabled = opts.enabled ?? true;
  const lastActivityRef = useRef(Date.now());
  const lastRefreshRef = useRef(Date.now());
  const refreshingRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    function markActive() {
      lastActivityRef.current = Date.now();
    }
    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, markActive, { passive: true }));

    const timer = setInterval(async () => {
      const now = Date.now();

      if (now - lastActivityRef.current >= IDLE_TIMEOUT_MS) {
        logout();
        return;
      }

      if (!refreshingRef.current && now - lastRefreshRef.current >= REFRESH_MARGIN_MS) {
        refreshingRef.current = true;
        const token = await refreshSession();
        refreshingRef.current = false;
        if (token) {
          lastRefreshRef.current = Date.now();
        } else {
          // Refresh token missing/expired (e.g. 30-day cap reached) — nothing
          // left to keep the session alive with.
          logout();
        }
      }
    }, TICK_MS);

    return () => {
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, markActive));
      clearInterval(timer);
    };
  }, [logout]);
}
