import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import { MANAGER_ROLES, hasManagerAccess } from "@/lib/auth/permissions";
import { normalizeQrAvailabilitySettings, normalizeQrBookingTypeConfigs } from "@/lib/qr/availability";
import { getAppBaseUrl } from "@/lib/utils/env";
import type { AuthSessionContext } from "@/types/auth";
import type {
  QRCodeCampaignTrackerPayload,
  PublicQRCodeResponse,
  QRCodeContactCardPayload,
  QRCodeHubResponse,
  QRCodeListItem,
  QRCodeType
} from "@/types/api";

type QRCodeRow = {
  id: string;
  owner_user_id: string;
  territory_id: string | null;
  label: string;
  slug: string;
  code_type: QRCodeType;
  status: "active" | "paused" | "archived";
  payload: Record<string, unknown> | null;
  created_at: string;
};

type QRCodeEventRow = {
  qr_code_id: string;
  event_type: string;
  city: string | null;
  created_at: string;
};

function isManagerRole(role: string | null | undefined): role is (typeof MANAGER_ROLES)[number] {
  return Boolean(role && MANAGER_ROLES.includes(role as (typeof MANAGER_ROLES)[number]));
}

function normalizePayload(payload: Record<string, unknown> | null | undefined): QRCodeContactCardPayload {
  return {
    firstName: typeof payload?.firstName === "string" ? payload.firstName : null,
    lastName: typeof payload?.lastName === "string" ? payload.lastName : null,
    title: typeof payload?.title === "string" ? payload.title : null,
    photoUrl: typeof payload?.photoUrl === "string" ? payload.photoUrl : null,
    phone: typeof payload?.phone === "string" ? payload.phone : null,
    email: typeof payload?.email === "string" ? payload.email : null,
    website: typeof payload?.website === "string" ? payload.website : null,
    bookingEnabled: payload?.bookingEnabled !== false,
    bookingBlurb: typeof payload?.bookingBlurb === "string" ? payload.bookingBlurb : null,
    organizationName: typeof payload?.organizationName === "string" ? payload.organizationName : null,
    appName: typeof payload?.appName === "string" ? payload.appName : null,
    logoUrl: typeof payload?.logoUrl === "string" ? payload.logoUrl : null,
    primaryColor: typeof payload?.primaryColor === "string" ? payload.primaryColor : null,
    accentColor: typeof payload?.accentColor === "string" ? payload.accentColor : null,
    bookingTypes: normalizeQrBookingTypeConfigs(
      typeof payload?.bookingTypes === "object" && payload?.bookingTypes ? (payload.bookingTypes as Record<string, unknown>) : null
    ),
    availability: normalizeQrAvailabilitySettings(
      typeof payload?.availability === "object" && payload?.availability ? (payload.availability as Record<string, unknown>) : null
    )
  };
}

function normalizeCampaignPayload(
  payload: Record<string, unknown> | null | undefined
): QRCodeCampaignTrackerPayload {
  return {
    destinationUrl: typeof payload?.destinationUrl === "string" ? payload.destinationUrl : "",
    description: typeof payload?.description === "string" ? payload.description : null
  };
}

export function buildQrPublicUrl(slug: string, codeType: QRCodeType = "contact_card") {
  const baseUrl = getAppBaseUrl();
  const path = codeType === "campaign_tracker" ? `/go/${slug}` : `/connect/${slug}`;
  return baseUrl ? `${baseUrl.replace(/\/$/, "")}${path}` : path;
}

export function buildQrBookingUrl(slug: string) {
  const baseUrl = getAppBaseUrl();
  const path = `/book/${slug}`;
  return baseUrl ? `${baseUrl.replace(/\/$/, "")}${path}` : path;
}

function mapQrItems(input: {
  rows: QRCodeRow[];
  ownerMap: Map<string, { full_name: string | null; email: string | null }>;
  ownerMembershipMap: Map<string, { role: string | null }>;
  territoryMap: Map<string, { name: string | null }>;
  eventsByCode: Map<string, QRCodeEventRow[]>;
  currentUserId: string;
  currentUserCanManage: boolean;
}): QRCodeListItem[] {
  return input.rows.map((row) => {
    const payload =
      row.code_type === "campaign_tracker"
        ? normalizeCampaignPayload(row.payload)
        : normalizePayload(row.payload);
    const owner = input.ownerMap.get(row.owner_user_id);
    const ownerMembership = input.ownerMembershipMap.get(row.owner_user_id);
    const ownerRole =
      ownerMembership?.role === "owner" ||
      ownerMembership?.role === "admin" ||
      ownerMembership?.role === "manager" ||
      ownerMembership?.role === "rep" ||
      ownerMembership?.role === "setter"
        ? ownerMembership.role
        : null;
    const territory = row.territory_id ? input.territoryMap.get(row.territory_id) : null;
    const events = input.eventsByCode.get(row.id) ?? [];
    const cityCounts = new Map<string, number>();

    let scans = 0;
    let appointmentsBooked = 0;
    let saveContacts = 0;
    let calls = 0;
    let texts = 0;
    let emails = 0;
    let websiteClicks = 0;
    let lastScanAt: string | null = null;

    for (const event of events) {
      switch (event.event_type) {
        case "scan":
          scans += 1;
          if (!lastScanAt || new Date(event.created_at).getTime() > new Date(lastScanAt).getTime()) {
            lastScanAt = event.created_at;
          }
          break;
        case "appointment_booked":
          appointmentsBooked += 1;
          break;
        case "save_contact":
          saveContacts += 1;
          break;
        case "call_click":
          calls += 1;
          break;
        case "text_click":
          texts += 1;
          break;
        case "email_click":
          emails += 1;
          break;
        case "website_click":
          websiteClicks += 1;
          break;
        default:
          break;
      }

      if (event.city) {
        cityCounts.set(event.city, (cityCounts.get(event.city) ?? 0) + 1);
      }
    }

    const topCities = [...cityCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([city]) => city);

    return {
      qrCodeId: row.id,
      ownerUserId: row.owner_user_id,
      ownerName: owner?.full_name ?? owner?.email ?? null,
      ownerRole,
      territoryId: row.territory_id,
      territoryName: territory?.name ?? null,
      label: row.label,
      slug: row.slug,
      codeType: row.code_type,
      status: row.status,
      isShared: row.owner_user_id !== input.currentUserId && isManagerRole(ownerRole),
      canDelete: input.currentUserCanManage || row.owner_user_id === input.currentUserId,
      publicUrl: buildQrPublicUrl(row.slug, row.code_type),
      publicBookingUrl: row.code_type === "contact_card" ? buildQrBookingUrl(row.slug) : buildQrPublicUrl(row.slug, row.code_type),
      createdAt: row.created_at,
      payload,
      stats: {
        scans,
        appointmentsBooked,
        saveContacts,
        calls,
        texts,
        emails,
        websiteClicks,
        lastScanAt,
        topCities
      }
    };
  });
}

