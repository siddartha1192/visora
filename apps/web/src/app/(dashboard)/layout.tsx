"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, type ReactNode } from "react";
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
import { clearAuth, api, setLogoutReason } from "@/lib/api";
import { useIdleLogout } from "@/hooks/use-idle-logout";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sidebar, Topbar, type NavItem } from "@/components/ui/app-shell";

const NAV: NavItem[] = [
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
 * Platform-operator screens — see the matching list in app/admin/layout.tsx.
 * Server-gated by `requireRoot`; hidden here so a non-root admin isn't shown
 * three nav items that would all 403.
 */
const PLATFORM_NAV: NavItem[] = [
  { href: "/admin/llms",      label: "LLM Configs", icon: Cpu        },
  { href: "/admin/nodes",     label: "Node Config", icon: GitBranch  },
  { href: "/admin/database",  label: "Database",    icon: Database   },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
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

  const idleLogout = useCallback(() => {
    clearAuth();
    queryClient.clear();
    setLogoutReason("idle");
    router.replace("/login");
  }, [queryClient, router]);

  useIdleLogout(idleLogout);

  return (
    <div className="flex min-h-screen">
      <Sidebar
        userNav={NAV}
        adminNav={me?.platformRole === "root" ? [...ADMIN_NAV, ...PLATFORM_NAV] : ADMIN_NAV}
        showAdmin={Boolean(me?.platformRole) || me?.orgRole === "owner" ||
          (me?.workspaces ?? []).some((w) => w.myRole === "admin")}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onLogout={logout} />
        <main className="flex-1 px-6 py-8 md:px-10">{children}</main>
      </div>
    </div>
  );
}
