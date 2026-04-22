import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import { hasManagerAccess } from "@/lib/auth/permissions";
import { getOrganizationBranding } from "@/lib/db/queries/organization";
import { getQrHub } from "@/lib/db/queries/qr";
import { upsertLead } from "@/lib/db/mutations/leads";
import { resolveOrCreateProperty } from "@/lib/db/mutations/properties";
import { getGoogleCalendarBusyWindows } from "@/lib/google-calendar/service";
import {
  DEFAULT_QR_AVAILABILITY_SETTINGS,
  getQrBookingTypeConfig,
  normalizeQrAvailabilitySettings,
  normalizeQrBookingTypeConfigs,
  QR_APPOINTMENT_TYPE_CONFIG,
  type QrAppointmentType
} from "@/lib/qr/availability";
import { getRequestIpAddress, getRequestUserAgent } from "@/lib/security/request-meta";
import { detectBrowser, detectDevice, getRequestGeo } from "@/lib/qr/tracking";
import type { AuthSessionContext } from "@/types/auth";
import type { PublicQrAvailabilityResponse } from "@/types/api";

export const QR_PUBLIC_ASSETS_BUCKET = "qr-public-assets";

function randomSlug(length = 7) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (value) => chars[value % chars.length]).join("");
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

function rangesOverlap(startA: Date, endA: Date, startB: Date, endB: Date) {
  return startA < endB && startB < endA;
}

function getTimeZoneParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });

  const entries = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return {
    year: Number(entries.year),
    month: Number(entries.month),
    day: Number(entries.day),
    hour: Number(entries.hour),
    minute: Number(entries.minute),
    second: Number(entries.second)
  };
}

function zonedTimeToUtc(input: {
  timeZone: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}) {
  const utcGuess = new Date(Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute, 0));
  const zoned = getTimeZoneParts(utcGuess, input.timeZone);
  const zonedAsUtc = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second);
  return new Date(utcGuess.getTime() - (zonedAsUtc - utcGuess.getTime()));
}

function parseClockTime(value: string) {
  const [hour, minute] = value.split(":").map((part) => Number(part));
  return { hour, minute };
}

function weekdayNumberInTimeZone(date: Date, timeZone: string) {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short"
  }).format(date);

  switch (weekday) {
    case "Sun":
      return 0;
    case "Mon":
      return 1;
    case "Tue":
      return 2;
    case "Wed":
      return 3;
    case "Thu":
      return 4;
    case "Fri":
      return 5;
    default:
      return 6;
  }
}

async function getRepBusyRanges(input: {
  organizationId: string;
  ownerUserId: string;
  startAt: Date;
  endAt: Date;
  context: AuthSessionContext;
}) {
  const supabase = createServerSupabaseClient();
  const { data: leadRows, error: leadError } = await supabase
    .from("leads")
    .select("id,appointment_at")
    .eq("organization_id", input.organizationId)
    .not("appointment_at", "is", null)
    .or(`owner_id.eq.${input.ownerUserId},assigned_to.eq.${input.ownerUserId}`)
    .gte("appointment_at", addMinutes(input.startAt, -180).toISOString())
    .lte("appointment_at", addMinutes(input.endAt, 180).toISOString())
    .limit(100);

  if (leadError) throw leadError;

  const leadIds = (leadRows ?? []).map((row) => row.id as string);
  const { data: appointmentRows, error: appointmentError } = leadIds.length
    ? await supabase
        .from("appointments")
        .select("lead_id,appointment_type")
        .in("lead_id", leadIds)
    : { data: [], error: null };

  if (appointmentError) throw appointmentError;

  const appointmentTypeByLeadId = new Map(
    ((appointmentRows ?? []) as Array<{ lead_id: string; appointment_type: string | null }>).map((row) => [
      row.lead_id,
      (row.appointment_type as QrAppointmentType | null) ?? "in_person_consult"
    ])
  );

  const localBusy = ((leadRows ?? []) as Array<{ id: string; appointment_at: string | null }>)
    .filter((row) => row.appointment_at)
    .map((row) => {
      const type = appointmentTypeByLeadId.get(row.id) ?? "in_person_consult";
      const config = QR_APPOINTMENT_TYPE_CONFIG[type];
      const start = new Date(row.appointment_at as string);
      return {
        start: addMinutes(start, -config.preBufferMinutes),
        end: addMinutes(start, config.durationMinutes + config.postBufferMinutes)
      };
    });

  let googleBusy: Array<{ start: Date; end: Date }> = [];
  try {
    const busy = await getGoogleCalendarBusyWindows({
      context: input.context,
      startAt: input.startAt.toISOString(),
      endAt: input.endAt.toISOString()
    });
    googleBusy = busy.map((item) => ({
      start: new Date(item.start),
      end: new Date(item.end)
    }));
  } catch {
    googleBusy = [];
  }

  return [...localBusy, ...googleBusy];
}

