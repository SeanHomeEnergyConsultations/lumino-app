import { ProtectedAppShell } from "@/components/app-shell/protected-app-shell";
import { PropertyDetailPage } from "@/components/property/property-detail-page";

export default async function PropertyPage({
  params
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;

  return (
    <ProtectedAppShell>
      <PropertyDetailPage propertyId={propertyId} />
    </ProtectedAppShell>
  );
}
