"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Wand2,
  CalendarClock,
  Images,
  ListChecks,
  Settings,
  Bot,
  Users,
  Cpu,
  GitBranch,
  BarChart3,
  Database,
  FileText,
} from "lucide-react";
import { clearAuth, setLogoutReason } from "@/lib/api";
import { adminApi } from "@/lib/admin-api";
import { useIdleLogout } from "@/hooks/use-idle-logout";
import { Sidebar, Topbar, type NavItem } from "@/components/ui/app-shell";

const USER_NAV: NavItem[] = [
  { href: "/compose",    label: "Compose",    icon: Wand2         },
  { href: "/autonomous", label: "Autonomous", icon: Bot           },
  { href: "/posts",      label: "Posts",      icon: ListChecks    },
  { href: "/calendar",   label: "Calendar",   icon: CalendarClock },
  { href: "/library",    label: "Library",    icon: Images        },
  { href: "/settings",   label: "Settings",   icon: Settings      },
];

const ADMIN_NAV: NavItem[] = [
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

  const idleLogout = useCallback(() => {
    clearAuth();
    queryClient.clear();
    setLogoutReason("idle");
    router.replace("/admin/login");
  }, [queryClient, router]);

  useIdleLogout(idleLogout, { enabled: pathname !== "/admin/login" });

  if (pathname === "/admin/login") return <>{children}</>;

  return (
    <div className="flex min-h-screen">
      <Sidebar userNav={USER_NAV} adminNav={ADMIN_NAV} showAdmin />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onLogout={logout} />
        <main className="flex-1 px-6 py-8 md:px-10">{children}</main>
      </div>
    </div>
  );
}
