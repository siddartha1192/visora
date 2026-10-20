import { cn } from "@/lib/utils";

/**
 * Visora brand mark — a typographic "V" with calligraphic weight contrast:
 * a heavy left stem, a light right stem, and a sharp vertex, the way a
 * broad-nib pen makes one. Drawn as a filled outline rather than two strokes
 * so the stems can carry different weights and the point stays crisp.
 *
 * The shape doubles as the product's story: two streams converging on a single
 * point is the pipeline itself — generate / enhance / discover / extract all
 * funnelling into one published post. The `animated` variant plays exactly
 * that beat.
 *
 * Geometry, in the 32-unit viewBox:
 *   outer edges  (3.4,5.8) and (28.6,5.8) → vertex (16,26.4)   — symmetric,
 *                so the silhouette reads unambiguously as a V
 *   inner edges  from (9.2,5.8) and (24.9,5.8), each parallel to its own outer
 *                edge, meeting at (17.05,18.63)
 * Stem widths therefore land at roughly 4.9 and 3.1 units — a ~1.5:1 contrast.
 * The inner apex sits right of centre because the stems differ in weight;
 * that offset is what makes it read as pen-drawn rather than geometric.
 */
const V_OUTLINE =
  "M3.4 5.8 16 26.4 28.6 5.8 24.9 5.8 17.05 18.63 9.2 5.8Z";

/**
 * Centrelines of each stem, both ending at the vertex. Lengths are 21.7 and
 * 22.2 units; one rounded constant for both is within a frame of each other,
 * which is what lets a single keyframe set land both traces on the vertex
 * together.
 */
const TRACES = ["M6.3 5.8 16 25.2", "M26.75 5.8 16 25.2"];
const ARM_LENGTH = 22.5;

const SIZES = {
  sm: {
    tile: "h-7 w-7 rounded-md",
    glyph: "h-[18px] w-[18px]",
    bloom: "-inset-1 rounded-lg",
  },
  lg: {
    tile: "h-14 w-14 rounded-2xl",
    glyph: "h-9 w-9",
    bloom: "-inset-2.5 rounded-[1.4rem]",
  },
} as const;

export function VisoraLogo({
  size = "lg",
  animated = false,
  className,
}: {
  size?: keyof typeof SIZES;
  animated?: boolean;
  className?: string;
}) {
  const s = SIZES[size];

  return (
    <span className={cn("relative block shrink-0", className)}>
      {/* Bloom sits behind the tile and bleeds past its edges. It runs on the
          same clock as the traces and peaks on impact rather than breathing on
          its own — the glow is the convergence landing, not decoration. */}
      {animated && (
        <span
          aria-hidden
          className={cn(
            "animate-logo-bloom absolute bg-primary/40 blur-lg",
            s.bloom,
          )}
        />
      )}

      <span
        className={cn(
          "relative flex items-center justify-center bg-primary text-primary-foreground shadow-elevate-md ring-1 ring-inset ring-white/15 transition-transform duration-300 ease-out group-hover:scale-105",
          s.tile,
        )}
      >
        <svg
          viewBox="0 0 32 32"
          aria-hidden
          className={cn(s.glyph, animated && "animate-logo-wipe")}
        >
          {/* Stroking the fill with a hairline rounds every corner by ~0.6
              units, which keeps the vertex from going needle-sharp at 28px. */}
          <path
            d={V_OUTLINE}
            fill="currentColor"
            stroke="currentColor"
            strokeWidth={1.2}
            strokeLinejoin="round"
            opacity={animated ? 0.82 : 1}
          />

          {animated && (
            <>
              {/* Light running down each stem to the vertex. A single short dash
                  is walked along the centreline by its dash offset; the glow is
                  what makes it visible, since a white trace on a white glyph has
                  nowhere brighter to go. The static offset parks it past the end
                  so reduced motion (which collapses the animation) hides it. */}
              {TRACES.map((d) => (
                <path
                  key={d}
                  d={d}
                  stroke="currentColor"
                  strokeWidth={2.2}
                  strokeLinecap="round"
                  fill="none"
                  className="animate-logo-flow [filter:drop-shadow(0_0_3.5px_currentColor)]"
                  style={{
                    strokeDasharray: "3.5 48",
                    strokeDashoffset: -ARM_LENGTH,
                    opacity: 0,
                  }}
                />
              ))}

              {/* Impact at the vertex. */}
              <circle
                cx={16}
                cy={25.4}
                r={2.4}
                fill="currentColor"
                className="animate-logo-spark"
                style={{ opacity: 0, transformOrigin: "16px 25.4px" }}
              />
            </>
          )}
        </svg>
      </span>
    </span>
  );
}
