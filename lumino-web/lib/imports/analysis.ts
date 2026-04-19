import { createHash } from "crypto";
import { getGoogleMapsApiKey } from "@/lib/utils/env";

type ImportLeadRow = {
  id: string;
  property_id: string | null;
  address: string | null;
  normalized_address: string | null;
  zipcode: string | null;
  city: string | null;
  state: string | null;
  lat: number | null;
  lng: number | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  listing_agent: string | null;
  source: string | null;
  analysis_attempt_count: number | null;
};

type SolarInsights = {
  sunHours: number | null;
  maxArrayPanelsCount: number | null;
  maxArrayAreaM2: number | null;
  panelCapacityWatts: number | null;
  systemCapacityKw: number | null;
  yearlyEnergyDcKwh: number | null;
  roofSegmentCount: number | null;
  southFacingSegmentCount: number | null;
  wholeRoofAreaM2: number | null;
  buildingAreaM2: number | null;
  imageryQuality: string | null;
};

export type ImportAnalysisResult = {
  address: string;
  lat: number | null;
  lng: number | null;
  zipcode: string | null;
  sunHours: number | null;
  sunHoursDisplay: string;
  category: string;
  solarFitScore: number;
  roofCapacityScore: number;
  roofComplexityScore: number;
  priorityScore: number;
  priorityLabel: string;
  parkingAddress: string;
  parkingEase: string;
  doorsToKnock: number;
  idealCount: number;
  goodCount: number;
  walkableCount: number;
  streetViewLink: string;
  salePrice: number | null;
  priceDisplay: string;
  valueBadge: string;
  sqft: number | null;
  sqftDisplay: string;
  beds: string | null;
  baths: string | null;
  soldDate: string | null;
  permitPulled: string | null;
  valueScore: number;
  sqftScore: number;
  solarDetails: Record<string, unknown>;
};

function stringOrNull(value: unknown) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(num) ? num : null;
}

function integerOrNull(value: unknown) {
  const num = numberOrNull(value);
  return num === null ? null : Math.round(num);
}

function parseSalePrice(payload: Record<string, unknown>) {
  const primary = numberOrNull(payload.Price ?? payload.PRICE ?? payload.price);
  return primary && primary > 0 ? primary : null;
}

function formatDate(value: unknown) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? trimmed : date.toLocaleDateString();
}

function scoreHomeValue(price: number | null) {
  if (!price || price <= 0) return { score: 0, display: "Unknown", badge: "Unknown" };
  if (price >= 1500000) return { score: 3, display: `$${price.toLocaleString()}`, badge: "Ultra High" };
  if (price >= 1000000) return { score: 3, display: `$${price.toLocaleString()}`, badge: "High Value" };
  if (price >= 750000) return { score: 2, display: `$${price.toLocaleString()}`, badge: "Upper Mid" };
  if (price >= 500000) return { score: 2, display: `$${price.toLocaleString()}`, badge: "Mid Value" };
  if (price >= 300000) return { score: 1, display: `$${price.toLocaleString()}`, badge: "Standard" };
  return { score: 0, display: `$${price.toLocaleString()}`, badge: "Lower Value" };
}

function scoreSqft(sqft: number | null) {
  if (!sqft || sqft <= 0) return { score: 0, display: "Unknown" };
  if (sqft >= 3000) return { score: 3, display: `${sqft.toLocaleString()} sq ft` };
  if (sqft >= 2500) return { score: 2, display: `${sqft.toLocaleString()} sq ft` };
  if (sqft >= 2000) return { score: 2, display: `${sqft.toLocaleString()} sq ft` };
  if (sqft >= 1500) return { score: 1, display: `${sqft.toLocaleString()} sq ft` };
  return { score: 0, display: `${sqft.toLocaleString()} sq ft` };
}

function scoreRoofCapacity(maxPanels: number | null, maxArea: number | null, yearlyEnergy: number | null) {
  if ((maxPanels ?? 0) >= 24 || (maxArea ?? 0) >= 45 || (yearlyEnergy ?? 0) >= 12000) return 2;
  if ((maxPanels ?? 0) >= 14 || (maxArea ?? 0) >= 26 || (yearlyEnergy ?? 0) >= 7000) return 1;
  return 0;
}

