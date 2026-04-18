import { ProtectedAppShell } from "@/components/app-shell/protected-app-shell";
import { MapToolbar } from "@/components/map/map-toolbar";
import { LiveFieldMap } from "@/components/map/live-field-map";

export default function MapPage() {
  return (
    <ProtectedAppShell>
      <MapToolbar />
      <LiveFieldMap initialItems={[]} />
    </ProtectedAppShell>
  );
}
