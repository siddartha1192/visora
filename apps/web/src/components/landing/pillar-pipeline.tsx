"use client";

import {
  CalendarClock,
  Globe,
  Images,
  Sparkles,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { type PointerEvent } from "react";

type Pillar = { icon: LucideIcon; title: string; desc: string };

const PILLARS: Pillar[] = [
  { icon: Sparkles, title: "Generate", desc: "Studio-quality imagery from a prompt" },
  { icon: Wand2, title: "Enhance", desc: "AI edit & inpaint uploads" },
  { icon: Images, title: "Discover", desc: "Stock from Pexels & Unsplash" },
  { icon: Globe, title: "Extract", desc: "Scrape visuals from any URL" },
  { icon: CalendarClock, title: "Schedule", desc: "Publish now or later" },
];

/**
 * Pipeline clock. The rail beam is 20% of the track and travels from -100% to
 * +500% of its own width over one cycle, so it crosses column centre `i`
 * (at 10% + 20%·i of the track) at exactly BEAM_LEAD + i·NODE_STEP seconds.
 * The node dots and card icons reuse the same duration with that offset as
 * their delay, which keeps the whole strip in lockstep with no JS timer.
 * The 9s cycle itself lives in tailwind.config (`beam`/`node-pulse`/`icon-pulse`).
 */
const BEAM_LEAD = 1.5;
const NODE_STEP = 1.5;

/** Entrance stagger, picked up after the hero copy has landed. */
const CARD_LEAD = 0.8;
const CARD_STEP = 0.09;

export function PillarPipeline() {
  return (
    <div className="w-full max-w-4xl">
      {/* Rail — the literal "orchestrated pipeline" of the headline. Hidden on
          the 2-column mobile grid, where node positions no longer line up. */}
      <div
        aria-hidden
        className="animate-reveal relative mb-6 hidden h-6 sm:block"
        style={{ animationDelay: "0.7s" }}
      >
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-muted-foreground/40 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-px overflow-hidden">
          <div className="animate-beam h-px w-1/5 bg-gradient-to-r from-transparent via-primary to-transparent" />
        </div>
        {PILLARS.map((p, i) => (
          <span
            key={p.title}
            className="animate-node-pulse absolute -bottom-[2px] h-[5px] w-[5px] -translate-x-1/2 rounded-full bg-primary"
            style={{ left: `${10 + i * 20}%`, animationDelay: `${BEAM_LEAD + i * NODE_STEP}s` }}
          />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {PILLARS.map((p, i) => (
          <PillarCard key={p.title} pillar={p} index={i} />
        ))}
      </div>
    </div>
  );
}

function PillarCard({ pillar, index }: { pillar: Pillar; index: number }) {
  const Icon = pillar.icon;

  // Writes the hovered point straight to CSS vars — no state, no re-render.
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--cx", `${e.clientX - rect.left}px`);
    e.currentTarget.style.setProperty("--cy", `${e.clientY - rect.top}px`);
  };

  return (
    // Outer element owns the entrance animation; a `both`-filled animation
    // pins `transform`, so the hover lift has to live on a separate node.
    <div
      className="animate-reveal-scale"
      style={{ animationDelay: `${CARD_LEAD + index * CARD_STEP}s` }}
    >
      <div
        onPointerMove={onPointerMove}
        className="border-beam border-beam-hover group relative h-full overflow-hidden rounded-lg border border-border bg-card p-5 text-left shadow-elevate-xs transition-[transform,border-color,box-shadow] duration-300 ease-out hover:-translate-y-1 hover:border-primary/30 hover:shadow-elevate-md"
      >
        <div className="card-spotlight pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

        <span className="relative mb-3 flex h-9 w-9 items-center justify-center rounded-md">
          {/* Pulse layer sits behind the glyph so the icon itself never dims. */}
          <span
            className="animate-icon-pulse absolute inset-0 rounded-md bg-primary/10"
            style={{ animationDelay: `${BEAM_LEAD + index * NODE_STEP}s` }}
          />
          <Icon className="relative h-4 w-4 text-primary transition-transform duration-300 ease-out group-hover:-rotate-12 group-hover:scale-110" />
        </span>

        <p className="relative text-sm font-semibold tracking-[-0.01em]">
          {pillar.title}
        </p>
        <p className="relative text-xs text-muted-foreground">{pillar.desc}</p>
      </div>
    </div>
  );
}