function scoreRoofComplexity(roofSegments: number | null, southSegments: number | null) {
  const segments = roofSegments ?? 0;
  const south = southSegments ?? 0;
  if (!segments) return 0;
  return segments <= 4 || south >= Math.max(1, Math.round(segments * 0.5)) ? 1 : 0;
}

function classifySunHours(hours: number | null) {
  if (hours === null) return { category: "Unknown", score: 0 };
  if (hours > 1600) return { category: "Best", score: 4 };
  if (hours >= 1400) return { category: "Better", score: 3 };
  if (hours >= 1200) return { category: "Good", score: 2 };
  if (hours >= 1000) return { category: "Low", score: 1 };
  return { category: "Too Low", score: 0 };
}

function scoreSolarFit(sunScore: number, roofCapacityScore: number, roofComplexityScore: number) {
  if (sunScore === 0) return 0;
  return sunScore + roofCapacityScore + roofComplexityScore;
}

function combinedPriority(solarFitScore: number, valueScore: number, sqftScore: number) {
  if (solarFitScore === 0) return { score: 0, label: "LOW — Poor solar potential" };
  const total = solarFitScore + valueScore + sqftScore;
  if (solarFitScore >= 6 && total >= 10) return { score: 4, label: "PREMIUM — High value + great solar" };
  if (solarFitScore >= 4 && total >= 7) return { score: 3, label: "HIGHEST — Worth stopping" };
  if (solarFitScore >= 3 && total >= 5) return { score: 2, label: "HIGH — Worth stopping" };
  if (solarFitScore >= 2 && total >= 3) return { score: 1, label: "MEDIUM — Quick stop" };
  return { score: 0, label: "LOW — Skip" };
}

function parkingEase(address: string) {
  const lowered = address.toLowerCase();
  if (["drive", "court", "circle", "lane", "way"].some((word) => lowered.includes(word))) return "Good — suburban street";
  if (["avenue", "boulevard"].some((word) => lowered.includes(word))) return "Fair — may have street parking";
  if (lowered.includes("street")) return "Check first — could be tight";
  return "Scout first";
}

function streetViewLink(lat: number | null, lng: number | null, address: string) {
  if (lat !== null && lng !== null) {
    return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
  }
  return `https://www.google.com/maps/@?api=1&map_action=pano&query=${encodeURIComponent(address)}`;
}

async function geocodeAddress(address: string, apiKey: string) {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("key", apiKey);
  const response = await fetch(url.toString(), { cache: "no-store" });
  if (!response.ok) return { lat: null, lng: null };
  const payload = await response.json() as { results?: Array<{ geometry?: { location?: { lat?: number; lng?: number } } }> };
  const location = payload.results?.[0]?.geometry?.location;
  return {
    lat: typeof location?.lat === "number" ? location.lat : null,
    lng: typeof location?.lng === "number" ? location.lng : null
  };
}

