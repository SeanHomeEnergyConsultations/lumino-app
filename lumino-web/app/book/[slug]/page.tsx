import { notFound } from "next/navigation";
import { PublicBookingPage } from "@/components/qr/public-booking-page";
import { getPublicQrCodeBySlug } from "@/lib/db/queries/qr";
import { getE2EPublicQrCode } from "@/lib/e2e/public-qr-fixtures";

export const dynamic = "force-dynamic";

export default async function BookingPage({
  params
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const item =
    process.env.NEXT_PUBLIC_E2E_MODE === "1"
      ? getE2EPublicQrCode(slug)
      : await getPublicQrCodeBySlug(slug);
  if (!item) {
    notFound();
  }

  return <PublicBookingPage item={item} />;
}
