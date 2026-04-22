import { ProtectedAppShell } from "@/components/app-shell/protected-app-shell";
import { ResourcesPage } from "@/components/resources/resources-page";

export default function ResourcesRoutePage() {
  return (
    <ProtectedAppShell>
      <ResourcesPage />
    </ProtectedAppShell>
  );
}