async function getSolarInsights(lat: number, lng: number, apiKey: string): Promise<SolarInsights> {
  const baseUrl = new URL("https://solar.googleapis.com/v1/buildingInsights:findClosest");
  baseUrl.searchParams.set("location.latitude", String(lat));
  baseUrl.searchParams.set("location.longitude", String(lng));
  baseUrl.searchParams.set("key", apiKey);

  const attempts = [
    {},
    { requiredQuality: "MEDIUM", exactQualityRequired: "false" }
  ];

  for (const extra of attempts) {
    const url = new URL(baseUrl.toString());
    Object.entries(extra).forEach(([key, value]) => url.searchParams.set(key, value));
    const response = await fetch(url.toString(), { cache: "no-store" });
    if (!response.ok) continue;
    const payload = await response.json() as Record<string, unknown>;
    const solarPotential = (payload.solarPotential as Record<string, unknown> | undefined) ?? {};
    const roofSegments = (solarPotential.roofSegmentStats as Array<Record<string, unknown>> | undefined) ?? [];
    const southFacingSegments = roofSegments.filter((segment) => {
      const azimuth = numberOrNull(segment.azimuthDegrees);
      return azimuth !== null && azimuth >= 90 && azimuth <= 270;
    }).length;
    const configs = (solarPotential.solarPanelConfigs as Array<Record<string, unknown>> | undefined) ?? [];
    const bestConfig = [...configs].sort((a, b) => {
      const aEnergy = numberOrNull(a.yearlyEnergyDcKwh) ?? 0;
      const bEnergy = numberOrNull(b.yearlyEnergyDcKwh) ?? 0;
      if (bEnergy !== aEnergy) return bEnergy - aEnergy;
      return (numberOrNull(b.panelsCount) ?? 0) - (numberOrNull(a.panelsCount) ?? 0);
    })[0] ?? {};

    return {
      sunHours: numberOrNull(solarPotential.maxSunshineHoursPerYear),
      maxArrayPanelsCount: integerOrNull(solarPotential.maxArrayPanelsCount),
      maxArrayAreaM2: numberOrNull(solarPotential.maxArrayAreaMeters2),
      panelCapacityWatts: numberOrNull(solarPotential.panelCapacityWatts),
      systemCapacityKw:
        (numberOrNull(bestConfig.panelsCount) ?? 0) > 0 && (numberOrNull(solarPotential.panelCapacityWatts) ?? 0) > 0
          ? ((numberOrNull(bestConfig.panelsCount) ?? 0) * (numberOrNull(solarPotential.panelCapacityWatts) ?? 0)) / 1000
          : null,
      yearlyEnergyDcKwh: numberOrNull(bestConfig.yearlyEnergyDcKwh),
      roofSegmentCount: roofSegments.length,
      southFacingSegmentCount: southFacingSegments,
      wholeRoofAreaM2: numberOrNull((solarPotential.wholeRoofStats as Record<string, unknown> | undefined)?.areaMeters2),
      buildingAreaM2: numberOrNull((solarPotential.buildingStats as Record<string, unknown> | undefined)?.areaMeters2),
      imageryQuality: stringOrNull(payload.imageryQuality)
    };
  }

  return {
    sunHours: null,
    maxArrayPanelsCount: null,
    maxArrayAreaM2: null,
    panelCapacityWatts: null,
    systemCapacityKw: null,
    yearlyEnergyDcKwh: null,
    roofSegmentCount: null,
    southFacingSegmentCount: null,
    wholeRoofAreaM2: null,
    buildingAreaM2: null,
    imageryQuality: null
  };
}

