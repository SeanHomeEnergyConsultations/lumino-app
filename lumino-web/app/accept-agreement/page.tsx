import { AcceptAgreementPage } from "@/components/legal/accept-agreement-page";

export default async function AcceptAgreementRoute({
  searchParams
}: {
  searchParams?: Promise<{ next?: string }>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const nextPath = resolvedSearchParams.next && resolvedSearchParams.next.startsWith("/")
    ? resolvedSearchParams.next
    : "/map";

  return <AcceptAgreementPage nextPath={nextPath} />;
}
