import { ProtectedAppShell } from "@/components/app-shell/protected-app-shell";
import { PlatformWorkspacePage } from "@/components/platform/platform-workspace-page";

export default function PlatformSecurityPage() {
  return (
    <ProtectedAppShell platformOwnerOnly>
      <PlatformWorkspacePage surface="security" />
    </ProtectedAppShell>
  );
}
