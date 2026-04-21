import { ProtectedAppShell } from "@/components/app-shell/protected-app-shell";
import { LiveFieldMap } from "@/components/map/live-field-map";
import type { MapFilterKey } from "@/components/map/map-toolbar";

export default async function MapPage({
  searchParams
}: {
  searchParams?: Promise<{
    propertyId?: string;
    filters?: string;
    ownerId?: string;
    city?: string;
    state?: string;
    address?: string;
  }>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const initialFilters = (resolvedSearchParams.filters?.split(",").filter(Boolean) ?? []) as MapFilterKey[];

  return (
    <ProtectedAppShell requiredFeature="mapEnabled">
      <LiveFieldMap
        initialItems={[]}
        initialSelectedPropertyId={resolvedSearchParams.propertyId ?? null}
        initialFilters={initialFilters.length ? initialFilters : ["all"]}
        ownerIdFilter={resolvedSearchParams.ownerId ?? null}
        cityFilter={resolvedSearchParams.city ?? null}
        stateFilter={resolvedSearchParams.state ?? null}
        initialAddressSearch={resolvedSearchParams.address ?? null}
      />
    </ProtectedAppShell>
  );
}
