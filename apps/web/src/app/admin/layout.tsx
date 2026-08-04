"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Wand2,
  CalendarClock,
  Images,
  ListChecks,
  Settings,
  Sparkles,
  Bot,
  Users,
  Cpu,
  GitBranch,
  BarChart3,
  Database,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { clearAuth } from "@/lib/api";
import { adminApi } from "@/lib/admin-api";
import { UserMenu } from "@/components/ui/user-menu";
import { ThemeToggle } from "@/components/ui/theme-toggle";

const USER_NAV = [
  { href: "/compose",    label: "Compose",    icon: Wand2         },
  { href: "/autonomous", label: "Autonomous", icon: Bot           },
  { href: "/posts",      label: "Posts",      icon: ListChecks    },
  { href: "/calendar",   label: "Calendar",   icon: CalendarClock },
  { href: "/library",    label: "Library",    icon: Images        },
  { href: "/settings",   label: "Settings",   icon: Settings      },
];

const ADMIN_NAV = [
  { href: "/admin/analytics", label: "Analytics",   icon: BarChart3  },
  { href: "/admin/users",     label: "Users",       icon: Users      },
  { href: "/admin/posts",     label: "All Posts",   icon: FileText   },
  { href: "/admin/llms",      label: "LLM Configs", icon: Cpu        },
  { href: "/admin/nodes",     label: "Node Config", icon: GitBranch  },
  { href: "/admin/database",  label: "Database",    icon: Database   },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (pathname === "/admin/login") return;
    adminApi.me().catch(() => router.replace("/admin/login"));
  }, [pathname, router]);

  function logout() {
    clearAuth();
    queryClient.clear();
    router.replace("/login");
  }

  if (pathname === "/admin/login") return <>{children}</>;

  return (
    <div className="flex min-h-screen">
      {/* Sidebar — identical structure to dashboard layout */}
      <aside className="sticky top-0 hidden h-screen w-64 flex-col gap-2 border-r border-border bg-card p-4 md:flex">
        <Link href="/compose" className="mb-6 flex items-center gap-2.5 px-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary shadow-elevate-xs">
            <Sparkles className="h-4 w-4 text-primary-foreground" />
          </span>
          <span className="text-lg font-semibold tracking-[-0.02em]">Visora</span>
        </Link>

        {/* Regular user nav */}
        <nav className="flex flex-col gap-0.5">
          {USER_NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            const isAutonomous = item.href === "/autonomous";
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150",
                  active
                    ? "bg-primary/10 text-primary"
                    : isAutonomous
                    ? "text-accent/90 hover:bg-accent/10 hover:text-accent"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                )}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-primary" />
                )}
                <item.icon className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Admin section */}
        <div className="mt-4 border-t border-border pt-4">
          <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
            Administration
          </p>
          <nav className="flex flex-col gap-0.5">
            {ADMIN_NAV.map((item) => {
              const active = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                  )}
                >
                  {active && (
                    <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-primary" />
                  )}
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar — identical to dashboard topbar */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-end gap-3 border-b border-border bg-background/85 px-6 backdrop-blur-md">
          <ThemeToggle compact />
          <div className="h-5 w-px bg-border" />
          <UserMenu onLogout={logout} />
        </header>

        <main className="flex-1 px-6 py-8 md:px-10">{children}</main>
      </div>
    </div>
  );
}
