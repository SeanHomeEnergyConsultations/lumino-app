import { ProtectedAppShell } from "@/components/app-shell/protected-app-shell";
import { ImportsPage } from "@/components/imports/imports-page";

export default function ImportsRoute() {
  return (
    <ProtectedAppShell allowedRoles={["owner", "admin", "manager"]}>
      <ImportsPage />
    </ProtectedAppShell>
  );
}
