export type AppEventPayload = Record<string, string | number | boolean | null | undefined>;

export function trackAppEvent(name: string, payload: AppEventPayload = {}) {
  if (typeof window === "undefined") return;

  const body = JSON.stringify({
    name,
    payload,
    pathname: window.location.pathname,
    recordedAt: new Date().toISOString()
  });

  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon("/api/app-events", blob);
    } else {
      void fetch("/api/app-events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true
      }).catch(() => null);
    }
  } catch {
    return;
  }
}
