"use client";

import { Copy, ExternalLink, MapPinned, Phone, Save, Sparkles, Trash2 } from "lucide-react";
import { qrImageUrl } from "@/components/qr/qr-workspace-context";
import type { QRCodeListItem } from "@/types/api";

export function QrCodeCard({
  item,
  archiving,
  onArchive,
  engagementExpanded,
  onToggleEngagement
}: {
  item: QRCodeListItem;
  archiving: boolean;
  onArchive: () => void;
  engagementExpanded: boolean;
  onToggleEngagement: () => void;
}) {
  const copyUrl = async () => {
    await navigator.clipboard.writeText(item.publicUrl).catch(() => null);
  };
  const copyBookingUrl = async () => {
    await navigator.clipboard.writeText(item.publicBookingUrl).catch(() => null);
  };
  const isContactCard = item.codeType === "contact_card";
  const engagementTotal =
    item.stats.calls +
    item.stats.texts +
    item.stats.emails +
    item.stats.websiteClicks +
    item.stats.appointmentsBooked;

  return (
    <article className="app-panel rounded-[2rem] border p-5">
      <div className="grid gap-5 lg:grid-cols-[200px_1fr]">
        <div className="rounded-[1.8rem] border border-[rgba(var(--app-primary-rgb),0.08)] bg-white p-4 shadow-panel">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrImageUrl(item.publicUrl, isContactCard && "logoUrl" in item.payload ? item.payload.logoUrl : null)}
            alt={`${item.label} QR code`}
            width={160}
            height={160}
            className="mx-auto h-40 w-40 rounded-xl"
          />
          <div className="mt-4 text-center text-xs font-semibold uppercase tracking-[0.16em] text-[rgba(var(--app-primary-rgb),0.58)]">
            {item.status}
          </div>
        </div>

        <div>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">
                {isContactCard ? "Contact card" : "Campaign tracker"}
                {item.territoryName ? ` · ${item.territoryName}` : ""}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <div className="text-2xl font-semibold text-ink">{item.label}</div>
                {item.isShared ? (
                  <span className="rounded-full border border-[rgba(var(--app-primary-rgb),0.08)] bg-[rgba(var(--app-surface-rgb),0.55)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[rgba(var(--app-primary-rgb),0.7)]">
                    Team Code
                  </span>
                ) : null}
              </div>
              <div className="mt-2 text-sm text-[rgba(var(--app-primary-rgb),0.68)]">
                {item.ownerName ?? "Rep"}
                {isContactCard && "title" in item.payload && item.payload.title ? ` · ${item.payload.title}` : ""}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void copyUrl()}
                className="inline-flex items-center gap-2 rounded-2xl border border-[rgba(var(--app-primary-rgb),0.08)] px-3 py-2 text-sm text-ink transition hover:bg-[rgba(var(--app-surface-rgb),0.48)]"
              >
                <Copy className="h-4 w-4" />
                Copy Link
              </button>
              {isContactCard ? (
                <button
                  type="button"
                  onClick={() => void copyBookingUrl()}
                  className="inline-flex items-center gap-2 rounded-2xl border border-[rgba(var(--app-primary-rgb),0.08)] px-3 py-2 text-sm text-ink transition hover:bg-[rgba(var(--app-surface-rgb),0.48)]"
                >
                  <Copy className="h-4 w-4" />
                  Copy Booking Link
                </button>
              ) : null}
              <a
                href={item.publicUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-2xl border border-[rgba(var(--app-primary-rgb),0.08)] px-3 py-2 text-sm text-ink transition hover:bg-[rgba(var(--app-surface-rgb),0.48)]"
              >
                <ExternalLink className="h-4 w-4" />
                Open
              </a>
              {isContactCard ? (
                <a
                  href={item.publicBookingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-2xl border border-[rgba(var(--app-primary-rgb),0.08)] px-3 py-2 text-sm text-ink transition hover:bg-[rgba(var(--app-surface-rgb),0.48)]"
                >
                  <ExternalLink className="h-4 w-4" />
                  Open Booking Page
                </a>
              ) : null}
              {item.canDelete ? (
                <button
                  type="button"
                  onClick={onArchive}
                  disabled={archiving}
                  className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 px-3 py-2 text-sm text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                  {archiving ? "Archiving..." : "Archive"}
                </button>
              ) : null}
            </div>
          </div>

          <div className="mt-4 rounded-[1.4rem] border border-[rgba(var(--app-primary-rgb),0.08)] bg-[rgba(var(--app-surface-rgb),0.52)] px-4 py-3 text-sm text-[rgba(var(--app-primary-rgb),0.72)]">
            {item.publicUrl}
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-4">
            {[
              { label: "Scans", value: item.stats.scans },
              { label: "Booked", value: item.stats.appointmentsBooked },
              { label: "Saved", value: item.stats.saveContacts },
              { label: "Engaged", value: engagementTotal }
            ].map((stat) => (
              <button
                key={stat.label}
                type="button"
                onClick={stat.label === "Engaged" ? onToggleEngagement : undefined}
                className={`rounded-[1.4rem] border border-[rgba(var(--app-primary-rgb),0.08)] bg-white/80 px-4 py-3 text-left ${
                  stat.label === "Engaged" ? "transition hover:bg-[rgba(var(--app-surface-rgb),0.55)]" : ""
                }`}
              >
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-mist">{stat.label}</div>
                <div className="mt-2 text-2xl font-semibold text-ink">{stat.value}</div>
              </button>
            ))}
          </div>

          {engagementExpanded ? (
            <div className="mt-3 grid gap-3 md:grid-cols-5">
              {[
                { label: "Calls", value: item.stats.calls },
                { label: "Texts", value: item.stats.texts },
                { label: "Emails", value: item.stats.emails },
                { label: "Website", value: item.stats.websiteClicks },
                { label: "Booked", value: item.stats.appointmentsBooked }
              ].map((detail) => (
                <div
                  key={detail.label}
                  className="rounded-[1.2rem] border border-[rgba(var(--app-primary-rgb),0.08)] bg-[rgba(var(--app-surface-rgb),0.45)] px-4 py-3"
                >
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mist">{detail.label}</div>
                  <div className="mt-2 text-xl font-semibold text-ink">{detail.value}</div>
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-3 text-sm text-[rgba(var(--app-primary-rgb),0.68)]">
            {isContactCard && "phone" in item.payload && item.payload.phone ? (
              <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(var(--app-primary-rgb),0.08)] px-3 py-2">
                <Phone className="h-4 w-4" />
                {item.payload.phone}
              </div>
            ) : null}
            {item.territoryName ? (
              <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(var(--app-primary-rgb),0.08)] px-3 py-2">
                <MapPinned className="h-4 w-4" />
                {item.territoryName}
              </div>
            ) : null}
            <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(var(--app-primary-rgb),0.08)] px-3 py-2">
              <Save className="h-4 w-4" />
              Top cities: {item.stats.topCities.join(", ") || "Waiting on scans"}
            </div>
            {!isContactCard && "description" in item.payload && item.payload.description ? (
              <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(var(--app-primary-rgb),0.08)] px-3 py-2">
                <Sparkles className="h-4 w-4" />
                {item.payload.description}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}
