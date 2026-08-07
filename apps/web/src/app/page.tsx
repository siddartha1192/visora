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
    <main className="container flex min-h-screen flex-col items-center justify-center gap-12 py-20 text-center">
      <div className="space-y-6">
        <span className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-1.5 text-sm text-muted-foreground">
          <Sparkles className="h-4 w-4 text-primary" /> Agentic AI · LangGraph orchestration
        </span>
        <h1 className="mx-auto max-w-3xl bg-gradient-to-br from-white to-slate-400 bg-clip-text text-5xl font-bold tracking-tight text-transparent sm:text-6xl">
          The enterprise studio for AI visual content
        </h1>
        <p className="mx-auto max-w-xl text-lg text-muted-foreground">
          Orchestrate, generate, enhance, and schedule multi-platform social posts —
          all driven by a pluggable agent graph.
        </p>
        <div className="flex items-center justify-center gap-3">
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

      <div className="grid w-full max-w-4xl grid-cols-2 gap-4 sm:grid-cols-5">
        {PILLARS.map((p) => (
          <div key={p.title} className="glass rounded-xl p-5 text-left">
            <p.icon className="mb-3 h-6 w-6 text-accent" />
            <p className="font-semibold">{p.title}</p>
            <p className="text-xs text-muted-foreground">{p.desc}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
