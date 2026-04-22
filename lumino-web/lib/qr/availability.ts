export type QrAppointmentType = "phone_call" | "in_person_consult";

export type QrBookingTypeConfig = {
  id: string;
  type: QrAppointmentType;
  enabled: boolean;
  label: string;
  shortDescription: string | null;
  fullDescription: string | null;
  durationMinutes: number;
  preBufferMinutes: number;
  postBufferMinutes: number;
  slotStepMinutes: number;
};

export type QrAvailabilitySettings = {
  timezone: string;
  workingDays: number[];
  startTime: string;
  endTime: string;
  minNoticeHours: number;
  maxDaysOut: number;
};

export const DEFAULT_QR_AVAILABILITY_SETTINGS: QrAvailabilitySettings = {
  timezone: "America/New_York",
  workingDays: [1, 2, 3, 4, 5],
  startTime: "09:00",
  endTime: "18:00",
  minNoticeHours: 2,
  maxDaysOut: 14
};

const DEFAULT_QR_BOOKING_TYPE_TEMPLATES: Record<QrAppointmentType, Omit<QrBookingTypeConfig, "id">> = {
  phone_call: {
    type: "phone_call",
    enabled: true,
    label: "Phone Call",
    shortDescription: "Quick conversation to answer questions and see if it makes sense to keep talking.",
    fullDescription:
      "A short call to answer initial questions, talk through the home, and decide whether an in-person visit makes sense.",
    durationMinutes: 15,
    preBufferMinutes: 0,
    postBufferMinutes: 0,
    slotStepMinutes: 15
  },
  in_person_consult: {
    type: "in_person_consult",
    enabled: true,
    label: "In-Person Consult",
    shortDescription: "A full visit to walk through the property, needs, and next steps.",
    fullDescription:
      "A longer visit at the home to review the property, talk through goals, answer questions, and map out next steps.",
    durationMinutes: 60,
    preBufferMinutes: 60,
    postBufferMinutes: 60,
    slotStepMinutes: 30
  }
};

const DEFAULT_QR_BOOKING_TYPES: QrBookingTypeConfig[] = [
  {
    id: "phone-call",
    ...DEFAULT_QR_BOOKING_TYPE_TEMPLATES.phone_call
  },
  {
    id: "in-person-consult",
    ...DEFAULT_QR_BOOKING_TYPE_TEMPLATES.in_person_consult
  }
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function defaultSlotStep(durationMinutes: number) {
  if (durationMinutes <= 45) return 15;
  return 30;
}

function slugify(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return slug || "appointment";
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 8);
}

export function createQrBookingType(type: QrAppointmentType, overrides?: Partial<QrBookingTypeConfig>): QrBookingTypeConfig {
  const fallback = DEFAULT_QR_BOOKING_TYPE_TEMPLATES[type];
  const label =
    typeof overrides?.label === "string" && overrides.label.trim() ? overrides.label.trim() : fallback.label;
  const durationMinutes =
    typeof overrides?.durationMinutes === "number"
      ? clamp(Math.round(overrides.durationMinutes), 10, 180)
      : fallback.durationMinutes;

  return {
    id:
      typeof overrides?.id === "string" && overrides.id.trim()
        ? overrides.id.trim()
        : `${slugify(label)}-${randomSuffix()}`,
    type,
    enabled: typeof overrides?.enabled === "boolean" ? overrides.enabled : fallback.enabled,
    label,
    shortDescription:
      typeof overrides?.shortDescription === "string" && overrides.shortDescription.trim()
        ? overrides.shortDescription.trim()
        : fallback.shortDescription,
    fullDescription:
      typeof overrides?.fullDescription === "string" && overrides.fullDescription.trim()
        ? overrides.fullDescription.trim()
        : fallback.fullDescription,
    durationMinutes,
    preBufferMinutes:
      typeof overrides?.preBufferMinutes === "number"
        ? clamp(Math.round(overrides.preBufferMinutes), 0, 240)
        : fallback.preBufferMinutes,
    postBufferMinutes:
      typeof overrides?.postBufferMinutes === "number"
        ? clamp(Math.round(overrides.postBufferMinutes), 0, 240)
        : fallback.postBufferMinutes,
    slotStepMinutes:
      typeof overrides?.slotStepMinutes === "number"
        ? clamp(Math.round(overrides.slotStepMinutes), 10, 60)
        : defaultSlotStep(durationMinutes)
  };
}

