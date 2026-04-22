import { notFound } from "next/navigation";
import { PublicBookingPage } from "@/components/qr/public-booking-page";
import { getPublicQrCodeBySlug } from "@/lib/db/queries/qr";

export const dynamic = "force-dynamic";

export default async function BookingPage({
  params
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const item = await getPublicQrCodeBySlug(slug);
  if (!item) {
    notFound();
  }

  return <PublicBookingPage item={item} />;
}
