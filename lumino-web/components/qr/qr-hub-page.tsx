"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink, ImagePlus, MapPinned, Phone, QrCode, Save, Sparkles, X } from "lucide-react";
import { authFetch, useAuth } from "@/lib/auth/client";
import { DEFAULT_QR_AVAILABILITY_SETTINGS } from "@/lib/qr/availability";
import type {
  QRCodeHubResponse,
  QRCodeListItem,
  QRCodeType,
  QRPhotoUploadTargetResponse,
  TerritoriesResponse
} from "@/types/api";

const WEEKDAY_CHOICES = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" }
];

function qrImageUrl(value: string, logoUrl?: string | null) {
  const params = new URLSearchParams({
    text: value,
    size: "220",
    margin: "1"
  });
  if (logoUrl) {
    params.set("centerImageUrl", logoUrl);
    params.set("centerImageSizeRatio", "0.22");
  }
  return `https://quickchart.io/qr?${params.toString()}`;
}

function normalizeUrlInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function QrHubPage() {
  const { session, appContext, supabase } = useAuth();
  const [hub, setHub] = useState<QRCodeHubResponse | null>(null);
  const [territories, setTerritories] = useState<TerritoriesResponse["items"]>([]);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [codeType, setCodeType] = useState<QRCodeType>("contact_card");
  const [label, setLabel] = useState("");
  const [territoryId, setTerritoryId] = useState("");
  const [title, setTitle] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [photoUploadState, setPhotoUploadState] = useState<"idle" | "uploading" | "uploaded" | "error">("idle");
  const [photoUploadError, setPhotoUploadError] = useState<string | null>(null);
  const [photoFileName, setPhotoFileName] = useState<string | null>(null);
  const [photoInputKey, setPhotoInputKey] = useState(0);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState(appContext?.appUser.email ?? "");
  const [website, setWebsite] = useState("");
  const [bookingEnabled, setBookingEnabled] = useState(true);
  const [bookingBlurb, setBookingBlurb] = useState(
    "Pick a time that works for you and I’ll get it on my calendar."
  );
  const [availabilityTimezone, setAvailabilityTimezone] = useState(DEFAULT_QR_AVAILABILITY_SETTINGS.timezone);
  const [availabilityWorkingDays, setAvailabilityWorkingDays] = useState<number[]>(
    DEFAULT_QR_AVAILABILITY_SETTINGS.workingDays
  );
  const [availabilityStartTime, setAvailabilityStartTime] = useState(DEFAULT_QR_AVAILABILITY_SETTINGS.startTime);
  const [availabilityEndTime, setAvailabilityEndTime] = useState(DEFAULT_QR_AVAILABILITY_SETTINGS.endTime);
  const [availabilityMinNoticeHours, setAvailabilityMinNoticeHours] = useState(
    DEFAULT_QR_AVAILABILITY_SETTINGS.minNoticeHours
  );
  const [availabilityMaxDaysOut, setAvailabilityMaxDaysOut] = useState(DEFAULT_QR_AVAILABILITY_SETTINGS.maxDaysOut);
  const [destinationUrl, setDestinationUrl] = useState("");
  const [description, setDescription] = useState("");
  const [expandedEngagementCodeId, setExpandedEngagementCodeId] = useState<string | null>(null);

  const loadHub = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    try {
      const [hubResponse, territoryResponse] = await Promise.all([
        authFetch(session.access_token, "/api/qr"),
        authFetch(session.access_token, "/api/territories")
      ]);

      if (!hubResponse.ok) {
        throw new Error("Could not load QR codes.");
      }

      const hubJson = (await hubResponse.json()) as QRCodeHubResponse;
      setHub(hubJson);

      if (territoryResponse.ok) {
        const territoryJson = (await territoryResponse.json()) as TerritoriesResponse;
        setTerritories(territoryJson.items);
      } else {
        setTerritories([]);
      }

      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load QR codes.");
    } finally {
      setLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => {
    void loadHub();
  }, [loadHub]);

  useEffect(() => {
    if (!session?.access_token) return;
    const interval = window.setInterval(() => {
      void loadHub();
    }, 30000);

    return () => {
      window.clearInterval(interval);
    };
  }, [loadHub, session?.access_token]);

  useEffect(() => {
    if (appContext?.appUser.email) {
      setEmail(appContext.appUser.email);
    }
  }, [appContext?.appUser.email]);

  useEffect(() => {
    const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (browserTimeZone) {
      setAvailabilityTimezone(browserTimeZone);
    }
  }, []);

  const totalStats = useMemo(() => {
    return (hub?.items ?? []).reduce(
      (accumulator, item) => {
        accumulator.scans += item.stats.scans;
        accumulator.bookings += item.stats.appointmentsBooked;
        accumulator.saves += item.stats.saveContacts;
        return accumulator;
      },
      { scans: 0, bookings: 0, saves: 0 }
    );
  }, [hub?.items]);
  const canCreateCampaignTracker =
    Boolean(appContext?.isPlatformOwner) ||
    Boolean(appContext?.memberships.some((membership) => ["owner", "admin", "manager"].includes(membership.role)));

  async function uploadPhoto(file: File) {
    if (!session?.access_token || !supabase) return;

    setPhotoUploadState("uploading");
    setPhotoUploadError(null);
    setPhotoFileName(file.name);
    try {
      const uploadTargetResponse = await authFetch(session.access_token, "/api/qr/photo-upload-url", {
        method: "POST",
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type,
          fileSizeBytes: file.size
        })
      });

      const uploadTargetJson = (await uploadTargetResponse.json()) as Partial<QRPhotoUploadTargetResponse> & {
        error?: string;
      };
      if (
        !uploadTargetResponse.ok ||
        !uploadTargetJson.bucket ||
        !uploadTargetJson.path ||
        !uploadTargetJson.token ||
        !uploadTargetJson.publicUrl
      ) {
        throw new Error(uploadTargetJson.error || "Could not prepare rep photo upload.");
      }

      const storageUpload = await supabase.storage
        .from(uploadTargetJson.bucket)
        .uploadToSignedUrl(uploadTargetJson.path, uploadTargetJson.token, file);
      if (storageUpload.error) {
        throw storageUpload.error;
      }

      setPhotoUrl(uploadTargetJson.publicUrl);
      setPhotoUploadState("uploaded");
    } catch (uploadError) {
      setPhotoUploadState("error");
      setPhotoUploadError(uploadError instanceof Error ? uploadError.message : "Could not upload rep photo.");
    }
  }

  function clearPhoto() {
    setPhotoUrl("");
    setPhotoUploadState("idle");
    setPhotoUploadError(null);
    setPhotoFileName(null);
    setPhotoInputKey((current) => current + 1);
  }

  async function createCode() {
    if (!session?.access_token) return;
    setSaveState("saving");
    setError(null);
    try {
      const response = await authFetch(session.access_token, "/api/qr", {
        method: "POST",
        body: JSON.stringify({
          codeType,
          label,
          territoryId: territoryId || null,
          title: title || null,
          photoUrl: photoUrl || null,
          phone: phone || null,
          email: email || null,
          website: normalizeUrlInput(website),
          bookingEnabled,
          bookingBlurb: bookingBlurb || null,
          availabilityTimezone,
          availabilityWorkingDays,
          availabilityStartTime,
          availabilityEndTime,
          availabilityMinNoticeHours,
          availabilityMaxDaysOut,
          destinationUrl: normalizeUrlInput(destinationUrl),
          description: description || null
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
        const firstFormIssue = json.issues?.formErrors?.find(Boolean);
        throw new Error(firstFieldIssue || firstFormIssue || json.error || "Could not create QR code.");
      }

      setSaveState("saved");
      setCodeType("contact_card");
      setLabel("");
      setTerritoryId("");
      setTitle("");
      clearPhoto();
      setPhone("");
      setWebsite("");
      setBookingEnabled(true);
      setBookingBlurb("Pick a time that works for you and I’ll get it on my calendar.");
      setAvailabilityTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_QR_AVAILABILITY_SETTINGS.timezone);
      setAvailabilityWorkingDays(DEFAULT_QR_AVAILABILITY_SETTINGS.workingDays);
      setAvailabilityStartTime(DEFAULT_QR_AVAILABILITY_SETTINGS.startTime);
      setAvailabilityEndTime(DEFAULT_QR_AVAILABILITY_SETTINGS.endTime);
      setAvailabilityMinNoticeHours(DEFAULT_QR_AVAILABILITY_SETTINGS.minNoticeHours);
      setAvailabilityMaxDaysOut(DEFAULT_QR_AVAILABILITY_SETTINGS.maxDaysOut);
      setDestinationUrl("");
      setDescription("");
      await loadHub();
    } catch (saveError) {
      setSaveState("error");
      setError(saveError instanceof Error ? saveError.message : "Could not create QR code.");
    }
  }

  return (
    <div className="p-4 md:p-6">
      <div className="app-panel rounded-[2rem] border p-6">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">QR Workspace</div>
        <h1 className="mt-2 text-3xl font-semibold text-ink">Tracked cards that turn scans into leads</h1>
        <p className="mt-3 max-w-3xl text-sm text-[rgba(var(--app-primary-rgb),0.72)]">
          Create rep-owned digital business cards, tag them to a territory, and let homeowners book directly from the scan.
        </p>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          {[
            { label: "Total Scans", value: totalStats.scans, detail: "Every landing page visit across your live codes" },
            { label: "Booked Appointments", value: totalStats.bookings, detail: "Appointments created straight from QR scans" },
            { label: "Saved Contacts", value: totalStats.saves, detail: "How often homeowners kept the rep card" }
          ].map((item) => (
            <div key={item.label} className="app-panel-soft rounded-[1.8rem] border p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-mist">{item.label}</div>
              <div className="mt-3 text-3xl font-semibold text-ink">{loading ? "…" : item.value}</div>
              <div className="mt-1 text-xs text-[rgba(var(--app-primary-rgb),0.58)]">{item.detail}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[380px_1fr]">
        <section className="app-panel rounded-[2rem] border p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-slate-950 p-3 text-white">
              <QrCode className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">New Code</div>
              <div className="mt-1 text-xl font-semibold text-ink">Rep booking card</div>
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
                className="w-full rounded-2xl border border-[rgba(var(--app-primary-rgb),0.08)] px-4 py-3 text-sm outline-none transition focus:border-[rgba(var(--app-accent-rgb),0.32)]"
              />
            </label>

            <label className="block space-y-2">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Territory</div>
              <select
                value={territoryId}
                onChange={(event) => setTerritoryId(event.target.value)}
                className="w-full rounded-2xl border border-[rgba(var(--app-primary-rgb),0.08)] px-4 py-3 text-sm outline-none transition focus:border-[rgba(var(--app-accent-rgb),0.32)]"
              >
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
                    className="w-full rounded-2xl border border-[rgba(var(--app-primary-rgb),0.08)] px-4 py-3 text-sm outline-none transition focus:border-[rgba(var(--app-accent-rgb),0.32)]"
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
                    className="w-full rounded-2xl border border-[rgba(var(--app-primary-rgb),0.08)] px-4 py-3 text-sm outline-none transition focus:border-[rgba(var(--app-accent-rgb),0.32)]"
                  />
                </label>

                <label className="block space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Email</div>
                  <input
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="felix@example.com"
                    className="w-full rounded-2xl border border-[rgba(var(--app-primary-rgb),0.08)] px-4 py-3 text-sm outline-none transition focus:border-[rgba(var(--app-accent-rgb),0.32)]"
                  />
                </label>

                <label className="block space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Website</div>
                  <input
                    value={website}
                    onChange={(event) => setWebsite(event.target.value)}
                    placeholder="https://your-site.com"
                    className="w-full rounded-2xl border border-[rgba(var(--app-primary-rgb),0.08)] px-4 py-3 text-sm outline-none transition focus:border-[rgba(var(--app-accent-rgb),0.32)]"
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

                <label className="block space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Booking blurb</div>
                  <textarea
                    value={bookingBlurb}
                    onChange={(event) => setBookingBlurb(event.target.value)}
                    className="min-h-24 w-full rounded-2xl border border-[rgba(var(--app-primary-rgb),0.08)] px-4 py-3 text-sm outline-none transition focus:border-[rgba(var(--app-accent-rgb),0.32)]"
                  />
                </label>

                <div className="rounded-[1.6rem] border border-[rgba(var(--app-primary-rgb),0.08)] bg-[rgba(var(--app-surface-rgb),0.5)] p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Booking Availability</div>
                  <div className="mt-2 text-sm text-[rgba(var(--app-primary-rgb),0.62)]">
                    Homeowners will only see open slots inside these days and hours.
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <label className="block space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Timezone</div>
                      <input
                        value={availabilityTimezone}
                        onChange={(event) => setAvailabilityTimezone(event.target.value)}
                        placeholder="America/New_York"
                        className="w-full rounded-2xl border border-[rgba(var(--app-primary-rgb),0.08)] px-4 py-3 text-sm outline-none transition focus:border-[rgba(var(--app-accent-rgb),0.32)]"
                      />
                    </label>

                    <div className="grid grid-cols-2 gap-4">
                      <label className="block space-y-2">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Start</div>
                        <input
                          type="time"
                          value={availabilityStartTime}
                          onChange={(event) => setAvailabilityStartTime(event.target.value)}
                          className="w-full rounded-2xl border border-[rgba(var(--app-primary-rgb),0.08)] px-4 py-3 text-sm outline-none transition focus:border-[rgba(var(--app-accent-rgb),0.32)]"
                        />
                      </label>
                      <label className="block space-y-2">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">End</div>
                        <input
                          type="time"
                          value={availabilityEndTime}
                          onChange={(event) => setAvailabilityEndTime(event.target.value)}
                          className="w-full rounded-2xl border border-[rgba(var(--app-primary-rgb),0.08)] px-4 py-3 text-sm outline-none transition focus:border-[rgba(var(--app-accent-rgb),0.32)]"
                        />
                      </label>
                    </div>

                    <label className="block space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Minimum notice</div>
                      <select
                        value={availabilityMinNoticeHours}
                        onChange={(event) => setAvailabilityMinNoticeHours(Number(event.target.value))}
                        className="w-full rounded-2xl border border-[rgba(var(--app-primary-rgb),0.08)] px-4 py-3 text-sm outline-none transition focus:border-[rgba(var(--app-accent-rgb),0.32)]"
                      >
                        {[0, 1, 2, 4, 8, 12, 24].map((hours) => (
                          <option key={hours} value={hours}>
                            {hours === 0 ? "No minimum" : `${hours} hour${hours === 1 ? "" : "s"}`}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">How far out</div>
                      <select
                        value={availabilityMaxDaysOut}
                        onChange={(event) => setAvailabilityMaxDaysOut(Number(event.target.value))}
                        className="w-full rounded-2xl border border-[rgba(var(--app-primary-rgb),0.08)] px-4 py-3 text-sm outline-none transition focus:border-[rgba(var(--app-accent-rgb),0.32)]"
                      >
                        {[7, 10, 14, 21, 30].map((days) => (
                          <option key={days} value={days}>
                            {days} days
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="mt-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Working days</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {WEEKDAY_CHOICES.map((day) => {
                        const active = availabilityWorkingDays.includes(day.value);
                        return (
                          <button
                            key={day.value}
                            type="button"
                            onClick={() =>
                              setAvailabilityWorkingDays((current) => {
                                if (active) {
                                  return current.filter((value) => value !== day.value);
                                }
                                return [...current, day.value].sort((left, right) => left - right);
                              })
                            }
                            className={`rounded-full border px-3 py-2 text-sm font-semibold transition ${
                              active
                                ? "border-[rgba(var(--app-primary-rgb),0.96)] bg-[rgba(var(--app-primary-rgb),0.96)] text-white"
                                : "border-[rgba(var(--app-primary-rgb),0.08)] bg-white text-[rgba(var(--app-primary-rgb),0.72)] hover:border-[rgba(var(--app-primary-rgb),0.2)]"
                            }`}
                          >
                            {day.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="mt-4 rounded-[1.2rem] border border-[rgba(var(--app-primary-rgb),0.08)] bg-white/80 px-4 py-3 text-xs text-[rgba(var(--app-primary-rgb),0.62)]">
                    Homeowners will choose between two booking types: a 15 minute phone call or a 60 minute in-person consult. Buffer rules still apply behind the scenes when Lumino checks open time.
                  </div>
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
                    className="w-full rounded-2xl border border-[rgba(var(--app-primary-rgb),0.08)] px-4 py-3 text-sm outline-none transition focus:border-[rgba(var(--app-accent-rgb),0.32)]"
                  />
                </label>

                <label className="block space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Description</div>
                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    className="min-h-24 w-full rounded-2xl border border-[rgba(var(--app-primary-rgb),0.08)] px-4 py-3 text-sm outline-none transition focus:border-[rgba(var(--app-accent-rgb),0.32)]"
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
          {(hub?.items ?? []).map((item) => (
            <QrCodeCard
              key={item.qrCodeId}
              item={item}
              engagementExpanded={expandedEngagementCodeId === item.qrCodeId}
              onToggleEngagement={() =>
                setExpandedEngagementCodeId((current) => (current === item.qrCodeId ? null : item.qrCodeId))
              }
            />
          ))}

          {!loading && !(hub?.items.length ?? 0) ? (
            <div className="app-panel rounded-[2rem] border border-dashed p-8 text-sm text-[rgba(var(--app-primary-rgb),0.62)]">
              No QR codes yet. Create the first rep booking card and start tagging scans back to the right neighborhood.
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function QrCodeCard({
  item,
  engagementExpanded,
  onToggleEngagement
}: {
  item: QRCodeListItem;
  engagementExpanded: boolean;
  onToggleEngagement: () => void;
}) {
  const copyUrl = async () => {
    await navigator.clipboard.writeText(item.publicUrl).catch(() => null);
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
                {isContactCard ? "Contact card" : "Campaign tracker"}{item.territoryName ? ` · ${item.territoryName}` : ""}
              </div>
              <div className="mt-1 text-2xl font-semibold text-ink">{item.label}</div>
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
              <a
                href={item.publicUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-2xl border border-[rgba(var(--app-primary-rgb),0.08)] px-3 py-2 text-sm text-ink transition hover:bg-[rgba(var(--app-surface-rgb),0.48)]"
              >
                <ExternalLink className="h-4 w-4" />
                Open
              </a>
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
              {
                label: "Engagement",
                value: engagementTotal
              }
            ].map((stat) => (
              <button
                key={stat.label}
                type="button"
                onClick={stat.label === "Engagement" ? onToggleEngagement : undefined}
                className={`rounded-[1.4rem] border border-[rgba(var(--app-primary-rgb),0.08)] bg-white/80 px-4 py-3 text-left ${
                  stat.label === "Engagement" ? "transition hover:bg-[rgba(var(--app-surface-rgb),0.55)]" : ""
                }`}
              >
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-mist">{stat.label}</div>
                <div className="mt-2 text-2xl font-semibold text-ink">{stat.value}</div>
                {stat.label === "Engagement" ? (
                  <div className="mt-1 text-[11px] text-[rgba(var(--app-primary-rgb),0.58)]">
                    {engagementExpanded ? "Hide breakdown" : "Click for breakdown"}
                  </div>
                ) : null}
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
