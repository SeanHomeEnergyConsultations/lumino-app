import { ProtectedAppShell } from "@/components/app-shell/protected-app-shell";
import { QueuePage } from "@/components/queue/queue-page";

export default function QueueRoute() {
  return (
    <ProtectedAppShell>
      <QueuePage />
    </ProtectedAppShell>
  );
}
