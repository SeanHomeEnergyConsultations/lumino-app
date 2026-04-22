import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { PublicQrCard } from "@/components/qr/public-qr-card";
import { recordQrEvent } from "@/lib/db/mutations/qr";
import { getPublicQrCodeBySlug } from "@/lib/db/queries/qr";

export const dynamic = "force-dynamic";

export default async function ConnectQrPage({
  params
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const item = await getPublicQrCodeBySlug(slug);
  if (!item) {
    notFound();
  }

  const headerStore = await headers();
  const request = new Request("https://lumino.local/connect", {
    headers: new Headers(headerStore)
  });

  await recordQrEvent({
    qrCodeId: item.qrCodeId,
    organizationId: item.organizationId,
    eventType: "scan",
    request
  }).catch(() => null);

  return <PublicQrCard item={item} />;
}
