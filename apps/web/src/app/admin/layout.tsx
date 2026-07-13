"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Shield, Users, Cpu, GitBranch, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { adminApi, setAdminToken } from "@/lib/admin-api";

const NAV = [
  { href: "/admin/users",  label: "Users",       icon: Users },
  { href: "/admin/llms",   label: "LLM Configs", icon: Cpu },
  { href: "/admin/nodes",  label: "Node Config", icon: GitBranch },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (pathname === "/admin/login") return;
    adminApi.me().catch(() => router.replace("/admin/login"));
  }, [pathname, router]);

  function logout() {
    setAdminToken(null);
    router.replace("/login");
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="flex h-screen w-56 shrink-0 flex-col border-r border-border bg-secondary/20 sticky top-0">
        {/* Brand */}
        <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
          <Shield className="h-5 w-5 text-primary" />
          <span className="font-semibold tracking-tight">Admin</span>
        </div>

        {/* Nav */}
        <nav className="flex flex-col gap-0.5 p-3 flex-1">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Sign out */}
        <div className="border-t border-border p-3">
          <button
            onClick={logout}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-auto p-8">{children}</main>
    </div>
  );
}
