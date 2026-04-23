import { ProtectedAppShell } from "@/components/app-shell/protected-app-shell";
import { QrWorkspacePage } from "@/components/qr/qr-workspace-page";

export default function QrPerformancePage() {
  return (
    <ProtectedAppShell>
      <QrWorkspacePage surface="performance" />
    </ProtectedAppShell>
  );
}
