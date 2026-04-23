import { ProtectedAppShell } from "@/components/app-shell/protected-app-shell";
import { QrWorkspacePage } from "@/components/qr/qr-workspace-page";

export default function QrBookingProfilePage() {
  return (
    <ProtectedAppShell>
      <QrWorkspacePage surface="bookingProfile" />
    </ProtectedAppShell>
  );
}
