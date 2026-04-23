const defaultDateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short"
});

export function formatDateTime(
  value: string | Date | null | undefined,
  fallback: string | null = "Unknown"
) {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return defaultDateTimeFormatter.format(date);
}
