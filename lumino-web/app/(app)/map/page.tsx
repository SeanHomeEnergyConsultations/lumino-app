import { ProtectedAppShell } from "@/components/app-shell/protected-app-shell";
import { LiveFieldMap } from "@/components/map/live-field-map";

export default async function MapPage({
  searchParams
}: {
  searchParams?: Promise<{ propertyId?: string }>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};

  return (
    <ProtectedAppShell>
      <LiveFieldMap initialItems={[]} initialSelectedPropertyId={resolvedSearchParams.propertyId ?? null} />
    </ProtectedAppShell>
  );
}
