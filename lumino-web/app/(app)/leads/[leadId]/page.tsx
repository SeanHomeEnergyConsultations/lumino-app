import { ProtectedAppShell } from "@/components/app-shell/protected-app-shell";
import { LeadDetailPage } from "@/components/lead/lead-detail-page";

export default async function LeadRoute({
  params
}: {
  params: Promise<{ leadId: string }>;
}) {
  const { leadId } = await params;

  return (
    <ProtectedAppShell>
      <LeadDetailPage leadId={leadId} />
    </ProtectedAppShell>
  );
}
