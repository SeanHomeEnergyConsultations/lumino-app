export const DATASET_ENTITLEMENT_TYPES = [
  "sold_properties",
  "solar_permits",
  "roofing_permits"
] as const;

export type DatasetEntitlementType = (typeof DATASET_ENTITLEMENT_TYPES)[number];
export type DatasetEntitlementGeographyType = "city" | "zip";

export interface DatasetEntitlementCollection {
  sold_properties: { cities: string[]; zips: string[] };
  solar_permits: { cities: string[]; zips: string[] };
  roofing_permits: { cities: string[]; zips: string[] };
}

export interface DatasetCoverageSummary {
  cities: string[];
  zips: string[];
}

export interface DatasetRecordGeography {
  city: string | null;
  zip: string | null;
}

export function emptyDatasetEntitlements(): DatasetEntitlementCollection {
  return {
    sold_properties: { cities: [], zips: [] },
    solar_permits: { cities: [], zips: [] },
    roofing_permits: { cities: [], zips: [] }
  };
}

export function normalizeDatasetEntitlementValue(
  geographyType: DatasetEntitlementGeographyType,
  value: string
) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return geographyType === "zip"
    ? trimmed.toUpperCase()
    : trimmed.toLowerCase().replace(/\s+/g, " ");
}

export function displayDatasetEntitlementValue(
  geographyType: DatasetEntitlementGeographyType,
  value: string
) {
  if (geographyType === "zip") return value.toUpperCase();
  return value
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function parseDatasetEntitlementInput(value: string, geographyType: DatasetEntitlementGeographyType) {
  const seen = new Set<string>();
  const items: string[] = [];

  for (const part of value.split(/[\n,]+/)) {
    const normalized = normalizeDatasetEntitlementValue(geographyType, part);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    items.push(normalized);
  }

  return items;
}

export function coverageMatchesEntitlements(
  datasetType: string,
  coverage: DatasetCoverageSummary,
  entitlements: DatasetEntitlementCollection
) {
  if (!DATASET_ENTITLEMENT_TYPES.includes(datasetType as DatasetEntitlementType)) {
    return false;
  }

  const relevant = entitlements[datasetType as DatasetEntitlementType];
  const zipSet = new Set(relevant.zips.map((value) => normalizeDatasetEntitlementValue("zip", value)));
  const citySet = new Set(relevant.cities.map((value) => normalizeDatasetEntitlementValue("city", value)));

  const zipMatch = coverage.zips.some((value) => zipSet.has(normalizeDatasetEntitlementValue("zip", value)));
  const cityMatch = coverage.cities.some((value) => citySet.has(normalizeDatasetEntitlementValue("city", value)));
  return zipMatch || cityMatch;
}

export function countMatchingDatasetTargets(
  datasetType: string,
  records: DatasetRecordGeography[],
  entitlements: DatasetEntitlementCollection
) {
  if (!DATASET_ENTITLEMENT_TYPES.includes(datasetType as DatasetEntitlementType)) {
    return 0;
  }

  const relevant = entitlements[datasetType as DatasetEntitlementType];
  const zipSet = new Set(relevant.zips.map((value) => normalizeDatasetEntitlementValue("zip", value)));
  const citySet = new Set(relevant.cities.map((value) => normalizeDatasetEntitlementValue("city", value)));

  let count = 0;
  for (const record of records) {
    const city = normalizeDatasetEntitlementValue("city", record.city ?? "");
    const zip = normalizeDatasetEntitlementValue("zip", record.zip ?? "");
    if ((zip && zipSet.has(zip)) || (city && citySet.has(city))) {
      count += 1;
    }
  }

  return count;
}
