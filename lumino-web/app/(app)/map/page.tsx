import { ProtectedAppShell } from "@/components/app-shell/protected-app-shell";
import { LiveFieldMap } from "@/components/map/live-field-map";

export default function MapPage() {
  return (
    <ProtectedAppShell>
      <LiveFieldMap initialItems={[]} />
    </ProtectedAppShell>
  );
}
