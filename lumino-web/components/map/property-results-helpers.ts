import type { MapProperty } from "../../types/entities";

export type ResultItem = {
  propertyId: string;
  address: string;
  subtitle: string;
  mapState?: MapProperty["mapState"];
  visitCount?: number;
  notHomeCount?: number;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  priorityScore?: number;
  priorityBand?: MapProperty["priorityBand"];
};

export const DEFAULT_RESULTS_RENDER_COUNT = 120;

function resultIdentityKey(item: ResultItem) {
  const fullAddress = item.address.trim().toLowerCase();
  if (fullAddress) {
    return fullAddress;
  }
  const line1 = item.address.split(",")[0]?.trim().toLowerCase() ?? "";
  const city = (item.city ?? "").trim().toLowerCase();
  const state = (item.state ?? "").trim().toLowerCase();
  const postal = (item.postalCode ?? "").trim().toLowerCase();
  return [line1, city, state, postal].join("|");
}

function resultPriorityScore(item: ResultItem) {
  return (
    (item.priorityScore ?? 0) +
    (item.visitCount ?? 0) +
    (item.mapState === "imported_target" ? 5 : 0)
  );
}

export function projectPropertyResult(item: MapProperty): ResultItem {
  return {
    propertyId: item.propertyId,
    address: item.address,
    subtitle: `${item.visitCount} visits${item.mapState === "not_home" && item.notHomeCount > 1 ? ` · ${item.notHomeCount} tries` : ""}`,
    mapState: item.mapState,
    visitCount: item.visitCount,
    notHomeCount: item.notHomeCount,
    city: item.city,
    state: item.state,
    postalCode: item.postalCode,
    priorityScore: item.priorityScore,
    priorityBand: item.priorityBand
  };
}

export function buildRemotePropertySearchResults(
  items: Array<{
    propertyId?: string | null;
    kind: string;
    title: string;
    subtitle: string;
  }>
): ResultItem[] {
  return items
    .filter((item) => item.propertyId)
    .map((item) => ({
      propertyId: item.propertyId as string,
      address: item.kind === "property" ? item.title : item.subtitle,
      subtitle: item.kind === "property" ? item.subtitle : item.title
    }));
}

export function filterLocalPropertyResults(items: MapProperty[], query: string) {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    return items.map(projectPropertyResult);
  }

  return items
    .filter((item) =>
      [item.address, item.city, item.state, item.postalCode]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(trimmed))
    )
    .map(projectPropertyResult);
}

export function dedupePropertyResults(items: ResultItem[]) {
  return Array.from(
    items.reduce((map, item) => {
      const key = resultIdentityKey(item);
      const existing = map.get(key);
      if (!existing || resultPriorityScore(item) >= resultPriorityScore(existing)) {
        map.set(key, item);
      }
      return map;
    }, new Map<string, ResultItem>()).values()
  );
}

export function buildVisiblePropertyResults(input: {
  items: MapProperty[];
  query: string;
  remoteResults: ResultItem[];
}) {
  const trimmed = input.query.trim().toLowerCase();
  const localMatches = dedupePropertyResults(filterLocalPropertyResults(input.items, input.query));

  if (!trimmed) {
    return localMatches;
  }

  const merged = new Map<string, ResultItem>();
  for (const item of localMatches) {
    merged.set(resultIdentityKey(item), item);
  }
  for (const item of input.remoteResults) {
    const key = resultIdentityKey(item);
    if (!merged.has(key)) {
      merged.set(key, item);
    }
  }

  return Array.from(merged.values()).sort((left, right) => resultPriorityScore(right) - resultPriorityScore(left));
}
