"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ElementType } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { VisoraLogo } from "@/components/ui/logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { UserMenu } from "@/components/ui/user-menu";
import { WorkspaceSwitcher } from "@/components/ui/workspace-switcher";

export interface NavItem {
  href: string;
  label: string;
  icon: ElementType;
}

interface SidebarProps {
  userNav: NavItem[];
  adminNav?: NavItem[];
  showAdmin?: boolean;
}

function NavLink({ item, accentTone = false }: { item: NavItem; accentTone?: boolean }) {
  const pathname = usePathname();
  const active = pathname.startsWith(item.href);

  return (
    <Link
      href={item.href}
      className={cn(
        "group relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150",
        active
          ? "bg-primary/10 text-primary"
          : accentTone
          ? "text-accent/90 hover:bg-accent/10 hover:text-accent"
          : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
      )}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-primary" />
      )}
      <span
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors duration-150",
          active
            ? "bg-primary/15"
            : accentTone
            ? "group-hover:bg-accent/15"
            : "group-hover:bg-secondary",
        )}
      >
        <item.icon className="h-3.5 w-3.5" />
      </span>
      {item.label}
    </Link>
  );
}

export function Sidebar({ userNav, adminNav, showAdmin }: SidebarProps) {
  return (
    <aside className="sticky top-0 hidden h-screen w-64 flex-col gap-2 border-r border-border bg-card p-4 md:flex">
      <Link href="/compose" className="group mb-6 flex items-center gap-2.5 px-2">
        <VisoraLogo size="sm" />
        <span className="text-lg font-semibold tracking-[-0.02em]">Visora</span>
      </Link>

      <nav className="flex flex-col gap-0.5">
        {userNav.map((item) => (
          <NavLink key={item.href} item={item} accentTone={item.href === "/autonomous"} />
        ))}
      </nav>

      {showAdmin && adminNav && adminNav.length > 0 && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
            Administration
          </p>
          <nav className="flex flex-col gap-0.5">
            {adminNav.map((item) => (
              <NavLink key={item.href} item={item} />
            ))}
          </nav>
        </div>
      )}
    </aside>
  );
}

export function Topbar({ onLogout }: { onLogout: () => void }) {
  const pathname = usePathname();
  const onComposeAlready = pathname.startsWith("/compose");

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-end gap-3 border-b border-border bg-background/85 px-6 backdrop-blur-md">
      <WorkspaceSwitcher />
      <div className="mr-auto" />
      {!onComposeAlready && (
        <>
          <Link href="/compose">
            <Button size="sm" className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              New Post
            </Button>
          </Link>
          <div className="h-5 w-px bg-border" />
        </>
      )}
      <ThemeToggle compact />
      <div className="h-5 w-px bg-border" />
      <UserMenu onLogout={onLogout} />
    </header>
  );
}
