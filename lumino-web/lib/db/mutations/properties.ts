import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import { reverseGeocodeWithGoogle } from "@/lib/geocoding/google";
import { getGoogleMapsApiKey } from "@/lib/utils/env";
import type { AuthSessionContext } from "@/types/auth";

const NEARBY_THRESHOLD = 0.00018;

function normalizeAddress(address: string) {
  return address.trim().toLowerCase().replace(/\s+/g, " ");
}

function droppedPinAddress(lat: number, lng: number) {
  return `Dropped Pin (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
}

function droppedPinKey(lat: number, lng: number) {
  return `pin:${lat.toFixed(5)},${lng.toFixed(5)}`;
}

export async function resolveOrCreateProperty(
  input: { lat: number; lng: number; persist?: boolean },
  context: AuthSessionContext
) {
  const supabase = createServerSupabaseClient();
  const googleMapsApiKey = getGoogleMapsApiKey();

  const { data: nearbyRows, error: nearbyError } = await supabase
    .from("properties")
    .select("id,raw_address,address_line_1,city,state,postal_code,zipcode,lat,lng")
    .gte("lat", input.lat - NEARBY_THRESHOLD)
    .lte("lat", input.lat + NEARBY_THRESHOLD)
    .gte("lng", input.lng - NEARBY_THRESHOLD)
    .lte("lng", input.lng + NEARBY_THRESHOLD)
    .limit(20);

  if (nearbyError) throw nearbyError;

  const closest =
    nearbyRows
      ?.map((row) => ({
        ...row,
        distance: Math.abs((row.lat ?? 0) - input.lat) + Math.abs((row.lng ?? 0) - input.lng)
      }))
      .sort((a, b) => a.distance - b.distance)[0] ?? null;

  if (closest) {
    return {
      propertyId: closest.id,
      created: false
    };
  }

  let geocoded = null;
  if (googleMapsApiKey) {
    try {
      geocoded = await reverseGeocodeWithGoogle(input.lat, input.lng, googleMapsApiKey);
    } catch (error) {
      console.error("[properties] reverse geocode failed", error);
    }
  }

  const normalizedAddress = geocoded
    ? normalizeAddress(geocoded.formattedAddress)
    : normalizeAddress(droppedPinKey(input.lat, input.lng));

  if (geocoded) {
    const { data: exactMatch, error: exactMatchError } = await supabase
      .from("properties")
      .select("id")
      .eq("normalized_address", normalizedAddress)
      .maybeSingle();

    if (exactMatchError) throw exactMatchError;
    if (exactMatch) {
      return {
        propertyId: exactMatch.id,
        created: false
      };
    }
  }

  const address = geocoded?.formattedAddress ?? droppedPinAddress(input.lat, input.lng);
  const now = new Date().toISOString();

  if (!input.persist) {
    return {
      propertyId: null,
      created: false,
      preview: {
        address,
        city: geocoded?.city ?? null,
        state: geocoded?.state ?? null,
        postalCode: geocoded?.postalCode ?? null,
        lat: input.lat,
        lng: input.lng
      }
    };
  }

  const insertPayload = {
    normalized_address: normalizedAddress,
    raw_address: address,
    address_line_1: geocoded?.addressLine1 ?? address,
    city: geocoded?.city ?? null,
    state: geocoded?.state ?? null,
    postal_code: geocoded?.postalCode ?? null,
    zipcode: geocoded?.postalCode ?? null,
    lat: input.lat,
    lng: input.lng,
    created_at: now,
    updated_at: now
  };

  const { data: insertedProperty, error: insertError } = await supabase
    .from("properties")
    .insert(insertPayload)
    .select("id")
    .single();

  if (insertError) throw insertError;

  if (context.organizationId) {
    await supabase.from("activities").insert({
      organization_id: context.organizationId,
      entity_type: "property",
      entity_id: insertedProperty.id,
      actor_user_id: context.appUser.id,
      type: "property_created_from_map",
      data: {
        address: address,
        geocoded: Boolean(geocoded),
        source: "map_tap",
        lat: input.lat,
        lng: input.lng
      }
    });
  }

  return {
    propertyId: insertedProperty.id,
    created: true,
    preview: null
  };
}
