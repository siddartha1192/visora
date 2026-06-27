"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  Wand2,
  CalendarClock,
  Images,
  ListChecks,
  Settings,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/compose", label: "Compose", icon: Wand2 },
  { href: "/posts", label: "Posts", icon: ListChecks },
  { href: "/calendar", label: "Calendar", icon: CalendarClock },
  { href: "/library", label: "Library", icon: Images },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex min-h-screen">
      <aside className="glass sticky top-0 hidden h-screen w-64 flex-col gap-2 p-4 md:flex">
        <Link href="/" className="mb-6 flex items-center gap-2 px-2">
          <Sparkles className="h-6 w-6 text-primary" />
          <span className="text-xl font-bold tracking-tight">Visora</span>
        </Link>
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <main className="flex-1 px-6 py-8 md:px-10">{children}</main>
    </div>
  );
}
