import { ProtectedAppShell } from "@/components/app-shell/protected-app-shell";
import { AppointmentsPage } from "@/components/appointments/appointments-page";

export default function AppointmentsRoute() {
  return (
    <ProtectedAppShell requiredFeature="appointmentsEnabled">
      <AppointmentsPage />
    </ProtectedAppShell>
  );
}
