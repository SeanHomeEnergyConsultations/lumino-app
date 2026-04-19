import { ProtectedAppShell } from "@/components/app-shell/protected-app-shell";
import { ManagerDashboardPage } from "@/components/dashboard/manager-dashboard-page";

export default function DashboardPage() {
  return (
    <ProtectedAppShell allowedRoles={["owner", "admin", "manager"]}>
      <ManagerDashboardPage />
    </ProtectedAppShell>
  );
}