export async function getQrHub(context: AuthSessionContext): Promise<QRCodeHubResponse> {
  const supabase = createServerSupabaseClient();
  if (!context.organizationId) {
    throw new Error("No active organization found for this user.");
  }

  let qrQuery = supabase
    .from("qr_codes")
    .select("id,owner_user_id,territory_id,label,slug,code_type,status,payload,created_at")
    .eq("organization_id", context.organizationId)
    .neq("status", "archived")
    .order("created_at", { ascending: false })
    .limit(200);

  const { data: qrRows, error: qrError } = await qrQuery;
  if (qrError) throw qrError;

  const currentUserCanManage = hasManagerAccess(context);
  const allRows = (qrRows ?? []) as QRCodeRow[];
  const ownerIds = [...new Set(allRows.map((row) => row.owner_user_id))];
  const [{ data: ownerMembershipRows, error: ownerMembershipError }] = await Promise.all([
    ownerIds.length
      ? supabase
          .from("organization_members")
          .select("user_id,role")
          .eq("organization_id", context.organizationId)
          .in("user_id", ownerIds)
      : Promise.resolve({ data: [], error: null })
  ]);

  if (ownerMembershipError) throw ownerMembershipError;

  const ownerMembershipMap = new Map(
    ((ownerMembershipRows ?? []) as Array<{ user_id: string; role: string | null }>).map((row) => [
      row.user_id,
      { role: row.role }
    ])
  );
  const rows = currentUserCanManage
    ? allRows
    : allRows.filter((row) => {
        if (row.owner_user_id === context.appUser.id) return true;
        const ownerRole = ownerMembershipMap.get(row.owner_user_id)?.role;
        return isManagerRole(ownerRole);
      });
  const visibleOwnerIds = [...new Set(rows.map((row) => row.owner_user_id))];
  const territoryIds = [...new Set(rows.map((row) => row.territory_id).filter(Boolean))] as string[];
  const codeIds = rows.map((row) => row.id);

  const [
    { data: ownerRows, error: ownerError },
    { data: territoryRows, error: territoryError },
    { data: eventRows, error: eventError }
  ] = await Promise.all([
    visibleOwnerIds.length
      ? supabase.from("app_users").select("id,full_name,email").in("id", visibleOwnerIds)
      : Promise.resolve({ data: [], error: null }),
    territoryIds.length
      ? supabase.from("territories").select("id,name").in("id", territoryIds)
      : Promise.resolve({ data: [], error: null }),
    codeIds.length
      ? supabase.from("qr_code_events").select("qr_code_id,event_type,city,created_at").in("qr_code_id", codeIds)
      : Promise.resolve({ data: [], error: null })
  ]);

  if (ownerError) throw ownerError;
  if (territoryError) throw territoryError;
  if (eventError) throw eventError;

  const ownerMap = new Map(
    ((ownerRows ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map((row) => [
      row.id,
      row
    ])
  );
  const territoryMap = new Map(
    ((territoryRows ?? []) as Array<{ id: string; name: string | null }>).map((row) => [row.id, row])
  );
  const eventsByCode = new Map<string, QRCodeEventRow[]>();
  for (const row of (eventRows ?? []) as QRCodeEventRow[]) {
    const current = eventsByCode.get(row.qr_code_id) ?? [];
    current.push(row);
    eventsByCode.set(row.qr_code_id, current);
  }

  return {
    items: mapQrItems({
      rows,
      ownerMap,
      ownerMembershipMap,
      territoryMap,
      eventsByCode,
      currentUserId: context.appUser.id,
      currentUserCanManage
    })
  };
}

export async function getPublicQrCodeBySlug(slug: string): Promise<PublicQRCodeResponse["item"]> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("qr_codes")
    .select("id,organization_id,label,slug,status,payload,owner_user_id")
    .eq("slug", slug)
    .eq("code_type", "contact_card")
    .eq("status", "active")
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const payload = normalizePayload((data.payload as Record<string, unknown> | null | undefined) ?? null);

  return {
    qrCodeId: data.id as string,
    organizationId: data.organization_id as string,
    label: data.label as string,
    slug: data.slug as string,
    publicUrl: buildQrPublicUrl(data.slug as string),
    publicBookingUrl: buildQrBookingUrl(data.slug as string),
    ownerName: [payload.firstName, payload.lastName].filter(Boolean).join(" ") || null,
    payload
  };
}
