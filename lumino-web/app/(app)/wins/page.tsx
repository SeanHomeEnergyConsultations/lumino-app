import { ProtectedAppShell } from "@/components/app-shell/protected-app-shell";
import { PerformanceHubPage } from "@/components/performance/performance-hub-page";

export default function WinsPage() {
  return (
    <ProtectedAppShell>
      <PerformanceHubPage />
    </ProtectedAppShell>
  );
}
