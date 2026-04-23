"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { authFetch, useAuth } from "@/lib/auth/client";
import { useAppFeedback } from "@/components/shared/app-feedback";
import { createQrBookingType, DEFAULT_QR_AVAILABILITY_SETTINGS } from "@/lib/qr/availability";
import type {
  QRBookingTypeConfig,
  QRCodeHubResponse,
  QRCodeListItem,
  QRCodeType,
  QRPhotoUploadTargetResponse,
  TerritoriesResponse,
  UserBookingProfileResponse
} from "@/types/api";

export type QrWorkspaceSurface = "codes" | "bookingProfile" | "performance";

export const WEEKDAY_CHOICES = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" }
] as const;

export const qrFieldClass =
  "app-focus-ring w-full rounded-2xl border border-[rgba(var(--app-primary-rgb),0.08)] px-4 py-3 text-sm";
export const qrTextAreaClass = `${qrFieldClass} min-h-24`;

export function qrImageUrl(value: string, logoUrl?: string | null) {
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

function createDefaultBookingTypeState(): QRBookingTypeConfig[] {
  return [
    createQrBookingType("phone_call", { id: "phone-call", label: "Phone Call" }),
    createQrBookingType("in_person_consult", { id: "in-person-consult", label: "In-Person Consult" })
  ];
}

type QrWorkspaceContextValue = {
  hub: QRCodeHubResponse | null;
  territories: TerritoriesResponse["items"];
  loading: boolean;
  saveState: "idle" | "saving" | "saved" | "error";
  error: string | null;
  codeType: QRCodeType;
  label: string;
  territoryId: string;
  title: string;
  photoUrl: string;
  photoUploadState: "idle" | "uploading" | "uploaded" | "error";
  photoUploadError: string | null;
  photoFileName: string | null;
  photoInputKey: number;
  phone: string;
  email: string;
  website: string;
  bookingEnabled: boolean;
  bookingBlurb: string;
  availabilityTimezone: string;
  availabilityWorkingDays: number[];
  availabilityStartTime: string;
  availabilityEndTime: string;
  availabilityMinNoticeHours: number;
  availabilityMaxDaysOut: number;
  bookingTypes: QRBookingTypeConfig[];
  selectedBookingTypes: string[];
  expandedBookingTypeIds: string[];
  bookingProfileState: "idle" | "saving" | "saved" | "error";
  bookingProfileMessage: string | null;
  destinationUrl: string;
  description: string;
  expandedEngagementCodeId: string | null;
  archivingQrCodeId: string | null;
  totalStats: { scans: number; bookings: number; saves: number };
  canCreateCampaignTracker: boolean;
  items: QRCodeListItem[];
  activeCodeCount: number;
  setCodeType: (value: QRCodeType) => void;
  setLabel: (value: string) => void;
  setTerritoryId: (value: string) => void;
  setTitle: (value: string) => void;
  setPhone: (value: string) => void;
  setEmail: (value: string) => void;
  setWebsite: (value: string) => void;
  setBookingEnabled: (value: boolean) => void;
  setBookingBlurb: (value: string) => void;
  setAvailabilityTimezone: (value: string) => void;
  setAvailabilityWorkingDays: (value: number[] | ((current: number[]) => number[])) => void;
  setAvailabilityStartTime: (value: string) => void;
  setAvailabilityEndTime: (value: string) => void;
  setAvailabilityMinNoticeHours: (value: number) => void;
  setAvailabilityMaxDaysOut: (value: number) => void;
  setDestinationUrl: (value: string) => void;
  setDescription: (value: string) => void;
  setExpandedEngagementCodeId: (value: string | ((current: string | null) => string | null)) => void;
  updateBookingType: (bookingTypeId: string, updater: (current: QRBookingTypeConfig) => QRBookingTypeConfig) => void;
  toggleBookingTypeExpanded: (bookingTypeId: string) => void;
  addBookingType: (type: "phone_call" | "in_person_consult") => void;
  removeBookingType: (bookingTypeId: string) => void;
  setSelectedBookingTypes: (value: string[] | ((current: string[]) => string[])) => void;
  uploadPhoto: (file: File) => Promise<void>;
  clearPhoto: () => void;
  createCode: () => Promise<void>;
  saveBookingProfile: () => Promise<void>;
  archiveCode: (qrCodeId: string) => Promise<void>;
  loadHub: () => Promise<void>;
};

const QrWorkspaceContext = createContext<QrWorkspaceContextValue | null>(null);

function useQrWorkspaceController(): QrWorkspaceContextValue {
  const { session, appContext, supabase } = useAuth();
  const { notify, confirm } = useAppFeedback();
  const accessToken = session?.access_token ?? null;

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
  const [bookingTypes, setBookingTypes] = useState<QRBookingTypeConfig[]>(createDefaultBookingTypeState);
  const [selectedBookingTypes, setSelectedBookingTypes] = useState<string[]>(() =>
    createDefaultBookingTypeState()
      .filter((type) => type.enabled)
      .map((type) => type.id)
  );
  const [expandedBookingTypeIds, setExpandedBookingTypeIds] = useState<string[]>(() =>
    createDefaultBookingTypeState().map((type) => type.id)
  );
  const [bookingProfileState, setBookingProfileState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [bookingProfileMessage, setBookingProfileMessage] = useState<string | null>(null);
  const [destinationUrl, setDestinationUrl] = useState("");
  const [description, setDescription] = useState("");
  const [expandedEngagementCodeId, setExpandedEngagementCodeId] = useState<string | null>(null);
  const [archivingQrCodeId, setArchivingQrCodeId] = useState<string | null>(null);

  const loadHub = useCallback(async () => {
    if (!accessToken) return;

    setLoading(true);
    try {
      const [hubResponse, territoryResponse] = await Promise.all([
        authFetch(accessToken, "/api/qr"),
        authFetch(accessToken, "/api/territories")
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
  }, [accessToken]);

  useEffect(() => {
    void loadHub();
  }, [loadHub]);

  useEffect(() => {
    if (!accessToken) return;

    authFetch(accessToken, "/api/qr/booking-profile")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Could not load saved booking setup.");
        }
        return (await response.json()) as UserBookingProfileResponse;
      })
      .then((json) => {
        setAvailabilityTimezone(json.item.availability.timezone);
        setAvailabilityWorkingDays(json.item.availability.workingDays);
        setAvailabilityStartTime(json.item.availability.startTime);
        setAvailabilityEndTime(json.item.availability.endTime);
        setAvailabilityMinNoticeHours(json.item.availability.minNoticeHours);
        setAvailabilityMaxDaysOut(json.item.availability.maxDaysOut);
        setBookingTypes(json.item.bookingTypes);
        setSelectedBookingTypes(json.item.bookingTypes.filter((type) => type.enabled).map((type) => type.id));
        setExpandedBookingTypeIds(json.item.bookingTypes.map((type) => type.id));
      })
      .catch(() => null);
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;
    const interval = window.setInterval(() => {
      void loadHub();
    }, 30000);

    return () => {
      window.clearInterval(interval);
    };
  }, [accessToken, loadHub]);

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

  const updateBookingType = useCallback(
    (bookingTypeId: string, updater: (current: QRBookingTypeConfig) => QRBookingTypeConfig) => {
      setBookingTypes((current) => current.map((item) => (item.id === bookingTypeId ? updater(item) : item)));
    },
    []
  );

  const toggleBookingTypeExpanded = useCallback((bookingTypeId: string) => {
    setExpandedBookingTypeIds((current) =>
      current.includes(bookingTypeId)
        ? current.filter((item) => item !== bookingTypeId)
        : [...current, bookingTypeId]
    );
  }, []);

  const addBookingType = useCallback((type: "phone_call" | "in_person_consult") => {
    const nextType = createQrBookingType(type);
    setBookingTypes((current) => [...current, nextType]);
    setSelectedBookingTypes((current) => [...current, nextType.id]);
    setExpandedBookingTypeIds((current) => [...current, nextType.id]);
  }, []);

  const removeBookingType = useCallback(
    (bookingTypeId: string) => {
      if (bookingTypes.length <= 1) return;
      setBookingTypes((current) => current.filter((item) => item.id !== bookingTypeId));
      setSelectedBookingTypes((current) => current.filter((item) => item !== bookingTypeId));
      setExpandedBookingTypeIds((current) => current.filter((item) => item !== bookingTypeId));
    },
    [bookingTypes.length]
  );

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

  const clearPhoto = useCallback(() => {
    setPhotoUrl("");
    setPhotoUploadState("idle");
    setPhotoUploadError(null);
    setPhotoFileName(null);
    setPhotoInputKey((current) => current + 1);
  }, []);

  const uploadPhoto = useCallback(
    async (file: File) => {
      if (!accessToken || !supabase) return;

      setPhotoUploadState("uploading");
      setPhotoUploadError(null);
      setPhotoFileName(file.name);
      try {
        const uploadTargetResponse = await authFetch(accessToken, "/api/qr/photo-upload-url", {
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
    },
    [accessToken, supabase]
  );

  const createCode = useCallback(async () => {
    if (!accessToken) return;

    setSaveState("saving");
    setError(null);
    try {
      const response = await authFetch(accessToken, "/api/qr", {
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
          bookingTypes,
          bookingTypeIds: selectedBookingTypes,
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
      setSelectedBookingTypes(bookingTypes.filter((type) => type.enabled).map((type) => type.id));
      setDestinationUrl("");
      setDescription("");
      await loadHub();
    } catch (saveError) {
      setSaveState("error");
      setError(saveError instanceof Error ? saveError.message : "Could not create QR code.");
    }
  }, [
    accessToken,
    bookingBlurb,
    bookingEnabled,
    bookingTypes,
    clearPhoto,
    codeType,
    description,
    destinationUrl,
    email,
    label,
    loadHub,
    phone,
    photoUrl,
    selectedBookingTypes,
    territoryId,
    title,
    website
  ]);

  const saveBookingProfile = useCallback(async () => {
    if (!accessToken) return;

    setBookingProfileState("saving");
    setBookingProfileMessage(null);
    try {
      const response = await authFetch(accessToken, "/api/qr/booking-profile", {
        method: "PATCH",
        body: JSON.stringify({
          availability: {
            timezone: availabilityTimezone,
            workingDays: availabilityWorkingDays,
            startTime: availabilityStartTime,
            endTime: availabilityEndTime,
            minNoticeHours: availabilityMinNoticeHours,
            maxDaysOut: availabilityMaxDaysOut
          },
          bookingTypes
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
        throw new Error(firstFieldIssue || json.issues?.formErrors?.[0] || json.error || "Could not save booking setup.");
      }
      setBookingProfileState("saved");
      setBookingProfileMessage("Saved your booking setup. New booking links will start with these settings.");
      setSelectedBookingTypes((current) =>
        current.filter((bookingTypeId) => bookingTypes.some((type) => type.id === bookingTypeId && type.enabled))
      );
    } catch (saveError) {
      setBookingProfileState("error");
      setBookingProfileMessage(saveError instanceof Error ? saveError.message : "Could not save booking setup.");
    }
  }, [
    accessToken,
    availabilityEndTime,
    availabilityMaxDaysOut,
    availabilityMinNoticeHours,
    availabilityStartTime,
    availabilityTimezone,
    availabilityWorkingDays,
    bookingTypes
  ]);

  const archiveCode = useCallback(
    async (qrCodeId: string) => {
      if (!accessToken) return;

      const confirmed = await confirm({
        title: "Archive QR code?",
        message: "Archive this QR code? It will be removed from your active list.",
        confirmLabel: "Archive code",
        tone: "danger"
      });
      if (!confirmed) return;

      setArchivingQrCodeId(qrCodeId);
      setError(null);
      try {
        const response = await authFetch(accessToken, `/api/qr/${qrCodeId}`, {
          method: "DELETE"
        });
        const json = (await response.json()) as { error?: string };
        if (!response.ok) {
          throw new Error(json.error || "Could not archive QR code.");
        }
        await loadHub();
        notify({
          tone: "success",
          title: "QR code archived",
          message: "The code has been removed from your active list."
        });
      } catch (archiveError) {
        setError(archiveError instanceof Error ? archiveError.message : "Could not archive QR code.");
        notify({
          tone: "error",
          title: "Could not archive QR code",
          message: archiveError instanceof Error ? archiveError.message : "Could not archive QR code."
        });
      } finally {
        setArchivingQrCodeId(null);
      }
    },
    [accessToken, confirm, loadHub, notify]
  );

  const items = hub?.items ?? [];
  const activeCodeCount = items.filter((item) => item.status === "active").length;

  return {
    hub,
    territories,
    loading,
    saveState,
    error,
    codeType,
    label,
    territoryId,
    title,
    photoUrl,
    photoUploadState,
    photoUploadError,
    photoFileName,
    photoInputKey,
    phone,
    email,
    website,
    bookingEnabled,
    bookingBlurb,
    availabilityTimezone,
    availabilityWorkingDays,
    availabilityStartTime,
    availabilityEndTime,
    availabilityMinNoticeHours,
    availabilityMaxDaysOut,
    bookingTypes,
    selectedBookingTypes,
    expandedBookingTypeIds,
    bookingProfileState,
    bookingProfileMessage,
    destinationUrl,
    description,
    expandedEngagementCodeId,
    archivingQrCodeId,
    totalStats,
    canCreateCampaignTracker,
    items,
    activeCodeCount,
    setCodeType,
    setLabel,
    setTerritoryId,
    setTitle,
    setPhone,
    setEmail,
    setWebsite,
    setBookingEnabled,
    setBookingBlurb,
    setAvailabilityTimezone,
    setAvailabilityWorkingDays,
    setAvailabilityStartTime,
    setAvailabilityEndTime,
    setAvailabilityMinNoticeHours,
    setAvailabilityMaxDaysOut,
    setDestinationUrl,
    setDescription,
    setExpandedEngagementCodeId,
    updateBookingType,
    toggleBookingTypeExpanded,
    addBookingType,
    removeBookingType,
    setSelectedBookingTypes,
    uploadPhoto,
    clearPhoto,
    createCode,
    saveBookingProfile,
    archiveCode,
    loadHub
  };
}

export function QrWorkspaceProvider({ children }: { children: ReactNode }) {
  const value = useQrWorkspaceController();
  return <QrWorkspaceContext.Provider value={value}>{children}</QrWorkspaceContext.Provider>;
}

export function useQrWorkspace() {
  const value = useContext(QrWorkspaceContext);
  if (!value) {
    throw new Error("useQrWorkspace must be used within QrWorkspaceProvider");
  }
  return value;
}
