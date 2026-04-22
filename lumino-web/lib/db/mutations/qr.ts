import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import { hasManagerAccess } from "@/lib/auth/permissions";
import { getOrganizationBranding } from "@/lib/db/queries/organization";
import { getQrHub } from "@/lib/db/queries/qr";
import { upsertLead } from "@/lib/db/mutations/leads";
import { resolveOrCreateProperty } from "@/lib/db/mutations/properties";
import { getRequestIpAddress, getRequestUserAgent } from "@/lib/security/request-meta";
import { detectBrowser, detectDevice, getRequestGeo } from "@/lib/qr/tracking";
import type { AuthSessionContext } from "@/types/auth";

function randomSlug(length = 7) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (value) => chars[value % chars.length]).join("");
}

async function generateUniqueSlug() {
  const supabase = createServerSupabaseClient();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = randomSlug(7);
    const { data, error } = await supabase.from("qr_codes").select("id").eq("slug", slug).maybeSingle();
    if (error) throw error;
    if (!data) return slug;
  }

  throw new Error("Could not create a unique QR code slug.");
}

export async function createQrCode(
  input: {
    codeType?: "contact_card" | "campaign_tracker";
    label: string;
    territoryId?: string | null;
    title?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    bookingEnabled?: boolean;
    bookingBlurb?: string | null;
    destinationUrl?: string | null;
    description?: string | null;
  },
  context: AuthSessionContext
) {
  const supabase = createServerSupabaseClient();
  if (!context.organizationId) {
    throw new Error("No active organization found for this user.");
  }

  const slug = await generateUniqueSlug();
  const branding = await getOrganizationBranding(context);
  const codeType = input.codeType ?? "contact_card";

  if (codeType === "campaign_tracker" && !hasManagerAccess(context)) {
    throw new Error("Only managers can create campaign trackers.");
  }

  const fullName = context.appUser.fullName?.trim() || "Lumino Rep";
  const [firstName, ...rest] = fullName.split(" ");

  const payload =
    codeType === "campaign_tracker"
      ? {
          destinationUrl: input.destinationUrl?.trim() || "",
          description: input.description?.trim() || null
        }
      : {
          firstName,
          lastName: rest.join(" ") || null,
          title: input.title?.trim() || null,
          phone: input.phone?.trim() || null,
          email: input.email?.trim() || context.appUser.email || null,
          website: input.website?.trim() || null,
          bookingEnabled: input.bookingEnabled !== false,
          bookingBlurb:
            input.bookingBlurb?.trim() || "Pick a time that works for you and I’ll get it on my calendar.",
          organizationName: branding.appName,
          appName: branding.appName,
          logoUrl: branding.logoUrl,
          primaryColor: branding.primaryColor,
          accentColor: branding.accentColor
        };

  const { data, error } = await supabase
    .from("qr_codes")
    .insert({
      organization_id: context.organizationId,
      owner_user_id: context.appUser.id,
      territory_id: input.territoryId ?? null,
      label: input.label.trim(),
      slug,
      code_type: codeType,
      status: "active",
      payload
    })
    .select("id")
    .single();

  if (error) throw error;

  await supabase.from("activities").insert({
    organization_id: context.organizationId,
    entity_type: "user",
    entity_id: context.appUser.id,
    actor_user_id: context.appUser.id,
    type: "qr_code_created",
    data: {
      qr_code_id: data.id,
      label: input.label.trim(),
      territory_id: input.territoryId ?? null
    }
  });

  const hub = await getQrHub(context);
  const item = hub.items.find((entry) => entry.qrCodeId === data.id);
  if (!item) {
    throw new Error("QR code was created but could not be loaded.");
  }

  return { item };
}

