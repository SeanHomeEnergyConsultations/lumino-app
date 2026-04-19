import { ProtectedAppShell } from "@/components/app-shell/protected-app-shell";
import { ImportBatchDetailPage } from "@/components/imports/import-batch-detail-page";

export default async function ImportBatchPage({
  params
}: {
  params: Promise<{ batchId: string }>;
}) {
  const { batchId } = await params;

  return (
    <ProtectedAppShell>
      <ImportBatchDetailPage batchId={batchId} />
    </ProtectedAppShell>
  );
}
