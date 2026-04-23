"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarCheck2, ChevronLeft, ChevronRight, MapPinHouse } from "lucide-react";
import type { PublicQrAvailabilityResponse, PublicQRCodeResponse } from "@/types/api";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function startOfDay(value: Date) {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfWeek(value: Date) {
  const next = startOfDay(value);
  next.setDate(next.getDate() - next.getDay());
  return next;
}

function startOfMonthGrid(value: Date) {
  return startOfWeek(new Date(value.getFullYear(), value.getMonth(), 1));
}

function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

function monthKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(value: Date) {
  return value.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric"
  });
}

function availabilityCue(slotCount: number) {
  if (slotCount <= 2) return "Limited";
  if (slotCount <= 6) return "Book Soon";
  return "Available";
}

function splitFullName(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return { firstName: "", lastName: null as string | null };
  }

  const [firstName, ...rest] = trimmed.split(/\s+/);
  return {
    firstName,
    lastName: rest.length ? rest.join(" ") : null
  };
}

async function trackEvent(slug: string, eventType: string) {
  await fetch(`/api/public/qr/${slug}/event`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ eventType }),
    keepalive: true
  }).catch(() => null);
}

export function PublicBookingPage({ item }: { item: NonNullable<PublicQRCodeResponse["item"]> }) {
  const enabledTypes = item.payload.bookingEnabled ? item.payload.bookingTypes.filter((type) => type.enabled) : [];
  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(enabledTypes[0]?.id ?? null);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [availability, setAvailability] = useState<PublicQrAvailabilityResponse | null>(null);
  const [availabilityState, setAvailabilityState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string>("");
  const [selectedMonth, setSelectedMonth] = useState<Date | null>(null);
  const [bookingState, setBookingState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [bookingError, setBookingError] = useState<string | null>(null);

  const selectedTypeConfig = useMemo(
    () => enabledTypes.find((type) => type.id === selectedTypeId) ?? enabledTypes[0] ?? null,
    [enabledTypes, selectedTypeId]
  );
  const isInPerson = selectedTypeConfig?.type === "in_person_consult";

  useEffect(() => {
    if (!enabledTypes.length) return;
    if (selectedTypeId && enabledTypes.some((type) => type.id === selectedTypeId)) return;
    setSelectedTypeId(enabledTypes[0]?.id ?? null);
  }, [enabledTypes, selectedTypeId]);

  useEffect(() => {
    if (!selectedTypeConfig) return;

    let cancelled = false;
    async function loadAvailability() {
      setAvailabilityState("loading");
      setAvailabilityError(null);
      try {
        const response = await fetch(`/api/public/qr/${item.slug}/availability?bookingTypeId=${selectedTypeConfig.id}`);
        const json = (await response.json()) as PublicQrAvailabilityResponse & { error?: string };
        if (!response.ok) {
          throw new Error(json.error || "Could not load open times.");
        }
        if (cancelled) return;

        setAvailability(json);
        setAvailabilityState("ready");
        const firstDay = json.days[0] ?? null;
        setSelectedDayKey(firstDay?.dateKey ?? null);
        setSelectedSlot(firstDay?.slots[0]?.startAt ?? "");
        setSelectedMonth(firstDay ? parseDateKey(firstDay.dateKey) : null);
      } catch (error) {
        if (cancelled) return;
        setAvailability(null);
        setAvailabilityState("error");
        setAvailabilityError(error instanceof Error ? error.message : "Could not load open times.");
        setSelectedDayKey(null);
        setSelectedSlot("");
        setSelectedMonth(null);
      }
    }

    void loadAvailability();
    return () => {
      cancelled = true;
    };
  }, [item.slug, selectedTypeConfig]);

  const availableDayMap = useMemo(
    () => new Map((availability?.days ?? []).map((day) => [day.dateKey, day])),
    [availability?.days]
  );

  const monthOptions = useMemo(() => {
    const seen = new Set<string>();
    return (availability?.days ?? []).flatMap((day) => {
      const date = parseDateKey(day.dateKey);
      const key = monthKey(date);
      if (seen.has(key)) return [];
      seen.add(key);
      return [date];
    });
  }, [availability?.days]);

  useEffect(() => {
    if (!monthOptions.length) return;
    if (selectedMonth && monthOptions.some((month) => monthKey(month) === monthKey(selectedMonth))) return;
    setSelectedMonth(monthOptions[0] ?? null);
  }, [monthOptions, selectedMonth]);

  const selectedDay = useMemo(
    () => (selectedDayKey ? availableDayMap.get(selectedDayKey) : undefined) ?? availability?.days[0] ?? null,
    [availability?.days, availableDayMap, selectedDayKey]
  );

  useEffect(() => {
    if (!selectedDay) return;
    if (selectedDay.slots.some((slot) => slot.startAt === selectedSlot)) return;
    setSelectedSlot(selectedDay.slots[0]?.startAt ?? "");
  }, [selectedDay, selectedSlot]);

  const calendarDays = useMemo(() => {
    if (!selectedMonth) return [];
    const gridStart = startOfMonthGrid(selectedMonth);
    const visibleMonth = selectedMonth.getMonth();
    const selectedKey = selectedDay?.dateKey ?? null;

    return Array.from({ length: 35 }, (_, index) => {
      const date = addDays(gridStart, index);
      const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      const availableDay = availableDayMap.get(dateKey) ?? null;
      return {
        date,
        dateKey,
        isCurrentMonth: date.getMonth() === visibleMonth,
        isSelected: selectedKey === dateKey,
        availableDay
      };
    });
  }, [availableDayMap, selectedDay?.dateKey, selectedMonth]);

  const selectedMonthIndex = useMemo(() => {
    if (!selectedMonth) return -1;
    return monthOptions.findIndex((month) => monthKey(month) === monthKey(selectedMonth));
  }, [monthOptions, selectedMonth]);

  async function submitBooking() {
    if (!selectedTypeConfig) return;
    const { firstName, lastName } = splitFullName(fullName);

    setBookingState("saving");
    setBookingError(null);
    try {
      const response = await fetch(`/api/public/qr/${item.slug}/book`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          firstName,
          lastName,
          phone: phone || null,
          email: email || null,
          address: address || null,
          appointmentAt: selectedSlot,
          bookingTypeId: selectedTypeConfig.id,
          notes: notes || null
        })
      });
      const json = (await response.json()) as {
        error?: string;
        issues?: {
          formErrors?: string[];
          fieldErrors?: Record<string, string[] | undefined>;
        };
      };
      if (!response.ok) {
        const firstFieldIssue = Object.values(json.issues?.fieldErrors ?? {})
          .flat()
          .find(Boolean);
        throw new Error(firstFieldIssue || json.issues?.formErrors?.[0] || json.error || "Could not book that appointment.");
      }
      setBookingState("saved");
      void trackEvent(item.slug, "book_click");
    } catch (error) {
      setBookingState("error");
      setBookingError(error instanceof Error ? error.message : "Could not book that appointment.");
    }
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f7f3ea_0%,#edf2f8_100%)] px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-5xl">
        <div className="mb-5 flex items-center justify-between gap-3">
          <Link
            href={`/connect/${item.slug}`}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to Card
          </Link>
          <div className="text-sm text-slate-500">
            Booking with {[item.payload.firstName, item.payload.lastName].filter(Boolean).join(" ") || item.ownerName || "Lumino Rep"}
          </div>
        </div>

        <section className="rounded-[2rem] border border-slate-200/80 bg-white/90 p-6 shadow-panel backdrop-blur md:p-8">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-slate-950 p-3 text-white">
              <CalendarCheck2 className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Book an Appointment</div>
              <h1 className="mt-1 text-2xl font-semibold text-slate-950">Pick a date, then choose an open time</h1>
            </div>
          </div>

          <p className="mt-4 max-w-3xl text-sm text-slate-600">
            {item.payload.bookingBlurb ??
              "Choose the appointment that fits best, then pick from the times this rep is actually available."}
          </p>

          {enabledTypes.length ? (
            <>
              <div className="mt-6 grid gap-3 md:grid-cols-2">
                {enabledTypes.map((type) => {
                  const active = selectedTypeConfig?.id === type.id;
                  return (
                    <button
                      key={type.id}
                      type="button"
                      onClick={() => setSelectedTypeId(type.id)}
                      className={`rounded-[1.4rem] border px-4 py-4 text-left transition ${
                        active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white hover:border-slate-300"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-lg font-semibold">{type.label}</div>
                          <div className={`mt-1 text-sm ${active ? "text-white/70" : "text-slate-500"}`}>
                            {type.durationMinutes} minutes
                          </div>
                        </div>
                      </div>
                      {type.shortDescription ? (
                        <div className={`mt-3 text-sm ${active ? "text-white/80" : "text-slate-600"}`}>
                          {type.shortDescription}
                        </div>
                      ) : null}
                    </button>
                  );
                })}
              </div>

              {selectedTypeConfig?.fullDescription ? (
                <div className="mt-4 rounded-[1.4rem] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                  {selectedTypeConfig.fullDescription}
                </div>
              ) : null}

              <div className="mt-6 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                <div className="rounded-[1.6rem] border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Choose a Date</div>
                      <div className="mt-1 text-sm text-slate-600">
                        {availability?.timezone ? `Showing open dates in ${availability.timezone}.` : "Only real available dates are clickable."}
                      </div>
                    </div>
                    <div className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                      {selectedTypeConfig?.label ?? "Choose a type"}
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (selectedMonthIndex > 0) {
                          setSelectedMonth(monthOptions[selectedMonthIndex - 1] ?? null);
                        }
                      }}
                      disabled={selectedMonthIndex <= 0}
                      className="rounded-full border border-slate-200 bg-white p-2 text-slate-600 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <div className="text-sm font-semibold text-slate-900">
                      {selectedMonth ? monthLabel(selectedMonth) : "No dates available"}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (selectedMonthIndex >= 0 && selectedMonthIndex < monthOptions.length - 1) {
                          setSelectedMonth(monthOptions[selectedMonthIndex + 1] ?? null);
                        }
                      }}
                      disabled={selectedMonthIndex < 0 || selectedMonthIndex >= monthOptions.length - 1}
                      className="rounded-full border border-slate-200 bg-white p-2 text-slate-600 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="mt-4 grid grid-cols-7 gap-2 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                    {WEEKDAY_LABELS.map((label) => (
                      <div key={label}>{label}</div>
                    ))}
                  </div>

                  <div className="mt-2 grid grid-cols-7 gap-2">
                    {availabilityState === "loading" ? (
                      <div className="col-span-7 rounded-[1.2rem] border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
                        Checking open times...
                      </div>
                    ) : calendarDays.length ? (
                      calendarDays.map((day) => {
                        const isAvailable = Boolean(day.availableDay);
                        return (
                          <button
                            key={day.dateKey}
                            type="button"
                            disabled={!isAvailable}
                            onClick={() => {
                              if (!day.availableDay) return;
                              setSelectedDayKey(day.availableDay.dateKey);
                              setSelectedSlot(day.availableDay.slots[0]?.startAt ?? "");
                            }}
                            className={`min-h-[4.7rem] rounded-[1.2rem] border px-2 py-2 text-left transition ${
                              day.isSelected
                                ? "border-slate-900 bg-slate-900 text-white"
                                : isAvailable
                                  ? "border-slate-200 bg-white text-slate-900 hover:border-slate-300"
                                  : "border-slate-100 bg-slate-100/70 text-slate-300"
                            } ${!day.isCurrentMonth ? "opacity-55" : ""}`}
                          >
                            <div className="text-sm font-semibold">{day.date.getDate()}</div>
                            <div className={`mt-2 text-[11px] ${day.isSelected ? "text-white/70" : isAvailable ? "text-slate-500" : "text-slate-300"}`}>
                              {isAvailable ? availabilityCue(day.availableDay?.slots.length ?? 0) : "Closed"}
                            </div>
                          </button>
                        );
                      })
                    ) : (
                      <div className="col-span-7 rounded-[1.2rem] border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
                        No open dates are currently available.
                      </div>
                    )}
                  </div>

                  {availabilityError ? (
                    <div className="mt-4 rounded-[1.2rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
                      {availabilityError}
                    </div>
                  ) : null}
                </div>

                <div className="rounded-[1.6rem] border border-slate-200 bg-white p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Your Info</div>
                  <div className="mt-2 text-sm text-slate-600">
                    Just add your name and a phone number or email. For home visits, include the property address too.
                  </div>

                  <div className="mt-4 space-y-4">
                    <label className="space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Full Name</div>
                      <input
                        value={fullName}
                        onChange={(event) => setFullName(event.target.value)}
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-400"
                        placeholder="Jane Smith"
                      />
                    </label>

                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="space-y-2">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Phone</div>
                        <input
                          value={phone}
                          onChange={(event) => setPhone(event.target.value)}
                          className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-400"
                          placeholder="(555) 555-5555"
                        />
                      </label>
                      <label className="space-y-2">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Email</div>
                        <input
                          value={email}
                          onChange={(event) => setEmail(event.target.value)}
                          className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-400"
                          placeholder="jane@example.com"
                        />
                      </label>
                    </div>

                    <label className="space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Property Address {isInPerson ? "(Required)" : "(Optional)"}
                      </div>
                      <div className="relative">
                        <MapPinHouse className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <input
                          value={address}
                          onChange={(event) => setAddress(event.target.value)}
                          className="w-full rounded-2xl border border-slate-200 px-11 py-3 text-sm outline-none transition focus:border-slate-400"
                          placeholder={isInPerson ? "123 Main St, Worcester, MA" : "Helpful for home visits, optional for calls"}
                        />
                      </div>
                    </label>

                    <div className="rounded-[1.2rem] border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Open Times</div>
                      {selectedDay ? (
                        <>
                          <div className="mt-2 text-sm font-semibold text-slate-900">{selectedDay.dateLabel}</div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {selectedDay.slots.map((slot) => (
                              <button
                                key={slot.startAt}
                                type="button"
                                onClick={() => setSelectedSlot(slot.startAt)}
                                className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                                  selectedSlot === slot.startAt
                                    ? "border-slate-900 bg-slate-900 text-white"
                                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-100"
                                }`}
                              >
                                {slot.label}
                              </button>
                            ))}
                          </div>
                        </>
                      ) : (
                        <div className="mt-2 text-sm text-slate-600">Select an open date on the calendar to see times.</div>
                      )}
                    </div>

                    <label className="space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Notes</div>
                      <textarea
                        value={notes}
                        onChange={(event) => setNotes(event.target.value)}
                        className="min-h-24 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-400"
                        placeholder="Anything helpful for the rep to know before they arrive."
                      />
                    </label>
                  </div>
                </div>
              </div>

              {bookingState === "saved" ? (
                <div className="mt-6 rounded-[1.6rem] border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-900">
                  You’re booked. The rep now has your lead and appointment in Lumino.
                </div>
              ) : null}

              {bookingError ? (
                <div className="mt-6 rounded-[1.6rem] border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-900">
                  {bookingError}
                </div>
              ) : null}

              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => {
                    void submitBooking();
                  }}
                  disabled={
                    bookingState === "saving" ||
                    availabilityState !== "ready" ||
                    !selectedTypeConfig ||
                    !fullName.trim() ||
                    (!phone.trim() && !email.trim()) ||
                    (isInPerson && !address.trim()) ||
                    !selectedSlot
                  }
                  className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {bookingState === "saving" ? "Booking..." : `Book ${selectedTypeConfig?.label ?? "Appointment"}`}
                </button>
              </div>
            </>
          ) : (
            <div className="mt-6 rounded-[1.4rem] border border-slate-200 bg-white px-4 py-4 text-sm text-slate-600">
              This booking page is not currently offering appointment types.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
