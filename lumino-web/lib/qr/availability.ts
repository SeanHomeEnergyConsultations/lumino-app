export type QrAppointmentType = "phone_call" | "in_person_consult";
export type QrBookingTypeConfig = {
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

export const QR_APPOINTMENT_TYPE_CONFIG: Record<QrAppointmentType, QrBookingTypeConfig> = {
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function defaultSlotStep(durationMinutes: number) {
  if (durationMinutes <= 20) return 15;
  if (durationMinutes <= 45) return 15;
  return 30;
}

export function normalizeQrBookingTypeConfig(
  type: QrAppointmentType,
  value: Partial<QrBookingTypeConfig> | null | undefined
): QrBookingTypeConfig {
  const fallback = QR_APPOINTMENT_TYPE_CONFIG[type];
  const durationMinutes =
    typeof value?.durationMinutes === "number" ? clamp(Math.round(value.durationMinutes), 10, 180) : fallback.durationMinutes;
  const preBufferMinutes =
    typeof value?.preBufferMinutes === "number" ? clamp(Math.round(value.preBufferMinutes), 0, 240) : fallback.preBufferMinutes;
  const postBufferMinutes =
    typeof value?.postBufferMinutes === "number" ? clamp(Math.round(value.postBufferMinutes), 0, 240) : fallback.postBufferMinutes;

  return {
    type,
    enabled: typeof value?.enabled === "boolean" ? value.enabled : fallback.enabled,
    label: typeof value?.label === "string" && value.label.trim() ? value.label.trim() : fallback.label,
    shortDescription:
      typeof value?.shortDescription === "string" && value.shortDescription.trim()
        ? value.shortDescription.trim()
        : fallback.shortDescription,
    fullDescription:
      typeof value?.fullDescription === "string" && value.fullDescription.trim()
        ? value.fullDescription.trim()
        : fallback.fullDescription,
    durationMinutes,
    preBufferMinutes,
    postBufferMinutes,
    slotStepMinutes:
      typeof value?.slotStepMinutes === "number"
        ? clamp(Math.round(value.slotStepMinutes), 10, 60)
        : defaultSlotStep(durationMinutes)
  };
}

export function normalizeQrBookingTypeConfigs(
  value: Partial<Record<QrAppointmentType, Partial<QrBookingTypeConfig>>> | null | undefined
) {
  return (Object.keys(QR_APPOINTMENT_TYPE_CONFIG) as QrAppointmentType[]).map((type) =>
    normalizeQrBookingTypeConfig(type, value?.[type])
  );
}

export function getQrBookingTypeConfig(
  bookingTypes: QrBookingTypeConfig[] | null | undefined,
  type: QrAppointmentType
) {
  return bookingTypes?.find((item) => item.type === type) ?? normalizeQrBookingTypeConfig(type, null);
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

export function formatQrAppointmentTypeLabel(type: QrAppointmentType) {
  return QR_APPOINTMENT_TYPE_CONFIG[type].label;
}
