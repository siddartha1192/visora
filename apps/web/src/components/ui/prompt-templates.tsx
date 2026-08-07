"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface Template {
  label: string;
  emoji: string;
  text: string;
}

const TEMPLATES: Record<string, Template[]> = {
  ai_generate: [
    {
      label: "Product Shot",
      emoji: "📦",
      text: "A cinematic product shot of a sleek matte-black wireless speaker on a marble surface, soft studio lighting from the left, ultra-realistic, 4K, shallow depth of field",
    },
    {
      label: "Portrait",
      emoji: "🧑‍💼",
      text: "Professional headshot portrait of a confident young entrepreneur in a modern office, soft natural window light, shallow depth of field, photorealistic, warm tones",
    },
    {
      label: "Nature Scene",
      emoji: "🌄",
      text: "Golden hour sunset over misty mountain peaks with dramatic clouds, vibrant orange and purple sky, landscape photography, ultra-detailed, cinematic",
    },
    {
      label: "Food Photography",
      emoji: "🍽️",
      text: "Overhead flat-lay of a gourmet avocado toast with poached eggs on a rustic wooden table, natural morning light, food photography, appetizing, professional styling",
    },
    {
      label: "Minimalist Interior",
      emoji: "🛋️",
      text: "Minimalist Scandinavian living room, white walls, warm oak furniture, potted plants, soft afternoon light through large windows, interior design photography",
    },
    {
      label: "Abstract Art",
      emoji: "🎨",
      text: "Abstract fluid art with vibrant electric blues and deep purples, swirling organic patterns, glossy finish, digital art, high resolution, luxury brand aesthetic",
    },
    {
      label: "Fashion",
      emoji: "👗",
      text: "Editorial fashion photography of a model in a flowing white dress on a sunny beach, golden hour, dynamic movement, Vogue-style, film grain, high contrast",
    },
    {
      label: "Tech Device",
      emoji: "💻",
      text: "Sleek laptop on a minimal desk, dark background, neon accent lighting, futuristic tech aesthetic, product photography, ultra-sharp, 8K",
    },
  ],

  ai_enhance: [
    {
      label: "White Background",
      emoji: "⬜",
      text: "Remove the existing background and replace with a clean pure white studio background. Enhance lighting to look like a professional product shot.",
    },
    {
      label: "Cinematic Grade",
      emoji: "🎬",
      text: "Apply warm cinematic color grading with teal and orange tones, subtle film grain, dramatic shadows, and a shallow depth-of-field blur on the background.",
    },
    {
      label: "Vibrant & Punchy",
      emoji: "✨",
      text: "Boost colors to be more vibrant and punchy, increase contrast and clarity, add a subtle warm glow. Make it eye-catching for social media feeds.",
    },
    {
      label: "Social Media Ready",
      emoji: "📱",
      text: "Enhance for Instagram: brighten the image, add warm tones, increase saturation slightly, apply a soft vignette around the edges, sharpen key details.",
    },
    {
      label: "Luxury Feel",
      emoji: "💎",
      text: "Reprocess the image with a high-end luxury aesthetic: deep blacks, crisp highlights, cool-neutral tones, professional retouching, editorial magazine quality.",
    },
    {
      label: "Vintage Film",
      emoji: "📷",
      text: "Apply a vintage 35mm film look: faded highlights, lifted shadows, grain texture, slight color shift to warm yellows and greens, light leaks on the edges.",
    },
  ],

  stock_discovery: [
    {
      label: "Workspace",
      emoji: "🖥️",
      text: "minimalist home office desk setup with plants, natural light, clean aesthetic, productivity",
    },
    {
      label: "Team & People",
      emoji: "🤝",
      text: "diverse team collaborating in a bright modern office, smiling, brainstorming, positive energy",
    },
    {
      label: "Urban Life",
      emoji: "🌆",
      text: "busy city street at golden hour, urban lifestyle, pedestrians, vibrant atmosphere",
    },
    {
      label: "Healthy Lifestyle",
      emoji: "🥗",
      text: "healthy breakfast bowl with fresh fruits, morning coffee, lifestyle, bright and airy kitchen",
    },
    {
      label: "Nature & Travel",
      emoji: "🏔️",
      text: "aerial view of lush green forest and misty mountains, serene nature, travel photography",
    },
    {
      label: "Technology",
      emoji: "💡",
      text: "laptop and smartphone on a modern desk, tech startup vibe, clean and sharp, innovation",
    },
    {
      label: "Fitness",
      emoji: "💪",
      text: "athlete working out in a gym, dynamic motion, strong and energetic, fitness motivation",
    },
    {
      label: "Sustainability",
      emoji: "🌿",
      text: "eco-friendly sustainable living, green plants, natural materials, minimal waste, earthy tones",
    },
  ],

  scrape: [
    {
      label: "Hero Image",
      emoji: "🖼️",
      text: "the main hero or banner image at the top of the page",
    },
    {
      label: "Product Photo",
      emoji: "📸",
      text: "the primary product image or largest product thumbnail",
    },
    {
      label: "Featured Visual",
      emoji: "⭐",
      text: "the most prominent featured image or promotional visual",
    },
    {
      label: "Brand Logo",
      emoji: "🏷️",
      text: "the company or brand logo",
    },
  ],

  autonomous: [
    {
      label: "Product Launch",
      emoji: "🚀",
      text: "Create a stunning product launch post for a new pair of wireless earbuds. Target young professionals on Instagram with an inspiring caption about focus and productivity. Publish now.",
    },
    {
      label: "Nature & Motivation",
      emoji: "🌲",
      text: "Find a beautiful mountain landscape photo and post it to Instagram with a short motivational caption about perseverance and pushing limits. Use relevant hiking hashtags.",
    },
    {
      label: "Restaurant Special",
      emoji: "🍕",
      text: "Generate a mouthwatering Italian food photo and post to both Instagram and Facebook with a caption mentioning a weekend pasta special. Make it warm and inviting.",
    },
    {
      label: "Fitness Brand",
      emoji: "🏋️",
      text: "Generate an energetic gym and fitness photo showing strength training. Post to Instagram with a motivational caption about discipline and consistency, and add popular fitness hashtags.",
    },
    {
      label: "Real Estate",
      emoji: "🏡",
      text: "Find a beautiful modern home exterior photo with lush landscaping and post to Instagram with a caption about finding your dream home. Professional and aspirational tone.",
    },
    {
      label: "Tech Startup",
      emoji: "💻",
      text: "Generate a clean, futuristic tech image representing innovation and post to LinkedIn and Instagram. Caption should highlight how technology is solving real-world problems.",
    },
    {
      label: "Fashion Drop",
      emoji: "👟",
      text: "Create an eye-catching editorial fashion image for a new sneaker collection. Post to Instagram with hype-driven caption and streetwear hashtags. Vibrant and bold aesthetic.",
    },
    {
      label: "Travel Destination",
      emoji: "✈️",
      text: "Find a stunning travel photo of a tropical beach destination and post to Instagram with a dreamy caption about wanderlust and adventure. Schedule it for tomorrow at 9am.",
    },
  ],
};

interface PromptTemplatePanelProps {
  workflow: string;
  onSelect: (text: string) => void;
  className?: string;
}

export function PromptTemplatePanel({
  workflow,
  onSelect,
  className,
}: PromptTemplatePanelProps) {
  const [open, setOpen] = useState(false);
  const templates = TEMPLATES[workflow];
  if (!templates) return null;

  return (
    <div className={cn("mt-3", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {open ? (
          <ChevronUp className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )}
        {open ? "Hide templates" : "Browse prompt templates"}
        <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {templates.length}
        </span>
      </button>

      {open && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {templates.map((t) => (
            <button
              key={t.label}
              type="button"
              onClick={() => { onSelect(t.text); setOpen(false); }}
              className="group flex flex-col gap-1.5 rounded-lg border border-border bg-secondary/30 p-3 text-left transition-all duration-150 hover:border-primary/40 hover:bg-primary/5"
            >
              <span className="text-lg leading-none">{t.emoji}</span>
              <p className="text-xs font-semibold text-foreground">{t.label}</p>
              <p className="line-clamp-2 text-[10px] leading-relaxed text-muted-foreground group-hover:text-muted-foreground/80">
                {t.text}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
