"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarCheck2, ChevronLeft, MapPinHouse } from "lucide-react";
import type { PublicQrAvailabilityResponse, PublicQRCodeResponse } from "@/types/api";

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
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [availability, setAvailability] = useState<PublicQrAvailabilityResponse | null>(null);
  const [availabilityState, setAvailabilityState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string>("");
  const [bookingState, setBookingState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [bookingError, setBookingError] = useState<string | null>(null);

  const selectedTypeConfig = useMemo(
    () => enabledTypes.find((type) => type.id === selectedTypeId) ?? enabledTypes[0] ?? null,
    [enabledTypes, selectedTypeId]
  );

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
      } catch (error) {
        if (cancelled) return;
        setAvailability(null);
        setAvailabilityState("error");
        setAvailabilityError(error instanceof Error ? error.message : "Could not load open times.");
        setSelectedDayKey(null);
        setSelectedSlot("");
      }
    }

    void loadAvailability();
    return () => {
      cancelled = true;
    };
  }, [item.slug, selectedTypeConfig]);

  const selectedDay = useMemo(
    () => availability?.days.find((day) => day.dateKey === selectedDayKey) ?? availability?.days[0] ?? null,
    [availability?.days, selectedDayKey]
  );

  useEffect(() => {
    if (!selectedDay) return;
    if (selectedDay.slots.some((slot) => slot.startAt === selectedSlot)) return;
    setSelectedSlot(selectedDay.slots[0]?.startAt ?? "");
  }, [selectedDay, selectedSlot]);

  async function submitBooking() {
    if (!selectedTypeConfig) return;
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
          lastName: lastName || null,
          phone,
          email: email || null,
          address,
          appointmentAt: selectedSlot,
          bookingTypeId: selectedTypeConfig.id,
          notes: notes || null
        })
      });
      const json = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(json.error || "Could not book that appointment.");
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
              <h1 className="mt-1 text-2xl font-semibold text-slate-950">Choose a type, then pick an open time</h1>
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
                  const active = selectedTypeConfig?.type === type.type;
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

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">First Name</div>
                  <input value={firstName} onChange={(event) => setFirstName(event.target.value)} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-400" />
                </label>
                <label className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Last Name</div>
                  <input value={lastName} onChange={(event) => setLastName(event.target.value)} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-400" />
                </label>
                <label className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Phone</div>
                  <input value={phone} onChange={(event) => setPhone(event.target.value)} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-400" />
                </label>
                <label className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Email</div>
                  <input value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-400" />
                </label>
              </div>

              <label className="mt-4 block space-y-2">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Property Address</div>
                <div className="relative">
                  <MapPinHouse className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={address}
                    onChange={(event) => setAddress(event.target.value)}
                    className="w-full rounded-2xl border border-slate-200 px-11 py-3 text-sm outline-none transition focus:border-slate-400"
                    placeholder="123 Main St, Worcester, MA"
                  />
                </div>
              </label>

              <div className="mt-6 grid gap-4 xl:grid-cols-[220px_1fr]">
                <div className="rounded-[1.6rem] border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Available Days</div>
                  <div className="mt-3 grid gap-2">
                    {availabilityState === "loading" ? (
                      <div className="text-sm text-slate-500">Checking open times...</div>
                    ) : availability?.days.length ? (
                      availability.days.map((day) => (
                        <button
                          key={day.dateKey}
                          type="button"
                          onClick={() => {
                            setSelectedDayKey(day.dateKey);
                            setSelectedSlot(day.slots[0]?.startAt ?? "");
                          }}
                          className={`rounded-[1.2rem] border px-3 py-3 text-left transition ${
                            (selectedDay?.dateKey ?? availability.days[0]?.dateKey) === day.dateKey
                              ? "border-slate-900 bg-slate-900 text-white"
                              : "border-slate-200 bg-white text-slate-800 hover:border-slate-300"
                          }`}
                        >
                          <div className="text-sm font-semibold">{day.dateLabel}</div>
                          <div className={`mt-1 text-xs ${(selectedDay?.dateKey ?? availability.days[0]?.dateKey) === day.dateKey ? "text-white/70" : "text-slate-500"}`}>
                            {day.slots.length} open {day.slots.length === 1 ? "slot" : "slots"}
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="text-sm text-slate-500">No open times are currently available.</div>
                    )}
                  </div>
                </div>

                <div className="rounded-[1.6rem] border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Open Times</div>
                      <div className="mt-1 text-sm text-slate-600">
                        {availability?.timezone ? `Only real openings in ${availability.timezone}` : "Only real open times are shown here."}
                      </div>
                    </div>
                    <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                      {selectedTypeConfig?.label ?? "Choose a type"}
                    </div>
                  </div>

                  {availabilityError ? (
                    <div className="mt-4 rounded-[1.2rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
                      {availabilityError}
                    </div>
                  ) : null}

                  {selectedDay ? (
                    <div className="mt-4">
                      <div className="text-sm font-semibold text-slate-900">{selectedDay.dateLabel}</div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {selectedDay.slots.map((slot) => (
                          <button
                            key={slot.startAt}
                            type="button"
                            onClick={() => setSelectedSlot(slot.startAt)}
                            className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                              selectedSlot === slot.startAt
                                ? "border-slate-900 bg-slate-900 text-white"
                                : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-slate-100"
                            }`}
                          >
                            {slot.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-[1.2rem] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                      Choose an appointment type to see live availability.
                    </div>
                  )}

                  <div className="mt-4 rounded-[1.2rem] border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">What happens next</div>
                    <div className="mt-2 text-sm text-slate-600">
                      Your info creates the lead, assigns it to this rep, and adds the appointment to their Lumino schedule and calendar.
                    </div>
                  </div>
                </div>
              </div>

              <label className="mt-4 block space-y-2">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Notes</div>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  className="min-h-28 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-400"
                  placeholder="Anything helpful for the rep to know before they arrive."
                />
              </label>

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
                    !firstName.trim() ||
                    !phone.trim() ||
                    !address.trim() ||
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
