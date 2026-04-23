import { ProtectedAppShell } from "@/components/app-shell/protected-app-shell";
import { TerritoryAdminPage } from "@/components/team/territory-admin-page";

export default function TeamBrandingPage() {
  return (
    <ProtectedAppShell allowedRoles={["owner", "admin"]} requiredFeature="teamManagementEnabled">
      <TerritoryAdminPage surface="branding" />
    </ProtectedAppShell>
  );
}
