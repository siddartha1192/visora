import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Sparkles, Wand2, Images, Globe, CalendarClock } from "lucide-react";

const PILLARS = [
  { icon: Sparkles, title: "Generate", desc: "DALL·E 3 from a prompt" },
  { icon: Wand2, title: "Enhance", desc: "AI edit & inpaint uploads" },
  { icon: Images, title: "Discover", desc: "Stock from Pexels & Unsplash" },
  { icon: Globe, title: "Extract", desc: "Scrape visuals from any URL" },
  { icon: CalendarClock, title: "Schedule", desc: "Publish now or later" },
];

export default function Landing() {
  return (
    <main className="bg-grid relative flex min-h-screen flex-col items-center justify-center overflow-hidden">
      <div className="pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,black,transparent)]" />

      <div className="container relative flex flex-col items-center gap-14 py-24 text-center">
        <div className="space-y-6">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-xs font-medium text-muted-foreground shadow-elevate-xs">
            <Sparkles className="h-3.5 w-3.5 text-primary" /> Agentic AI · LangGraph orchestration
          </span>
          <h1 className="mx-auto max-w-3xl text-balance bg-gradient-to-b from-foreground to-foreground/70 bg-clip-text text-5xl font-semibold tracking-[-0.03em] text-transparent sm:text-6xl">
            The enterprise studio for AI visual content
          </h1>
          <p className="mx-auto max-w-xl text-lg leading-relaxed text-muted-foreground">
            Orchestrate, generate, enhance, and schedule multi-platform social posts —
            all driven by a pluggable agent graph.
          </p>
          <div className="flex items-center justify-center gap-3 pt-2">
            <Link href="/login">
              <Button size="lg">Get started</Button>
            </Link>
            <Link href="/posts">
              <Button size="lg" variant="outline">
                View posts
              </Button>
            </Link>
          </div>
        </div>

        <div className="grid w-full max-w-4xl grid-cols-2 gap-3 sm:grid-cols-5">
          {PILLARS.map((p) => (
            <div
              key={p.title}
              className="group rounded-lg border border-border bg-card p-5 text-left shadow-elevate-xs transition-colors duration-150 hover:border-primary/30"
            >
              <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 transition-colors duration-150 group-hover:bg-primary/15">
                <p.icon className="h-4 w-4 text-primary" />
              </span>
              <p className="text-sm font-semibold tracking-[-0.01em]">{p.title}</p>
              <p className="text-xs text-muted-foreground">{p.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
