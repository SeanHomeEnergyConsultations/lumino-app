import { ProtectedAppShell } from "@/components/app-shell/protected-app-shell";
import { TerritoryAdminPage } from "@/components/team/territory-admin-page";

export default function TeamPage() {
  return (
    <ProtectedAppShell>
      <TerritoryAdminPage />
    </ProtectedAppShell>
  );
}
