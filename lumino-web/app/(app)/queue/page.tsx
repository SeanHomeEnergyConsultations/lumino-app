import { ProtectedAppShell } from "@/components/app-shell/protected-app-shell";
import { QueuePage } from "@/components/queue/queue-page";

export default async function QueueRoute({
  searchParams
}: {
  searchParams?: Promise<{ ownerId?: string; repName?: string }>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};

  return (
    <ProtectedAppShell requiredFeature="visitLoggingEnabled">
      <QueuePage initialOwnerId={resolvedSearchParams.ownerId ?? null} repName={resolvedSearchParams.repName ?? null} />
    </ProtectedAppShell>
  );
}
