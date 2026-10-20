"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Wand2,
  CalendarClock,
  Images,
  ListChecks,
  Settings,
  Bot,
  Users,
  KeyRound,
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
  { href: "/admin/api-keys",  label: "API Keys",    icon: KeyRound   },
  { href: "/admin/posts",     label: "All Posts",   icon: FileText   },
];

/**
 * Platform-operator screens: shared LLM credentials, the global node→model
 * routing singleton, and the raw document browser. The server gates these with
 * `requireRoot`; hiding them here keeps a non-root admin from seeing three nav
 * items that would all 403.
 */
const PLATFORM_NAV: NavItem[] = [
  { href: "/admin/llms",      label: "LLM Configs", icon: Cpu        },
  { href: "/admin/nodes",     label: "Node Config", icon: GitBranch  },
  { href: "/admin/database",  label: "Database",    icon: Database   },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();

  // Doubles as the admin-access guard and the source of the caller's role —
  // shares the ["admin-me"] cache key with the Users page rather than refetching.
  const { data: me, isError } = useQuery({
    queryKey: ["admin-me"],
    queryFn: adminApi.me,
    enabled: pathname !== "/admin/login",
    retry: false,
  });

  useEffect(() => {
    if (isError) router.replace("/admin/login");
  }, [isError, router]);

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
      <Sidebar
        userNav={USER_NAV}
        adminNav={me?.platformRole === "root" ? [...ADMIN_NAV, ...PLATFORM_NAV] : ADMIN_NAV}
        showAdmin
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onLogout={logout} />
        <main className="flex-1 px-6 py-8 md:px-10">{children}</main>
      </div>
    </div>
  );
}