type LegacyBookingTypeObject = Partial<Record<QrAppointmentType, Partial<QrBookingTypeConfig>>>;

function normalizeFromArray(value: unknown): QrBookingTypeConfig[] {
  if (!Array.isArray(value)) return [];

  const normalized = value
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const candidate = item as Partial<QrBookingTypeConfig> & { type?: string | null };
      const type = candidate.type === "phone_call" || candidate.type === "in_person_consult" ? candidate.type : null;
      if (!type) return null;
      return createQrBookingType(type, {
        ...candidate,
        id:
          typeof candidate.id === "string" && candidate.id.trim()
            ? candidate.id.trim()
            : `${slugify(candidate.label ?? `${type}-${index + 1}`)}-${randomSuffix()}`
      });
    })
    .filter((item): item is QrBookingTypeConfig => Boolean(item));

  const seen = new Set<string>();
  return normalized.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function normalizeFromLegacyObject(value: LegacyBookingTypeObject | null | undefined): QrBookingTypeConfig[] {
  if (!value || typeof value !== "object") {
    return DEFAULT_QR_BOOKING_TYPES.map((item) => ({ ...item }));
  }

  return (Object.keys(DEFAULT_QR_BOOKING_TYPE_TEMPLATES) as QrAppointmentType[]).map((type) =>
    createQrBookingType(type, {
      ...value[type],
      id: type === "phone_call" ? "phone-call" : "in-person-consult"
    })
  );
}

export function normalizeQrBookingTypeConfigs(
  value: unknown
): QrBookingTypeConfig[] {
  const fromArray = normalizeFromArray(value);
  if (fromArray.length) return fromArray;

  return normalizeFromLegacyObject(value as LegacyBookingTypeObject | null | undefined);
}

export function getQrBookingTypeConfig(
  bookingTypes: QrBookingTypeConfig[] | null | undefined,
  bookingTypeId: string
) {
  const normalized = bookingTypes ?? normalizeQrBookingTypeConfigs(null);
  return normalized.find((item) => item.id === bookingTypeId) ?? null;
}

export function getEnabledQrBookingTypes(bookingTypes: QrBookingTypeConfig[] | null | undefined) {
  return (bookingTypes ?? normalizeQrBookingTypeConfigs(null)).filter((item) => item.enabled);
}

export function normalizeQrAvailabilitySettings(
  value: Partial<QrAvailabilitySettings> | null | undefined
): QrAvailabilitySettings {
  return {
    timezone: value?.timezone?.trim() || DEFAULT_QR_AVAILABILITY_SETTINGS.timezone,
    workingDays:
      Array.isArray(value?.workingDays) && value.workingDays.length
        ? value.workingDays.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6)
        : DEFAULT_QR_AVAILABILITY_SETTINGS.workingDays,
    startTime:
      typeof value?.startTime === "string" && /^\d{2}:\d{2}$/.test(value.startTime)
        ? value.startTime
        : DEFAULT_QR_AVAILABILITY_SETTINGS.startTime,
    endTime:
      typeof value?.endTime === "string" && /^\d{2}:\d{2}$/.test(value.endTime)
        ? value.endTime
        : DEFAULT_QR_AVAILABILITY_SETTINGS.endTime,
    minNoticeHours:
      typeof value?.minNoticeHours === "number" && value.minNoticeHours >= 0 && value.minNoticeHours <= 72
        ? value.minNoticeHours
        : DEFAULT_QR_AVAILABILITY_SETTINGS.minNoticeHours,
    maxDaysOut:
      typeof value?.maxDaysOut === "number" && value.maxDaysOut >= 1 && value.maxDaysOut <= 60
        ? value.maxDaysOut
        : DEFAULT_QR_AVAILABILITY_SETTINGS.maxDaysOut
  };
}
