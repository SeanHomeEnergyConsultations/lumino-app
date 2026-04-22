"use client";

import { useMemo, useState } from "react";
import { CalendarCheck2, ExternalLink, Mail, MapPinHouse, Phone, QrCode, Save, Send } from "lucide-react";
import type { PublicQRCodeResponse } from "@/types/api";

function initials(firstName: string | null, lastName: string | null) {
  return `${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`.trim().toUpperCase() || "L";
}

function toLocalInputValue(date: Date) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function nextDefaultAppointmentValue() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(15, 0, 0, 0);
  return toLocalInputValue(date);
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
  const [appointmentAt, setAppointmentAt] = useState(nextDefaultAppointmentValue);
  const [notes, setNotes] = useState("");
  const [bookingState, setBookingState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [bookingError, setBookingError] = useState<string | null>(null);
  const vcard = useMemo(() => buildVCard(item), [item]);

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
          appointmentAt: new Date(appointmentAt).toISOString(),
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
              <h1 className="mt-1 text-2xl font-semibold text-slate-950">Pick a time and send your info</h1>
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

          <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_200px]">
            <label className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Appointment Time</div>
              <input
                type="datetime-local"
                min={toLocalInputValue(new Date(Date.now() + 30 * 60_000))}
                value={appointmentAt}
                onChange={(event) => setAppointmentAt(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-400"
              />
            </label>
            <div className="rounded-[1.6rem] border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                <QrCode className="h-3.5 w-3.5" />
                What happens next
              </div>
              <div className="mt-3 text-sm text-slate-600">
                Your info creates the lead, assigns it to this rep, and puts the appointment into Lumino right away.
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
                !firstName.trim() ||
                !phone.trim() ||
                !address.trim() ||
                !appointmentAt
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
