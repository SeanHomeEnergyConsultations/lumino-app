"use client";

import { useEffect, useRef, useState } from "react";

type LiveLocation = {
  latitude: number;
  longitude: number;
};

export function useLiveLocation({
  onFirstFix
}: {
  onFirstFix?: (location: LiveLocation) => void;
}) {
  const [userLocation, setUserLocation] = useState<LiveLocation | null>(null);
  const hasHandledFirstFixRef = useRef(false);
  const onFirstFixRef = useRef(onFirstFix);

  useEffect(() => {
    onFirstFixRef.current = onFirstFix;
  }, [onFirstFix]);

  useEffect(() => {
    if (!navigator.geolocation) return;

    const success = (position: GeolocationPosition) => {
      const nextLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      };

      setUserLocation(nextLocation);
      if (!hasHandledFirstFixRef.current) {
        hasHandledFirstFixRef.current = true;
        onFirstFixRef.current?.(nextLocation);
      }
    };

    navigator.geolocation.getCurrentPosition(success, () => undefined, {
      enableHighAccuracy: true,
      maximumAge: 30000,
      timeout: 10000
    });

    const watchId = navigator.geolocation.watchPosition(success, () => undefined, {
      enableHighAccuracy: true,
      maximumAge: 15000,
      timeout: 10000
    });

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  return userLocation;
}