export async function getPublicQrAvailability(input: {
  slug: string;
  appointmentType: QrAppointmentType;
}) {
  const supabase = createServerSupabaseClient();
  const { data: qrCode, error } = await supabase
    .from("qr_codes")
    .select("id,organization_id,owner_user_id,payload,status")
    .eq("slug", input.slug)
    .eq("code_type", "contact_card")
    .eq("status", "active")
    .maybeSingle();

  if (error) throw error;
  if (!qrCode) throw new Error("QR code not found.");

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
    memberships: [{ organizationId: qrCode.organization_id as string, role: "rep" }],
    accessBlockedReason: null,
    hasActiveAccess: true,
    isPlatformOwner: false,
    isPlatformSupport: false,
    agreementRequiredVersion: "",
    agreementAcceptedVersion: null,
    agreementAcceptedAt: null,
    hasAcceptedRequiredAgreement: true
  };

  const availability = normalizeQrAvailabilitySettings(
    typeof qrCode.payload?.availability === "object" && qrCode.payload?.availability
      ? (qrCode.payload.availability as Record<string, unknown>)
      : DEFAULT_QR_AVAILABILITY_SETTINGS
  );
  const bookingTypes = normalizeQrBookingTypeConfigs(
    typeof qrCode.payload?.bookingTypes === "object" && qrCode.payload?.bookingTypes
      ? (qrCode.payload.bookingTypes as Record<string, unknown>)
      : null
  );
  const config = getQrBookingTypeConfig(bookingTypes, input.appointmentType);
  if (!config.enabled) {
    throw new Error("This appointment type is not currently available.");
  }
  const now = new Date();
  const windowEnd = addMinutes(now, availability.maxDaysOut * 24 * 60);
  const busyRanges = await getRepBusyRanges({
    organizationId: qrCode.organization_id as string,
    ownerUserId: qrCode.owner_user_id as string,
    startAt: now,
    endAt: windowEnd,
    context: fauxContext
  });

  const days: PublicQrAvailabilityResponse["days"] = [];
  for (let offsetDays = 0; offsetDays < availability.maxDaysOut; offsetDays += 1) {
    const seedDate = addMinutes(now, offsetDays * 24 * 60);
    const parts = getTimeZoneParts(seedDate, availability.timezone);
    const dayStart = zonedTimeToUtc({
      timeZone: availability.timezone,
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: 0,
      minute: 0
    });
    const weekday = weekdayNumberInTimeZone(dayStart, availability.timezone);
    if (!availability.workingDays.includes(weekday)) continue;

    const startClock = parseClockTime(availability.startTime);
    const endClock = parseClockTime(availability.endTime);
    const workStart = zonedTimeToUtc({
      timeZone: availability.timezone,
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: startClock.hour,
      minute: startClock.minute
    });
    const workEnd = zonedTimeToUtc({
      timeZone: availability.timezone,
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: endClock.hour,
      minute: endClock.minute
    });

    const slots: PublicQrAvailabilityResponse["days"][number]["slots"] = [];
    for (
      let slotStart = new Date(workStart);
      slotStart.getTime() + (config.durationMinutes + config.postBufferMinutes) * 60_000 <= workEnd.getTime();
      slotStart = addMinutes(slotStart, config.slotStepMinutes)
    ) {
      if (slotStart.getTime() < addMinutes(now, availability.minNoticeHours * 60).getTime()) continue;
      const eventStart = new Date(slotStart);
      const bufferedStart = addMinutes(eventStart, -config.preBufferMinutes);
      const bufferedEnd = addMinutes(eventStart, config.durationMinutes + config.postBufferMinutes);
      const hasConflict = busyRanges.some((busy) => rangesOverlap(bufferedStart, bufferedEnd, busy.start, busy.end));
      if (hasConflict) continue;

      slots.push({
        startAt: eventStart.toISOString(),
        label: new Intl.DateTimeFormat("en-US", {
          timeZone: availability.timezone,
          hour: "numeric",
          minute: "2-digit"
        }).format(eventStart)
      });
    }

    if (slots.length) {
      days.push({
        dateKey: `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`,
        dateLabel: new Intl.DateTimeFormat("en-US", {
          timeZone: availability.timezone,
          weekday: "short",
          month: "short",
          day: "numeric"
        }).format(dayStart),
        slots
      });
    }
  }

  return {
    timezone: availability.timezone,
    appointmentType: input.appointmentType,
    appointmentTypeLabel: config.label,
    days: days.slice(0, 10)
  };
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

function sanitizeQrAssetName(value: string) {
  const cleaned = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || "photo";
}

