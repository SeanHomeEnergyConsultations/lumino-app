"use client";

import Link from "next/link";
import { CalendarCheck2, ExternalLink, Mail, Phone, Save, Send } from "lucide-react";
import type { PublicQRCodeResponse } from "@/types/api";

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
  const vcard = buildVCard(item);
  const enabledTypes = item.payload.bookingTypes.filter((type) => type.enabled);

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

  return (
    <div
      className="min-h-screen px-4 py-8 text-white"
      style={{
        background: `linear-gradient(160deg, ${item.payload.primaryColor ?? "#10212f"} 0%, #09111a 42%, ${item.payload.accentColor ?? "#1f8ca3"} 100%)`
      }}
    >
      <div className="mx-auto w-full max-w-2xl">
        <section className="w-full rounded-[2rem] border border-white/10 bg-black/20 p-6 shadow-2xl backdrop-blur md:p-8">
          <div className="text-center">
            {item.payload.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.payload.photoUrl}
                alt={[item.payload.firstName, item.payload.lastName].filter(Boolean).join(" ") || "Rep photo"}
                className="mx-auto h-28 w-28 rounded-[2rem] border border-white/10 object-cover shadow-xl"
              />
            ) : (
              <div className="mx-auto flex h-28 w-28 items-center justify-center rounded-[2rem] border border-white/10 bg-white/10 text-3xl font-semibold shadow-xl">
                {initials(item.payload.firstName, item.payload.lastName)}
              </div>
            )}

            {item.payload.logoUrl ? (
              <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/8 px-3 py-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.payload.logoUrl}
                  alt={item.payload.organizationName ?? "Logo"}
                  className="h-6 w-6 rounded-full bg-white object-contain p-1"
                />
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-white/65">
                  {item.payload.organizationName ?? item.payload.appName ?? "Lumino"}
                </span>
              </div>
            ) : (
              <div className="mt-4 text-xs font-semibold uppercase tracking-[0.2em] text-white/55">
                {item.payload.organizationName ?? item.payload.appName ?? "Lumino"}
              </div>
            )}

            <div className="mt-4 text-2xl font-semibold">
              {[item.payload.firstName, item.payload.lastName].filter(Boolean).join(" ") || "Lumino Rep"}
            </div>
            {item.payload.title ? <div className="mt-1 text-sm text-white/70">{item.payload.title}</div> : null}
          </div>

          <div className="mt-6 rounded-[1.6rem] border border-white/10 bg-white/8 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-white/50">Digital Card</div>
            <div className="mt-2 text-sm text-white/75">
              Save this rep, reach out directly, or book a time when it works for you.
            </div>
          </div>

          <div className="mt-6 grid gap-3">
            {item.payload.bookingEnabled && enabledTypes.length ? (
              <Link
                href={`/book/${item.slug}`}
                onClick={() => void trackEvent(item.slug, "book_click")}
                className="flex items-center justify-between rounded-2xl border border-white/20 bg-white px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-white/90"
              >
                <span className="flex items-center gap-3">
                  <CalendarCheck2 className="h-4 w-4" />
                  Set Appointment
                </span>
                <span className="text-slate-500">Pick a time</span>
              </Link>
            ) : null}

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
      </div>
    </div>
  );
}
