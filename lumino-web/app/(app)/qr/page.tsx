import { ProtectedAppShell } from "@/components/app-shell/protected-app-shell";
import { QrHubPage } from "@/components/qr/qr-hub-page";

export default function QrPage() {
  return (
    <ProtectedAppShell>
      <QrHubPage />
    </ProtectedAppShell>
  );
}
