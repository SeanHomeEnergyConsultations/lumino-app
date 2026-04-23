"use client";

import { ImagePlus, Plus, QrCode, Sparkles, X } from "lucide-react";
import { QrCodeCard } from "@/components/qr/qr-code-card";
import { qrFieldClass, useQrWorkspace } from "@/components/qr/qr-workspace-context";
import type { QRCodeType } from "@/types/api";

export function QrCodesSurface() {
  const {
    activeCodeCount,
    archivingQrCodeId,
    bookingBlurb,
    bookingEnabled,
    bookingTypes,
    canCreateCampaignTracker,
    clearPhoto,
    codeType,
    createCode,
    description,
    destinationUrl,
    error,
    expandedEngagementCodeId,
    items,
    label,
    loading,
    phone,
    photoFileName,
    photoInputKey,
    photoUploadError,
    photoUploadState,
    photoUrl,
    saveState,
    selectedBookingTypes,
    setBookingBlurb,
    setBookingEnabled,
    setCodeType,
    setDescription,
    setDestinationUrl,
    setEmail,
    setExpandedEngagementCodeId,
    setLabel,
    setPhone,
    setSelectedBookingTypes,
    setTerritoryId,
    setTitle,
    setWebsite,
    territories,
    territoryId,
    title,
    uploadPhoto,
    website,
    email,
    archiveCode
  } = useQrWorkspace();

  return (
    <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
      <section className="app-panel rounded-[2rem] border p-5">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-slate-950 p-3 text-white">
            <QrCode className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Codes</div>
            <div className="mt-1 text-xl font-semibold text-ink">Create and launch a new QR experience</div>
          </div>
        </div>

        <div className="mt-5 space-y-4">
          {canCreateCampaignTracker ? (
            <div className="grid grid-cols-2 gap-2 rounded-2xl bg-[rgba(var(--app-surface-rgb),0.5)] p-1">
              {[
                { value: "contact_card", label: "Contact Card" },
                { value: "campaign_tracker", label: "Campaign Tracker" }
              ].map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setCodeType(item.value as QRCodeType)}
                  className={`rounded-[1rem] px-3 py-2 text-sm font-semibold transition ${
                    codeType === item.value
                      ? "bg-[rgba(var(--app-primary-rgb),0.96)] text-white"
                      : "text-[rgba(var(--app-primary-rgb),0.68)]"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}

          <label className="block space-y-2">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Label</div>
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Millbury leave-behind"
              className={qrFieldClass}
            />
          </label>

          <label className="block space-y-2">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Territory</div>
            <select value={territoryId} onChange={(event) => setTerritoryId(event.target.value)} className={qrFieldClass}>
              <option value="">No territory tag</option>
              {territories.map((item) => (
                <option key={item.territoryId} value={item.territoryId}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>

          {codeType === "contact_card" ? (
            <>
              <label className="block space-y-2">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Title</div>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Solar Advisor"
                  className={qrFieldClass}
                />
              </label>

              <label className="block space-y-2">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Rep Photo</div>
                <div className="rounded-[1.6rem] border border-[rgba(var(--app-primary-rgb),0.08)] bg-[rgba(var(--app-surface-rgb),0.5)] p-4">
                  <div className="flex items-center gap-4">
                    {photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={photoUrl}
                        alt="Rep preview"
                        width={80}
                        height={80}
                        className="h-20 w-20 rounded-[1.4rem] border border-[rgba(var(--app-primary-rgb),0.08)] object-cover"
                      />
                    ) : (
                      <div className="flex h-20 w-20 items-center justify-center rounded-[1.4rem] border border-dashed border-[rgba(var(--app-primary-rgb),0.14)] bg-white text-[rgba(var(--app-primary-rgb),0.4)]">
                        <ImagePlus className="h-5 w-5" />
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-ink">
                        {photoFileName ?? "Upload a photo from your phone or computer"}
                      </div>
                      <div className="mt-1 text-xs text-[rgba(var(--app-primary-rgb),0.58)]">
                        JPG, PNG, or other image formats up to 10 MB.
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-[rgba(var(--app-primary-rgb),0.96)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-92">
                          <ImagePlus className="h-4 w-4" />
                          {photoUrl ? "Replace Photo" : "Upload Photo"}
                          <input
                            key={photoInputKey}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              if (!file) return;
                              void uploadPhoto(file);
                            }}
                          />
                        </label>
                        {photoUrl ? (
                          <button
                            type="button"
                            onClick={clearPhoto}
                            className="inline-flex items-center gap-2 rounded-2xl border border-[rgba(var(--app-primary-rgb),0.12)] px-4 py-2 text-sm font-semibold text-[rgba(var(--app-primary-rgb),0.72)] transition hover:border-[rgba(var(--app-primary-rgb),0.2)]"
                          >
                            <X className="h-4 w-4" />
                            Remove
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {photoUploadState === "uploading" ? (
                    <div className="mt-3 text-xs font-semibold uppercase tracking-[0.16em] text-[rgba(var(--app-accent-rgb),0.8)]">
                      Uploading photo...
                    </div>
                  ) : null}
                  {photoUploadError ? (
                    <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
                      {photoUploadError}
                    </div>
                  ) : null}
                </div>
              </label>

              <label className="block space-y-2">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Phone</div>
                <input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="774-555-1234"
                  className={qrFieldClass}
                />
              </label>

              <label className="block space-y-2">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Email</div>
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="felix@example.com"
                  className={qrFieldClass}
                />
              </label>

              <label className="block space-y-2">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Website</div>
                <input
                  value={website}
                  onChange={(event) => setWebsite(event.target.value)}
                  placeholder="https://your-site.com"
                  className={qrFieldClass}
                />
              </label>

              <label className="flex items-center justify-between rounded-2xl border border-[rgba(var(--app-primary-rgb),0.08)] px-4 py-3 text-sm text-ink">
                <span>
                  <span className="block font-semibold">Allow booking</span>
                  <span className="mt-1 block text-xs text-[rgba(var(--app-primary-rgb),0.6)]">
                    Homeowners can submit their info and set an appointment from the QR page.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={bookingEnabled}
                  onChange={(event) => setBookingEnabled(event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
              </label>

              <div className="rounded-[1.6rem] border border-[rgba(var(--app-primary-rgb),0.08)] bg-[rgba(var(--app-surface-rgb),0.5)] p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Offer on This Code</div>
                <div className="mt-2 text-sm text-[rgba(var(--app-primary-rgb),0.62)]">
                  Pick which of your saved appointment options this homeowner should be able to choose from.
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {bookingTypes.map((bookingType) => {
                    const active = selectedBookingTypes.includes(bookingType.id);
                    return (
                      <button
                        key={bookingType.id}
                        type="button"
                        disabled={!bookingType.enabled}
                        onClick={() =>
                          setSelectedBookingTypes((current) => {
                            if (active) {
                              return current.filter((value) => value !== bookingType.id);
                            }
                            return [...current, bookingType.id];
                          })
                        }
                        className={`rounded-full border px-3 py-2 text-sm font-semibold transition ${
                          active
                            ? "border-[rgba(var(--app-primary-rgb),0.96)] bg-[rgba(var(--app-primary-rgb),0.96)] text-white"
                            : "border-[rgba(var(--app-primary-rgb),0.08)] bg-white text-[rgba(var(--app-primary-rgb),0.72)] hover:border-[rgba(var(--app-primary-rgb),0.2)]"
                        } disabled:cursor-not-allowed disabled:opacity-40`}
                      >
                        {bookingType.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="block space-y-2">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Booking blurb</div>
                <textarea
                  value={bookingBlurb}
                  onChange={(event) => setBookingBlurb(event.target.value)}
                  className={`${qrFieldClass} min-h-24`}
                />
              </label>

              <div className="rounded-[1.6rem] border border-[rgba(var(--app-primary-rgb),0.08)] bg-[rgba(var(--app-surface-rgb),0.5)] px-4 py-3 text-sm text-[rgba(var(--app-primary-rgb),0.68)]">
                Booking rules now live in the dedicated <span className="font-semibold text-ink">Booking Profile</span>{" "}
                surface. This card only chooses which saved appointment types to offer.
              </div>
            </>
          ) : (
            <>
              <label className="block space-y-2">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Destination URL</div>
                <input
                  value={destinationUrl}
                  onChange={(event) => setDestinationUrl(event.target.value)}
                  placeholder="https://your-campaign-page.com"
                  className={qrFieldClass}
                />
              </label>

              <label className="block space-y-2">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Description</div>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  className={`${qrFieldClass} min-h-24`}
                  placeholder="Neighborhood flyer, mailer, or ad destination."
                />
              </label>
            </>
          )}

          <button
            type="button"
            onClick={() => void createCode()}
            disabled={saveState === "saving" || photoUploadState === "uploading" || !label.trim()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[rgba(var(--app-primary-rgb),0.96)] px-5 py-3 text-sm font-semibold text-white transition hover:opacity-92 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4" />
            {saveState === "saving"
              ? "Creating..."
              : codeType === "campaign_tracker"
                ? "Create Campaign Tracker"
                : "Create QR Card"}
          </button>

          {error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">{error}</div>
          ) : null}
        </div>
      </section>

      <section className="space-y-4">
        <div className="app-panel rounded-[2rem] border p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Active Codes</div>
              <div className="mt-1 text-xl font-semibold text-ink">Manage live QR experiences</div>
              <div className="mt-2 text-sm text-[rgba(var(--app-primary-rgb),0.62)]">
                {activeCodeCount} active codes across contact cards and campaign trackers.
              </div>
            </div>
          </div>
        </div>

        {items.map((item) => (
          <QrCodeCard
            key={item.qrCodeId}
            item={item}
            archiving={archivingQrCodeId === item.qrCodeId}
            onArchive={() => void archiveCode(item.qrCodeId)}
            engagementExpanded={expandedEngagementCodeId === item.qrCodeId}
            onToggleEngagement={() =>
              setExpandedEngagementCodeId((current) => (current === item.qrCodeId ? null : item.qrCodeId))
            }
          />
        ))}

        {!loading && !items.length ? (
          <div className="app-panel rounded-[2rem] border border-dashed p-8 text-sm text-[rgba(var(--app-primary-rgb),0.62)]">
            No QR codes yet. Create the first rep booking card and start tagging scans back to the right neighborhood.
          </div>
        ) : null}
      </section>
    </div>
  );
}
