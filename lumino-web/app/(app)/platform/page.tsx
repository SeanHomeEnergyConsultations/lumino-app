import { ProtectedAppShell } from "@/components/app-shell/protected-app-shell";
import { PlatformControlCenterPage } from "@/components/platform/platform-control-center-page";

export default function PlatformPage() {
  return (
    <ProtectedAppShell platformOnly>
      <PlatformControlCenterPage />
    </ProtectedAppShell>
  );
}