export function makeAnalysisCacheKey(rowData: Record<string, unknown>) {
  const normalized = {
    address: String(rowData.address ?? "").trim(),
    price: rowData.Price ?? rowData.PRICE ?? rowData.price ?? null,
    beds: rowData.Beds ?? rowData.BEDS ?? rowData.beds ?? null,
    baths: rowData.Baths ?? rowData.BATHS ?? rowData.baths ?? null,
    sqft: rowData.SqFt ?? rowData.SQUARE_FEET ?? rowData["SQUARE FEET"] ?? rowData.sqft ?? null,
    sold_date: rowData["Sale Date"] ?? rowData["SOLD DATE"] ?? rowData.sale_date ?? rowData.sold_date ?? null
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

export async function analyzeImportLead(
  payload: Record<string, unknown>,
  lead: ImportLeadRow
): Promise<ImportAnalysisResult> {
  const apiKey = getGoogleMapsApiKey();
  if (!apiKey) {
    throw new Error("Missing GOOGLE_MAPS_API_KEY.");
  }

  const address = String(payload.address ?? lead.address ?? "").trim();
  if (!address) throw new Error("Missing address for analysis.");

  const salePrice = parseSalePrice(payload);
  const sqft = numberOrNull(payload.SqFt ?? payload["SQUARE FEET"] ?? payload.sqft);
  const beds = stringOrNull(payload.Beds ?? payload.BEDS ?? payload.beds);
  const baths = stringOrNull(payload.Baths ?? payload.BATHS ?? payload.baths);
  const soldDate = formatDate(payload["Sale Date"] ?? payload["SOLD DATE"] ?? payload.sold_date);
  const permitPulled = formatDate(payload.permit_pulled ?? payload["Permit Pulled"]);

  const coordinates =
    lead.lat !== null && lead.lng !== null
      ? { lat: lead.lat, lng: lead.lng }
      : await geocodeAddress(address, apiKey);

  const value = scoreHomeValue(salePrice);
  const sqftResult = scoreSqft(sqft);

  if (coordinates.lat === null || coordinates.lng === null) {
    return {
      address,
      lat: null,
      lng: null,
      zipcode: lead.zipcode,
      sunHours: null,
      sunHoursDisplay: "N/A",
      category: "Unknown",
      solarFitScore: 0,
      roofCapacityScore: 0,
      roofComplexityScore: 0,
      priorityScore: 0,
      priorityLabel: "LOW — Could not geocode",
      parkingAddress: address,
      parkingEase: parkingEase(address),
      doorsToKnock: 0,
      idealCount: 0,
      goodCount: 0,
      walkableCount: 0,
      streetViewLink: streetViewLink(null, null, address),
      salePrice,
      priceDisplay: value.display,
      valueBadge: value.badge,
      sqft,
      sqftDisplay: sqftResult.display,
      beds,
      baths,
      soldDate,
      permitPulled,
      valueScore: value.score,
      sqftScore: sqftResult.score,
      solarDetails: {}
    };
  }

  const solar = await getSolarInsights(coordinates.lat, coordinates.lng, apiKey);
  const sun = classifySunHours(solar.sunHours);
  const roofCapacityScore = scoreRoofCapacity(
    solar.maxArrayPanelsCount,
    solar.maxArrayAreaM2,
    solar.yearlyEnergyDcKwh
  );
  const roofComplexityScore = scoreRoofComplexity(
    solar.roofSegmentCount,
    solar.southFacingSegmentCount
  );
  const solarFitScore = scoreSolarFit(sun.score, roofCapacityScore, roofComplexityScore);
  const priority = combinedPriority(solarFitScore, value.score, sqftResult.score);

  return {
    address,
    lat: coordinates.lat,
    lng: coordinates.lng,
    zipcode: lead.zipcode,
    sunHours: solar.sunHours,
    sunHoursDisplay: solar.sunHours === null ? "N/A" : `${Math.round(solar.sunHours)}`,
    category: sun.category,
    solarFitScore,
    roofCapacityScore,
    roofComplexityScore,
    priorityScore: priority.score,
    priorityLabel: priority.label,
    parkingAddress: address,
    parkingEase: parkingEase(address),
    doorsToKnock: 1,
    idealCount: sun.score >= 3 ? 1 : 0,
    goodCount: sun.score >= 2 ? 1 : 0,
    walkableCount: 0,
    streetViewLink: streetViewLink(coordinates.lat, coordinates.lng, address),
    salePrice,
    priceDisplay: value.display,
    valueBadge: value.badge,
    sqft,
    sqftDisplay: sqftResult.display,
    beds,
    baths,
    soldDate,
    permitPulled,
    valueScore: value.score,
    sqftScore: sqftResult.score,
    solarDetails: {
      solar_fit_score: solarFitScore,
      roof_capacity_score: roofCapacityScore,
      roof_complexity_score: roofComplexityScore,
      max_array_panels_count: solar.maxArrayPanelsCount,
      max_array_area_m2: solar.maxArrayAreaM2,
      panel_capacity_watts: solar.panelCapacityWatts,
      system_capacity_kw: solar.systemCapacityKw,
      yearly_energy_dc_kwh: solar.yearlyEnergyDcKwh,
      roof_segment_count: solar.roofSegmentCount,
      south_facing_segment_count: solar.southFacingSegmentCount,
      whole_roof_area_m2: solar.wholeRoofAreaM2,
      building_area_m2: solar.buildingAreaM2,
      imagery_quality: solar.imageryQuality
    }
  };
}