export async function recordQrEvent(input: {
  qrCodeId: string;
  organizationId: string;
  eventType:
    | "scan"
    | "call_click"
    | "text_click"
    | "email_click"
    | "website_click"
    | "book_click"
    | "save_contact"
    | "appointment_booked";
  request: Request;
  metadata?: Record<string, unknown>;
}) {
  const supabase = createServerSupabaseClient();
  const userAgent = getRequestUserAgent(input.request);
  const geo = getRequestGeo(input.request);

  const { error } = await supabase.from("qr_code_events").insert({
    organization_id: input.organizationId,
    qr_code_id: input.qrCodeId,
    event_type: input.eventType,
    ip_address: getRequestIpAddress(input.request),
    user_agent: userAgent,
    device: detectDevice(userAgent),
    browser: detectBrowser(userAgent),
    country: geo.country,
    region: geo.region,
    city: geo.city,
    postal_code: geo.postalCode,
    metadata: input.metadata ?? {}
  });

  if (error) throw error;
}

export async function bookAppointmentFromQr(input: {
  slug: string;
  firstName: string;
  lastName?: string | null;
  phone: string;
  email?: string | null;
  address: string;
  appointmentAt: string;
  notes?: string | null;
  request: Request;
}) {
  const supabase = createServerSupabaseClient();
  const { data: qrCode, error: qrError } = await supabase
    .from("qr_codes")
    .select("id,organization_id,owner_user_id,territory_id,label,status,payload")
    .eq("slug", input.slug)
    .eq("status", "active")
    .maybeSingle();

  if (qrError) throw qrError;
  if (!qrCode) {
    throw new Error("QR code not found.");
  }
  if (qrCode.payload && qrCode.payload.bookingEnabled === false) {
    throw new Error("This QR card is not accepting bookings right now.");
  }

  const fauxContext: AuthSessionContext = {
    authUserId: `qr:${qrCode.owner_user_id as string}`,
    accessToken: "qr-public-booking",
    appUser: {
      id: qrCode.owner_user_id as string,
      email: null,
      fullName: null,
      defaultOrganizationId: qrCode.organization_id as string,
      role: "rep",
      platformRole: null,
      isActive: true
    },
    organizationId: qrCode.organization_id as string,
    organizationStatus: "active",
    featureAccess: null,
    memberships: [
      {
        organizationId: qrCode.organization_id as string,
        role: "rep"
      }
    ],
    accessBlockedReason: null,
    hasActiveAccess: true,
    isPlatformOwner: false,
    isPlatformSupport: false,
    agreementRequiredVersion: "",
    agreementAcceptedVersion: null,
    agreementAcceptedAt: null,
    hasAcceptedRequiredAgreement: true
  };

  const property = await resolveOrCreateProperty(
    {
      address: input.address,
      persist: true
    },
    fauxContext
  );

  const lead = await upsertLead(
    {
      propertyId: property.propertyId as string,
      firstName: input.firstName,
      lastName: input.lastName ?? undefined,
      phone: input.phone,
      email: input.email ?? undefined,
      notes:
        [
          input.notes?.trim(),
          `Booked from QR code "${qrCode.label as string}".`
        ]
          .filter(Boolean)
          .join("\n\n") || undefined,
      leadStatus: "Appointment Set",
      interestLevel: "high",
      appointmentAt: input.appointmentAt,
      preferredChannel: "text",
      textConsent: true,
      cadenceTrack: "appointment_active"
    },
    fauxContext
  );

  await recordQrEvent({
    qrCodeId: qrCode.id as string,
    organizationId: qrCode.organization_id as string,
    eventType: "appointment_booked",
    request: input.request,
    metadata: {
      leadId: lead.leadId,
      propertyId: lead.propertyId,
      appointmentAt: input.appointmentAt,
      territoryId: (qrCode.territory_id as string | null) ?? null
    }
  });

  await supabase.from("activities").insert({
    organization_id: qrCode.organization_id as string,
    entity_type: "lead",
    entity_id: lead.leadId,
    actor_user_id: qrCode.owner_user_id as string,
    type: "qr_appointment_booked",
    data: {
      qr_code_id: qrCode.id,
      qr_label: qrCode.label,
      appointment_at: input.appointmentAt
    }
  });

  return {
    leadId: lead.leadId,
    propertyId: lead.propertyId
  };
}
