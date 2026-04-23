"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { authFetch } from "@/lib/auth/client";
import type { ResolvePropertyResponse } from "@/types/api";
import type { OrganizationFeatureAccess, PropertyDetail } from "@/types/entities";

export interface MapViewportState {
  latitude: number;
  longitude: number;
  zoom: number;
}

function previewSelectionKey(lat: number, lng: number) {
  return `preview:${lat.toFixed(5)},${lng.toFixed(5)}`;
}

function buildPreviewPropertyDetail(input: {
  address: string;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  lat: number;
  lng: number;
  featureAccess: OrganizationFeatureAccess;
}): PropertyDetail {
  return {
    propertyId: previewSelectionKey(input.lat, input.lng),
    address: input.address,
    city: input.city,
    state: input.state,
    postalCode: input.postalCode,
    lat: input.lat,
    lng: input.lng,
    mapState: "unworked_property",
    followUpState: "none",
    visitCount: 0,
    notHomeCount: 0,
    lastVisitOutcome: null,
    lastVisitedAt: null,
    leadId: null,
    leadStatus: null,
    ownerId: null,
    firstName: null,
    lastName: null,
    phone: null,
    email: null,
    leadNotes: null,
    leadNextFollowUpAt: null,
    appointmentAt: null,
    priorityScore: 0,
    priorityBand: "low",
    prioritySummary: "This location has not been saved yet. Log an outcome or save contact data to keep it.",
    featureAccess: input.featureAccess,
    recentVisits: [],
    recentActivities: [],
    facts: {
      beds: null,
      baths: null,
      squareFeet: null,
      lotSizeSqft: null,
      yearBuilt: null,
      lastSaleDate: null,
      lastSalePrice: null,
      propertyType: null,
      listingStatus: null,
      saleType: null,
      daysOnMarket: null,
      hoaMonthly: null,
      dataCompletenessScore: null,
      solarFitScore: null,
      roofCapacityScore: null,
      roofComplexityScore: null,
      estimatedSystemCapacityKw: null,
      estimatedYearlyEnergyKwh: null,
      solarImageryQuality: null,
      propertyPriorityScore: null,
      propertyPriorityLabel: null
    },
    enrichments: [],
    sourceRecords: [],
    isPreview: true
  };
}

