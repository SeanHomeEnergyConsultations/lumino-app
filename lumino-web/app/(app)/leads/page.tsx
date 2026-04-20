import { ProtectedAppShell } from "@/components/app-shell/protected-app-shell";
import { LeadsPage } from "@/components/lead/leads-page";

export default function LeadsRoute() {
  return (
    <ProtectedAppShell requiredFeature="leadsEnabled">
      <LeadsPage />
    </ProtectedAppShell>
  );
}
