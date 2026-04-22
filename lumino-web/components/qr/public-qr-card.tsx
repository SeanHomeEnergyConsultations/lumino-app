"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarCheck2, ExternalLink, Mail, MapPinHouse, Phone, Save, Send } from "lucide-react";
import type { PublicQrAvailabilityResponse, PublicQRCodeResponse, QRAppointmentType } from "@/types/api";

const APPOINTMENT_TYPES: Array<{ value: QRAppointmentType; label: string; detail: string }> = [
  {
    value: "phone_call",
    label: "Phone Call",
    detail: "15 minutes"
  },
  {
    value: "in_person_consult",
    label: "In-Person Consult",
    detail: "60 minutes with travel buffer"
  }
];

function initials(firstName: string | null, lastName: string | null) {
  return `${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`.trim().toUpperCase() || "L";
}

function buildVCard(input: PublicQRCodeResponse["item"]) {
  if (!input) return "";
  const { payload } = input;
  return [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${[payload.firstName, payload.lastName].filter(Boolean).join(" ")}`,
    `N:${payload.lastName ?? ""};${payload.firstName ?? ""};;;`,
    payload.organizationName ? `ORG:${payload.organizationName}` : "",
    payload.title ? `TITLE:${payload.title}` : "",
    payload.phone ? `TEL;TYPE=CELL:${payload.phone}` : "",
    payload.email ? `EMAIL:${payload.email}` : "",
    payload.website ? `URL:${payload.website}` : "",
    "END:VCARD"
  ]
    .filter(Boolean)
    .join("\r\n");
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

export function PublicQrCard({ item }: { item: NonNullable<PublicQRCodeResponse["item"]> }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [appointmentType, setAppointmentType] = useState<QRAppointmentType>("in_person_consult");
  const [availability, setAvailability] = useState<PublicQrAvailabilityResponse | null>(null);
  const [availabilityState, setAvailabilityState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string>("");
  const [bookingState, setBookingState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [bookingError, setBookingError] = useState<string | null>(null);
  const vcard = useMemo(() => buildVCard(item), [item]);

  useEffect(() => {
    if (!item.payload.bookingEnabled) return;

    let cancelled = false;

    async function loadAvailability() {
      setAvailabilityState("loading");
      setAvailabilityError(null);
      try {
        const response = await fetch(`/api/public/qr/${item.slug}/availability?appointmentType=${appointmentType}`);
        const json = (await response.json()) as PublicQrAvailabilityResponse & { error?: string };
        if (!response.ok) {
          throw new Error(json.error || "Could not load open times.");
        }
        if (cancelled) return;

        setAvailability(json);
        setAvailabilityState("ready");

        const firstDay = json.days[0] ?? null;
        const nextDayKey = firstDay?.dateKey ?? null;
        setSelectedDayKey((current) => {
          if (current && json.days.some((day) => day.dateKey === current)) return current;
          return nextDayKey;
        });
        setSelectedSlot((current) => {
          const allSlots = json.days.flatMap((day) => day.slots.map((slot) => slot.startAt));
          if (current && allSlots.includes(current)) return current;
          return firstDay?.slots[0]?.startAt ?? "";
        });
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
  }, [appointmentType, item.payload.bookingEnabled, item.slug]);

  const selectedDay = useMemo(
    () => availability?.days.find((day) => day.dateKey === selectedDayKey) ?? availability?.days[0] ?? null,
    [availability?.days, selectedDayKey]
  );

  useEffect(() => {
    if (!selectedDay) return;
    if (selectedDay.slots.some((slot) => slot.startAt === selectedSlot)) return;
    setSelectedSlot(selectedDay.slots[0]?.startAt ?? "");
  }, [selectedDay, selectedSlot]);

  const saveContact = () => {
    const blob = new Blob([vcard], { type: "text/vcard" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${[item.payload.firstName, item.payload.lastName].filter(Boolean).join("-") || "lumino-contact"}.vcf`;
    link.click();
    URL.revokeObjectURL(url);
    void trackEvent(item.slug, "save_contact");
  };

  const submitBooking = async () => {
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
          appointmentType,
          notes: notes || null
        })
      });

      const json = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(json.error || "Could not book that appointment.");
      }

      setBookingState("saved");
    } catch (error) {
      setBookingState("error");
      setBookingError(error instanceof Error ? error.message : "Could not book that appointment.");
    }
  };

  return (
    <div
      className="min-h-screen px-4 py-8 text-white"
      style={{
        background: `linear-gradient(160deg, ${item.payload.primaryColor ?? "#10212f"} 0%, #09111a 42%, ${item.payload.accentColor ?? "#1f8ca3"} 100%)`
      }}
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 lg:flex-row">
        <section className="w-full rounded-[2rem] border border-white/10 bg-black/20 p-6 shadow-2xl backdrop-blur md:p-8 lg:max-w-md">
          <div className="flex items-center gap-3">
            {item.payload.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.payload.logoUrl} alt={item.payload.organizationName ?? "Logo"} className="h-12 w-12 rounded-2xl bg-white object-contain p-2" />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 text-sm font-semibold">
                {initials(item.payload.firstName, item.payload.lastName)}
              </div>
            )}
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-white/55">
                {item.payload.organizationName ?? item.payload.appName ?? "Lumino"}
              </div>
              <div className="mt-1 text-2xl font-semibold">
                {[item.payload.firstName, item.payload.lastName].filter(Boolean).join(" ") || "Lumino Rep"}
              </div>
              {item.payload.title ? <div className="text-sm text-white/70">{item.payload.title}</div> : null}
            </div>
          </div>

          <div className="mt-6 rounded-[1.6rem] border border-white/10 bg-white/8 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-white/50">Digital Card</div>
            <div className="mt-2 text-sm text-white/75">
              Scan, save this contact, or book straight into the rep’s calendar.
            </div>
          </div>

          <div className="mt-6 grid gap-3">
            {item.payload.phone ? (
              <a
                href={`tel:${item.payload.phone}`}
                onClick={() => void trackEvent(item.slug, "call_click")}
                className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/8 px-4 py-3 text-sm text-white/90 transition hover:bg-white/14"
              >
                <span className="flex items-center gap-3">
                  <Phone className="h-4 w-4" />
                  Call
                </span>
                <span className="text-white/55">{item.payload.phone}</span>
              </a>
            ) : null}

            {item.payload.phone ? (
              <a
                href={`sms:${item.payload.phone}`}
                onClick={() => void trackEvent(item.slug, "text_click")}
                className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/8 px-4 py-3 text-sm text-white/90 transition hover:bg-white/14"
              >
                <span className="flex items-center gap-3">
                  <Send className="h-4 w-4" />
                  Text
                </span>
                <span className="text-white/55">Start a message</span>
              </a>
            ) : null}

            {item.payload.email ? (
              <a
                href={`mailto:${item.payload.email}`}
                onClick={() => void trackEvent(item.slug, "email_click")}
                className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/8 px-4 py-3 text-sm text-white/90 transition hover:bg-white/14"
              >
                <span className="flex items-center gap-3">
                  <Mail className="h-4 w-4" />
                  Email
                </span>
                <span className="text-white/55">{item.payload.email}</span>
              </a>
            ) : null}

            {item.payload.website ? (
              <a
                href={item.payload.website}
                target="_blank"
                rel="noreferrer"
                onClick={() => void trackEvent(item.slug, "website_click")}
                className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/8 px-4 py-3 text-sm text-white/90 transition hover:bg-white/14"
              >
                <span className="flex items-center gap-3">
                  <ExternalLink className="h-4 w-4" />
                  Website
                </span>
                <span className="text-white/55">Open</span>
              </a>
            ) : null}

            <button
              type="button"
              onClick={saveContact}
              className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/8 px-4 py-3 text-left text-sm text-white/90 transition hover:bg-white/14"
            >
              <span className="flex items-center gap-3">
                <Save className="h-4 w-4" />
                Save contact
              </span>
              <span className="text-white/55">VCF</span>
            </button>
          </div>
        </section>

        <section className="flex-1 rounded-[2rem] border border-white/10 bg-white/95 p-6 text-slate-900 shadow-2xl md:p-8">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-slate-900 p-3 text-white">
              <CalendarCheck2 className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Book an Appointment</div>
              <h1 className="mt-1 text-2xl font-semibold text-slate-950">Choose a real open slot</h1>
            </div>
          </div>

          <p className="mt-4 max-w-2xl text-sm text-slate-600">
            {item.payload.bookingEnabled
              ? item.payload.bookingBlurb ?? "Enter your information and this will create a lead and appointment for the rep whose code you scanned."
              : "This card is live for contact and follow-up, but direct booking is turned off right now."}
          </p>

          {item.payload.bookingEnabled ? (
            <>
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

              <div className="mt-6 rounded-[1.6rem] border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Appointment Type</div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {APPOINTMENT_TYPES.map((type) => (
                    <button
                      key={type.value}
                      type="button"
                      onClick={() => setAppointmentType(type.value)}
                      className={`rounded-[1.4rem] border px-4 py-4 text-left transition ${
                        appointmentType === type.value
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-200 bg-white text-slate-800 hover:border-slate-300"
                      }`}
                    >
                      <div className="text-sm font-semibold">{type.label}</div>
                      <div className={`mt-1 text-xs ${appointmentType === type.value ? "text-white/70" : "text-slate-500"}`}>{type.detail}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4 grid gap-4 xl:grid-cols-[220px_1fr]">
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
                      {availability?.appointmentTypeLabel ?? "Checking..."}
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
                    void trackEvent(item.slug, "book_click");
                    void submitBooking();
                  }}
                  disabled={
                    bookingState === "saving" ||
                    availabilityState !== "ready" ||
                    !firstName.trim() ||
                    !phone.trim() ||
                    !address.trim() ||
                    !selectedSlot
                  }
                  className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {bookingState === "saving" ? "Booking..." : "Book Appointment"}
                </button>
                {item.payload.phone ? (
                  <a
                    href={`tel:${item.payload.phone}`}
                    onClick={() => void trackEvent(item.slug, "call_click")}
                    className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    Call Instead
                  </a>
                ) : null}
              </div>
            </>
          ) : (
            <div className="mt-6 rounded-[1.6rem] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
              Use the contact buttons on the left to call, text, email, or save the rep’s card.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
