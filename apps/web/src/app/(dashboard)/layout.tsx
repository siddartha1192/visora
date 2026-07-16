"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import {
  Wand2,
  CalendarClock,
  Images,
  ListChecks,
  Settings,
  Sparkles,
  Bot,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { clearAuth, api } from "@/lib/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserMenu } from "@/components/ui/user-menu";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Users, Cpu, GitBranch, BarChart3 } from "lucide-react";

const NAV = [
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
  { href: "/admin/llms",      label: "LLM Configs", icon: Cpu        },
  { href: "/admin/nodes",     label: "Node Config", icon: GitBranch  },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.getMe(),
    staleTime: 5 * 60_000,
    retry: false,
  });

  useEffect(() => {
    if (!localStorage.getItem("visora_token")) {
      router.replace("/login");
    }
  }, [router]);

  function logout() {
    clearAuth();
    queryClient.clear();
    router.replace("/login");
  }

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="glass sticky top-0 hidden h-screen w-64 flex-col gap-2 p-4 md:flex">
        <Link href="/compose" className="mb-6 flex items-center gap-2 px-2">
          <Sparkles className="h-6 w-6 text-primary" />
          <span className="text-xl font-bold tracking-tight">Visora</span>
        </Link>

        <nav className="flex flex-col gap-1">
          {NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            const isAutonomous = item.href === "/autonomous";
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary/15 text-primary"
                    : isAutonomous
                    ? "text-accent hover:bg-accent/10 hover:text-accent"
                    : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Administration section — only visible to admin users */}
        {me?.isAdmin && (
          <div className="mt-4">
            <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
              Administration
            </p>
            <nav className="flex flex-col gap-1">
              {ADMIN_NAV.map((item) => {
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
          </div>
        )}
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-end gap-3 border-b border-border/50 bg-background/80 px-6 backdrop-blur-md">
          <ThemeToggle compact />
          <div className="h-5 w-px bg-border" />
          <UserMenu onLogout={logout} />
        </header>

        <main className="flex-1 px-6 py-8 md:px-10">{children}</main>
      </div>
    </div>
  );
}
