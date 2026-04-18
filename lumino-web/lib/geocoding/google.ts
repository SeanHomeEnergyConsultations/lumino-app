interface GoogleAddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

interface GoogleReverseGeocodeResult {
  formatted_address: string;
  address_components: GoogleAddressComponent[];
  types: string[];
}

interface GoogleReverseGeocodeResponse {
  status: string;
  results: GoogleReverseGeocodeResult[];
}

export interface ReverseGeocodeResult {
  formattedAddress: string;
  addressLine1: string;
  city: string | null;
  state: string | null;
  postalCode: string | null;
}

function componentValue(components: GoogleAddressComponent[], type: string, useShort = false) {
  const component = components.find((item) => item.types.includes(type));
  if (!component) return null;
  return useShort ? component.short_name : component.long_name;
}

function buildAddressLine1(components: GoogleAddressComponent[]) {
  const streetNumber = componentValue(components, "street_number");
  const route = componentValue(components, "route");
  return [streetNumber, route].filter(Boolean).join(" ").trim();
}

function selectBestResult(results: GoogleReverseGeocodeResult[]) {
  return (
    results.find((result) => result.types.includes("street_address")) ||
    results.find((result) => result.types.includes("premise")) ||
    results.find((result) => result.types.includes("subpremise")) ||
    results[0] ||
    null
  );
}

export async function reverseGeocodeWithGoogle(
  lat: number,
  lng: number,
  apiKey: string
): Promise<ReverseGeocodeResult | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("latlng", `${lat},${lng}`);
  url.searchParams.set("location_type", "ROOFTOP");
  url.searchParams.set("result_type", "street_address");
  url.searchParams.set("key", apiKey);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Google reverse geocode failed with status ${response.status}`);
  }

  const json = (await response.json()) as GoogleReverseGeocodeResponse;
  if (json.status === "ZERO_RESULTS") return null;
  if (json.status !== "OK") {
    throw new Error(`Google reverse geocode failed with status ${json.status}`);
  }

  const result = selectBestResult(json.results);
  if (!result) return null;

  const addressLine1 = buildAddressLine1(result.address_components);
  const city =
    componentValue(result.address_components, "locality") ||
    componentValue(result.address_components, "postal_town") ||
    componentValue(result.address_components, "sublocality") ||
    null;
  const state = componentValue(result.address_components, "administrative_area_level_1", true);
  const postalCode = componentValue(result.address_components, "postal_code");

  return {
    formattedAddress: result.formatted_address,
    addressLine1: addressLine1 || result.formatted_address,
    city,
    state,
    postalCode
  };
}