export async function createQrPhotoUploadTarget(
  input: {
    fileName: string;
    mimeType: string;
    fileSizeBytes: number;
  },
  context: AuthSessionContext
) {
  if (!context.organizationId) {
    throw new Error("No active organization found for this user.");
  }

  const supabase = createServerSupabaseClient();
  const safeName = sanitizeQrAssetName(input.fileName);
  const path = `${context.organizationId}/${context.appUser.id}/photo-${Date.now()}-${crypto.randomUUID()}-${safeName}`;
  const { data, error } = await supabase.storage.from(QR_PUBLIC_ASSETS_BUCKET).createSignedUploadUrl(path);
  if (error) throw error;

  const { data: publicData } = supabase.storage.from(QR_PUBLIC_ASSETS_BUCKET).getPublicUrl(path);

  return {
    bucket: QR_PUBLIC_ASSETS_BUCKET,
    path,
    token: data.token,
    publicUrl: publicData.publicUrl
  };
}

export async function createQrCode(
  input: {
    codeType?: "contact_card" | "campaign_tracker";
    label: string;
    territoryId?: string | null;
    title?: string | null;
    photoUrl?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    bookingEnabled?: boolean;
    bookingBlurb?: string | null;
    destinationUrl?: string | null;
    description?: string | null;
    availabilityTimezone?: string | null;
    availabilityWorkingDays?: number[] | null;
    availabilityStartTime?: string | null;
    availabilityEndTime?: string | null;
    availabilityMinNoticeHours?: number | null;
    availabilityMaxDaysOut?: number | null;
    bookingTypes?: {
      phone_call: {
        enabled?: boolean;
        label: string;
        shortDescription?: string | null;
        fullDescription?: string | null;
        durationMinutes: number;
        preBufferMinutes: number;
        postBufferMinutes: number;
      };
      in_person_consult: {
        enabled?: boolean;
        label: string;
        shortDescription?: string | null;
        fullDescription?: string | null;
        durationMinutes: number;
        preBufferMinutes: number;
        postBufferMinutes: number;
      };
    } | null;
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
          bookingTypes: normalizeQrBookingTypeConfigs(input.bookingTypes ?? null),
          availability: normalizeQrAvailabilitySettings({
            timezone: input.availabilityTimezone ?? undefined,
            workingDays: input.availabilityWorkingDays ?? undefined,
            startTime: input.availabilityStartTime ?? undefined,
            endTime: input.availabilityEndTime ?? undefined,
            minNoticeHours: input.availabilityMinNoticeHours ?? undefined,
            maxDaysOut: input.availabilityMaxDaysOut ?? undefined
          }),
          firstName,
          lastName: rest.join(" ") || null,
          title: input.title?.trim() || null,
          photoUrl: input.photoUrl?.trim() || null,
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
  appointmentType: QrAppointmentType;
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

  const availability = await getPublicQrAvailability({
    slug: input.slug,
    appointmentType: input.appointmentType
  });
  const isAllowedSlot = availability.days.some((day) =>
    day.slots.some((slot) => slot.startAt === new Date(input.appointmentAt).toISOString())
  );
  if (!isAllowedSlot) {
    throw new Error("That slot is no longer available. Please choose another time.");
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
          `Booked from QR code "${qrCode.label as string}".`,
          `Appointment type: ${getQrBookingTypeConfig(
            normalizeQrBookingTypeConfigs(
              typeof qrCode.payload?.bookingTypes === "object" && qrCode.payload?.bookingTypes
                ? (qrCode.payload.bookingTypes as Record<string, unknown>)
                : null
            ),
            input.appointmentType
          ).label}`
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

  const { data: existingAppointment, error: existingAppointmentError } = await supabase
    .from("appointments")
    .select("id")
    .eq("organization_id", qrCode.organization_id as string)
    .eq("lead_id", lead.leadId)
    .maybeSingle();

  if (existingAppointmentError) throw existingAppointmentError;

  if (existingAppointment?.id) {
    const { error: updateAppointmentError } = await supabase
      .from("appointments")
      .update({
        scheduled_at: input.appointmentAt,
        status: "scheduled",
        appointment_type: input.appointmentType,
        notes: input.notes?.trim() || null,
        assigned_rep_id: qrCode.owner_user_id as string,
        updated_at: new Date().toISOString()
      })
      .eq("id", existingAppointment.id);

    if (updateAppointmentError) throw updateAppointmentError;
  } else {
    const { error: insertAppointmentError } = await supabase.from("appointments").insert({
      organization_id: qrCode.organization_id as string,
      lead_id: lead.leadId,
      assigned_rep_id: qrCode.owner_user_id as string,
      scheduled_at: input.appointmentAt,
      status: "scheduled",
      appointment_type: input.appointmentType,
      notes: input.notes?.trim() || null
    });

    if (insertAppointmentError) throw insertAppointmentError;
  }

  await recordQrEvent({
    qrCodeId: qrCode.id as string,
    organizationId: qrCode.organization_id as string,
    eventType: "appointment_booked",
    request: input.request,
    metadata: {
      leadId: lead.leadId,
      propertyId: lead.propertyId,
      appointmentAt: input.appointmentAt,
      appointmentType: input.appointmentType,
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
      appointment_at: input.appointmentAt,
      appointment_type: input.appointmentType
    }
  });

  return {
    leadId: lead.leadId,
    propertyId: lead.propertyId
  };
}
