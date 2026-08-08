import Link from "next/link";
import { ArrowRight, ArrowUpRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HeroBackdrop } from "@/components/landing/hero-backdrop";
import { PillarPipeline } from "@/components/landing/pillar-pipeline";

/**
 * Marketing hero. Copy renders on the server; the two client children own the
 * ambient canvas and the pipeline strip. Entrance timings cascade top-down —
 * badge → headline → subhead → CTAs → rail → cards — via animation-delay only,
 * so nothing here depends on JS to become visible.
 */
export default function Landing() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden">
      <HeroBackdrop />

      <div className="container relative flex flex-col items-center gap-14 py-24 text-center">
        <div className="space-y-6">
          <div className="animate-reveal" style={{ animationDelay: "0.1s" }}>
            <span className="border-beam inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-xs font-medium text-muted-foreground shadow-elevate-xs">
              <span className="relative flex h-3.5 w-3.5 items-center justify-center">
                <Sparkles className="animate-pulse-dot h-3.5 w-3.5 text-primary" />
                <span className="animate-ping-ring absolute h-3.5 w-3.5 rounded-full bg-primary/25" />
              </span>
              Agentic AI · Orchestrated pipeline
            </span>
          </div>

          {/* Entrance lives on the wrapper: .text-sheen owns the h1's
              `animation` shorthand and an element only runs one of them. */}
          <div className="animate-reveal" style={{ animationDelay: "0.22s" }}>
            <h1 className="text-sheen mx-auto max-w-3xl text-balance text-5xl font-semibold tracking-[-0.03em] sm:text-6xl">
              The enterprise studio for AI visual content
            </h1>
          </div>

          <p
            className="animate-reveal mx-auto max-w-xl text-lg leading-relaxed text-muted-foreground"
            style={{ animationDelay: "0.38s" }}
          >
            Orchestrate, generate, enhance, and schedule multi-platform social posts —
            all driven by a pluggable agent graph.
          </p>

          <div
            className="animate-reveal flex items-center justify-center gap-3 pt-2"
            style={{ animationDelay: "0.52s" }}
          >
            <Link href="/login" className="relative inline-flex">
              {/* Soft breathing halo behind the primary action. */}
              <span
                aria-hidden
                className="animate-halo pointer-events-none absolute -inset-2 rounded-full bg-primary/25 blur-xl"
              />
              <Button
                size="lg"
                className="sheen-hover group relative overflow-hidden hover:shadow-ring-primary"
              >
                Get started
                <ArrowRight className="h-4 w-4 transition-transform duration-200 ease-out group-hover:translate-x-1" />
              </Button>
            </Link>
            <Link href="/posts">
              {/* No sheen here: the white sweep only reads against the cobalt
                  fill of the primary action, not on a transparent surface. */}
              <Button size="lg" variant="outline" className="group">
                View posts
                <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-all duration-200 ease-out group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground" />
              </Button>
            </Link>
          </div>
        </div>

        <PillarPipeline />
      </div>
    </main>
  );
}
