import { ProtectedAppShell } from "@/components/app-shell/protected-app-shell";
import { FollowUpPage } from "@/components/follow-up/follow-up-page";

export default async function FollowUpRoute({
  searchParams
}: {
  searchParams?: Promise<{ ownerId?: string; repName?: string }>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};

  return (
    <ProtectedAppShell requiredFeature="visitLoggingEnabled">
      <FollowUpPage
        initialOwnerId={resolvedSearchParams.ownerId ?? null}
        repName={resolvedSearchParams.repName ?? null}
      />
    </ProtectedAppShell>
  );
}
