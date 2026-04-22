import { redirect } from "next/navigation";

export default async function QueueRoute({
  searchParams
}: {
  searchParams?: Promise<{ ownerId?: string; repName?: string }>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const params = new URLSearchParams();
  if (resolvedSearchParams.ownerId) {
    params.set("ownerId", resolvedSearchParams.ownerId);
  }
  if (resolvedSearchParams.repName) {
    params.set("repName", resolvedSearchParams.repName);
  }

  redirect(params.toString() ? `/follow-up?${params.toString()}` : "/follow-up");
}
