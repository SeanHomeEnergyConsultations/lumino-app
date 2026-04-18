"use client";

import { useMemo, useState } from "react";
import { Clock3, DoorOpen, FileBadge2, Handshake, MapPinned, Users, XCircle } from "lucide-react";
import Map, { Marker, NavigationControl } from "react-map-gl/maplibre";
import type { ManagerMapPoint, ManagerRepPresenceItem } from "@/types/api";

function outcomeStyles(outcome: string | null) {
  switch (outcome) {
    case "opportunity":
      return { className: "bg-field text-white", icon: Handshake };
    case "left_doorhanger":
      return { className: "bg-violet-600 text-white", icon: FileBadge2 };
    case "not_home":
      return { className: "bg-slate-600 text-white", icon: DoorOpen };
    case "appointment_set":
      return { className: "bg-sky-600 text-white", icon: Clock3 };
    case "not_interested":
      return { className: "bg-orange-500 text-white", icon: XCircle };
    default:
      return { className: "bg-ink text-white", icon: MapPinned };
  }
}

function deriveCenter(points: ManagerMapPoint[], reps: ManagerRepPresenceItem[]) {
  const coords = [
    ...points.map((point) => ({ lat: point.lat, lng: point.lng })),
    ...reps.filter((rep) => rep.lat != null && rep.lng != null).map((rep) => ({ lat: rep.lat as number, lng: rep.lng as number }))
  ];

  if (!coords.length) {
    return { latitude: 42.1637, longitude: -71.8023, zoom: 9.5 };
  }

  const avgLat = coords.reduce((sum, item) => sum + item.lat, 0) / coords.length;
  const avgLng = coords.reduce((sum, item) => sum + item.lng, 0) / coords.length;
  return { latitude: avgLat, longitude: avgLng, zoom: 10.5 };
}

export function ManagerSupervisionMap({
  points,
  repPresence
}: {
  points: ManagerMapPoint[];
  repPresence: ManagerRepPresenceItem[];
}) {
  const initialView = useMemo(() => deriveCenter(points, repPresence), [points, repPresence]);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(points[0]?.id ?? null);
  const selectedPoint = points.find((point) => point.id === selectedPointId) ?? null;

  return (
    <section className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-5 shadow-panel backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Live Manager Map</div>
          <p className="mt-2 text-sm text-slate-500">
            Recent field activity, who is active right now, and where the team is actually working.
          </p>
        </div>
        <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">
          {repPresence.length} reps active
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.5fr_0.9fr]">
        <div className="relative overflow-hidden rounded-[1.75rem] border border-slate-200 bg-slate-100">
          <div className="h-[24rem]">
            <Map
              initialViewState={initialView}
              mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
              dragRotate={false}
              attributionControl={false}
            >
              <NavigationControl position="top-right" showCompass={false} />

              {points.map((point) => {
                const visual = outcomeStyles(point.outcome);
                const Icon = visual.icon;

                return (
                  <Marker key={point.id} latitude={point.lat} longitude={point.lng} anchor="center">
                    <button
                      type="button"
                      onClick={() => setSelectedPointId(point.id)}
                      className={`flex h-10 w-10 items-center justify-center rounded-full border-2 shadow-lg transition ${
                        selectedPointId === point.id ? "border-ink bg-white scale-110" : "border-white bg-white/95"
                      }`}
                    >
                      <span className={`flex h-5 w-5 items-center justify-center rounded-full ${visual.className}`}>
                        <Icon className="h-3.5 w-3.5" strokeWidth={2.4} />
                      </span>
                    </button>
                  </Marker>
                );
              })}

              {repPresence.map((rep) =>
                rep.lat != null && rep.lng != null ? (
                  <Marker key={`rep-${rep.userId}`} latitude={rep.lat} longitude={rep.lng} anchor="bottom">
                    <div className="flex items-center gap-2 rounded-full border border-white bg-white/95 px-2 py-1 shadow-panel">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink text-[10px] font-bold text-white">
                        {(rep.fullName ?? "R").slice(0, 1).toUpperCase()}
                      </span>
                      <span className="text-[11px] font-semibold text-slate-700">{rep.fullName ?? "Rep"}</span>
                    </div>
                  </Marker>
                ) : null
              )}
            </Map>
          </div>
        </div>

        <div className="grid gap-4">
          <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-mist">Selected Activity</div>
            {selectedPoint ? (
              <div className="mt-3 space-y-2 text-sm text-slate-600">
                <div className="font-semibold text-ink">{selectedPoint.address}</div>
                <div>{selectedPoint.actorName ?? "Unknown rep"}</div>
                <div>{selectedPoint.outcome?.replaceAll("_", " ") ?? "Unknown outcome"}</div>
                <div>{new Date(selectedPoint.capturedAt).toLocaleString()}</div>
              </div>
            ) : (
              <div className="mt-3 text-sm text-slate-500">No recent field activity to preview yet.</div>
            )}
          </div>

          <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-mist">
              <Users className="h-3.5 w-3.5" />
              Rep Presence
            </div>
            <div className="mt-3 space-y-3">
              {repPresence.length ? (
                repPresence.map((rep) => (
                  <div key={rep.userId} className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
                    <div className="text-sm font-semibold text-ink">{rep.fullName ?? "Rep"}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {rep.lastOutcome?.replaceAll("_", " ") ?? "Recent activity"} ·{" "}
                      {rep.lastSeenAt ? new Date(rep.lastSeenAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Unknown"}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-sm text-slate-500">No reps have recent tracked activity yet.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