export function useMapPropertySelection({
  accessToken,
  initialSelectedPropertyId = null,
  initialAddressSearch = null,
  featureAccess,
  reloadViewportProperties,
  onFeatureAccess,
  setViewState
}: {
  accessToken: string | null | undefined;
  initialSelectedPropertyId?: string | null;
  initialAddressSearch?: string | null;
  featureAccess: OrganizationFeatureAccess;
  reloadViewportProperties: () => Promise<void>;
  onFeatureAccess: (value: OrganizationFeatureAccess) => void;
  setViewState: Dispatch<SetStateAction<MapViewportState>>;
}) {
  const hasHandledInitialAddressSearchRef = useRef(false);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(initialSelectedPropertyId);
  const [selectedProperty, setSelectedProperty] = useState<PropertyDetail | null>(null);
  const [propertyLoading, setPropertyLoading] = useState(false);
  const [isResolvingTap, setIsResolvingTap] = useState(false);
  const [mobileOpenNonce, setMobileOpenNonce] = useState(0);

  useEffect(() => {
    setSelectedPropertyId(initialSelectedPropertyId);
  }, [initialSelectedPropertyId]);

  useEffect(() => {
    if (!accessToken || !selectedPropertyId) {
      setPropertyLoading(false);
      if (!selectedProperty?.isPreview) {
        setSelectedProperty(null);
      }
      return;
    }

    if (selectedPropertyId.startsWith("preview:")) {
      setPropertyLoading(false);
      return;
    }

    let cancelled = false;
    setPropertyLoading(true);

    authFetch(accessToken, `/api/properties/${selectedPropertyId}`)
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as { item: PropertyDetail };
      })
      .then((json) => {
        if (cancelled) return;
        setSelectedProperty(json?.item ?? null);
        if (json?.item?.featureAccess) {
          onFeatureAccess(json.item.featureAccess);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPropertyLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, onFeatureAccess, selectedProperty?.isPreview, selectedPropertyId]);

  useEffect(() => {
    if (!selectedProperty?.lat || !selectedProperty?.lng) return;

    setViewState((current) => ({
      ...current,
      latitude: selectedProperty.lat ?? current.latitude,
      longitude: selectedProperty.lng ?? current.longitude,
      zoom: Math.max(current.zoom, 16)
    }));
  }, [selectedProperty?.lat, selectedProperty?.lng, setViewState]);

  const openSelectedProperty = useCallback((propertyId: string) => {
    setSelectedPropertyId(propertyId);
    setMobileOpenNonce((current) => current + 1);
  }, []);

  const closeSelectedProperty = useCallback(() => {
    setSelectedPropertyId(null);
    setSelectedProperty(null);
    setPropertyLoading(false);
  }, []);

  const refreshSelectedProperty = useCallback(
    async (propertyId: string) => {
      if (!accessToken) return;

      const [detailResponse] = await Promise.all([
        authFetch(accessToken, `/api/properties/${propertyId}`),
        reloadViewportProperties()
      ]);

      if (detailResponse.ok) {
        const detailJson = (await detailResponse.json()) as { item: PropertyDetail };
        setSelectedProperty(detailJson.item);
      }
    },
    [accessToken, reloadViewportProperties]
  );

  const ensurePersistedSelectedProperty = useCallback(async () => {
    if (!accessToken || !selectedProperty?.lat || !selectedProperty?.lng) {
      throw new Error("This property location could not be saved.");
    }

    if (!selectedProperty.isPreview && selectedPropertyId && !selectedPropertyId.startsWith("preview:")) {
      return selectedPropertyId;
    }

    const response = await authFetch(accessToken, "/api/properties/resolve?commit=1", {
      method: "POST",
      body: JSON.stringify({
        lat: selectedProperty.lat,
        lng: selectedProperty.lng
      })
    });

    if (!response.ok) {
      throw new Error("Failed to save property location.");
    }

    const json = (await response.json()) as ResolvePropertyResponse;
    if (!json.propertyId) {
      throw new Error("Could not persist property location.");
    }

    setSelectedPropertyId(json.propertyId);
    await refreshSelectedProperty(json.propertyId);
    return json.propertyId;
  }, [accessToken, refreshSelectedProperty, selectedProperty, selectedPropertyId]);

  const handleResolvedProperty = useCallback(
    async (json: ResolvePropertyResponse, options?: { centerPreview?: boolean }) => {
      if (json.propertyId) {
        openSelectedProperty(json.propertyId);
        await refreshSelectedProperty(json.propertyId);
        return;
      }

      if (!json.preview) return;

      if (options?.centerPreview) {
        setViewState((current) => ({
          ...current,
          latitude: json.preview?.lat ?? current.latitude,
          longitude: json.preview?.lng ?? current.longitude,
          zoom: Math.max(current.zoom, 16)
        }));
      }

      openSelectedProperty(previewSelectionKey(json.preview.lat, json.preview.lng));
      setSelectedProperty(
        buildPreviewPropertyDetail({
          ...json.preview,
          featureAccess
        })
      );
    },
    [featureAccess, openSelectedProperty, refreshSelectedProperty, setViewState]
  );

  const handleMapTap = useCallback(
    async (lat: number, lng: number) => {
      if (!accessToken || isResolvingTap) return;

      try {
        setIsResolvingTap(true);
        const response = await authFetch(accessToken, "/api/properties/resolve", {
          method: "POST",
          body: JSON.stringify({ lat, lng })
        });

        if (!response.ok) return;
        const json = (await response.json()) as ResolvePropertyResponse;
        await handleResolvedProperty(json);
      } finally {
        setIsResolvingTap(false);
      }
    },
    [accessToken, handleResolvedProperty, isResolvingTap]
  );

  const handleAddressSearch = useCallback(
    async (address: string) => {
      if (!accessToken || isResolvingTap) return;

      try {
        setIsResolvingTap(true);
        const response = await authFetch(accessToken, "/api/properties/resolve", {
          method: "POST",
          body: JSON.stringify({ address })
        });

        if (!response.ok) return;
        const json = (await response.json()) as ResolvePropertyResponse;
        await handleResolvedProperty(json, { centerPreview: true });
      } finally {
        setIsResolvingTap(false);
      }
    },
    [accessToken, handleResolvedProperty, isResolvingTap]
  );

  useEffect(() => {
    const trimmed = initialAddressSearch?.trim();
    if (!accessToken || !trimmed || hasHandledInitialAddressSearchRef.current) return;
    hasHandledInitialAddressSearchRef.current = true;
    void handleAddressSearch(trimmed);
  }, [accessToken, handleAddressSearch, initialAddressSearch]);

  return {
    selectedPropertyId,
    selectedProperty,
    propertyLoading,
    isResolvingTap,
    mobileOpenNonce,
    openSelectedProperty,
    closeSelectedProperty,
    refreshSelectedProperty,
    ensurePersistedSelectedProperty,
    handleMapTap,
    handleAddressSearch
  };
}
