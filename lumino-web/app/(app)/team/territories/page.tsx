import { ProtectedAppShell } from "@/components/app-shell/protected-app-shell";
import { TerritoryAdminPage } from "@/components/team/territory-admin-page";

export default function TeamTerritoriesPage() {
  return (
    <ProtectedAppShell allowedRoles={["owner", "admin", "manager"]} requiredFeature="teamManagementEnabled">
      <TerritoryAdminPage surface="territories" />
    </ProtectedAppShell>
  );
}
