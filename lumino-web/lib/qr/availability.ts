export type QrAppointmentType = "phone_call" | "in_person_consult";

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

export const QR_APPOINTMENT_TYPE_CONFIG: Record<
  QrAppointmentType,
  { label: string; durationMinutes: number; preBufferMinutes: number; postBufferMinutes: number; slotStepMinutes: number }
> = {
  phone_call: {
    label: "Phone Call",
    durationMinutes: 15,
    preBufferMinutes: 0,
    postBufferMinutes: 0,
    slotStepMinutes: 15
  },
  in_person_consult: {
    label: "In-Person Consult",
    durationMinutes: 60,
    preBufferMinutes: 60,
    postBufferMinutes: 60,
    slotStepMinutes: 30
  }
};

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
