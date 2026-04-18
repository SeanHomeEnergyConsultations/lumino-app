import Link from "next/link";
import type { Route } from "next";
import { Map, LayoutDashboard, ListTodo, CheckSquare2, Users } from "lucide-react";
import { LogoMark } from "@/components/shared/logo-mark";

const nav = [
  { href: "/map", label: "Map", icon: Map },
  { href: "/queue", label: "Queue", icon: ListTodo },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/tasks", label: "Tasks", icon: CheckSquare2 },
  { href: "/team", label: "Team", icon: Users }
] as const satisfies ReadonlyArray<{
  href: Route;
  label: string;
  icon: typeof Map;
}>;

export function AppSidebar() {
  return (
    <aside className="hidden w-72 shrink-0 border-r border-slate-200/80 bg-white/70 px-5 py-6 backdrop-blur xl:block">
      <div className="flex items-center gap-3">
        <LogoMark />
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-mist">Lumino</div>
          <div className="text-lg font-semibold text-ink">Field CRM</div>
        </div>
      </div>

      <nav className="mt-10 space-y-2">
        {nav.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-950 hover:text-white"
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
