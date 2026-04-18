import type { ReactNode } from "react";
import { AppSidebar } from "@/components/app-shell/app-sidebar";
import { AppTopbar } from "@/components/app-shell/app-topbar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <AppSidebar />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <AppTopbar />
        <main className="min-h-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
