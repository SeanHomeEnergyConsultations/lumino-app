"use client";

import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { qrFieldClass, qrTextAreaClass, useQrWorkspace, WEEKDAY_CHOICES } from "@/components/qr/qr-workspace-context";
import type { QRBookingTypeConfig } from "@/types/api";

export function QrBookingProfileSurface() {
  const {
    addBookingType,
    availabilityEndTime,
    availabilityMaxDaysOut,
    availabilityMinNoticeHours,
    availabilityStartTime,
    availabilityTimezone,
    availabilityWorkingDays,
    bookingProfileMessage,
    bookingProfileState,
    bookingTypes,
    expandedBookingTypeIds,
    removeBookingType,
    saveBookingProfile,
    setAvailabilityEndTime,
    setAvailabilityMaxDaysOut,
    setAvailabilityMinNoticeHours,
    setAvailabilityStartTime,
    setAvailabilityTimezone,
    setAvailabilityWorkingDays,
    toggleBookingTypeExpanded,
    updateBookingType
  } = useQrWorkspace();

  return (
    <section className="app-panel rounded-[2rem] border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Booking Profile</div>
          <div className="mt-1 text-xl font-semibold text-ink">Create your reusable appointment options once</div>
          <div className="mt-2 max-w-3xl text-sm text-[rgba(var(--app-primary-rgb),0.62)]">
            Define working hours and appointment types here. Then every QR card simply picks which saved options to offer.
          </div>
        </div>
        <button
          type="button"
          onClick={() => void saveBookingProfile()}
          disabled={bookingProfileState === "saving"}
          className="rounded-2xl bg-[rgba(var(--app-primary-rgb),0.96)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-92 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {bookingProfileState === "saving" ? "Saving..." : "Save Booking Profile"}
        </button>
      </div>

      {bookingProfileMessage ? (
        <div
          className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${
            bookingProfileState === "error"
              ? "border-rose-200 bg-rose-50 text-rose-900"
              : "border-emerald-200 bg-emerald-50 text-emerald-900"
          }`}
        >
          {bookingProfileMessage}
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 xl:grid-cols-[320px_1fr]">
        <div className="rounded-[1.6rem] border border-[rgba(var(--app-primary-rgb),0.08)] bg-[rgba(var(--app-surface-rgb),0.5)] p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Working Hours</div>
          <div className="mt-2 text-sm text-[rgba(var(--app-primary-rgb),0.62)]">
            Homeowners will only see open slots inside these days and hours.
          </div>

          <div className="mt-4 space-y-4">
            <label className="block space-y-2">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Timezone</div>
              <input
                value={availabilityTimezone}
                onChange={(event) => setAvailabilityTimezone(event.target.value)}
                placeholder="America/New_York"
                className={qrFieldClass}
              />
            </label>

            <div className="grid grid-cols-2 gap-4">
              <label className="block space-y-2">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Start</div>
                <input
                  type="time"
                  value={availabilityStartTime}
                  onChange={(event) => setAvailabilityStartTime(event.target.value)}
                  className={qrFieldClass}
                />
              </label>
              <label className="block space-y-2">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">End</div>
                <input
                  type="time"
                  value={availabilityEndTime}
                  onChange={(event) => setAvailabilityEndTime(event.target.value)}
                  className={qrFieldClass}
                />
              </label>
            </div>

            <label className="block space-y-2">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Minimum notice</div>
              <select
                value={availabilityMinNoticeHours}
                onChange={(event) => setAvailabilityMinNoticeHours(Number(event.target.value))}
                className={qrFieldClass}
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
                className={qrFieldClass}
              >
                {[7, 10, 14, 21, 30].map((days) => (
                  <option key={days} value={days}>
                    {days} days
                  </option>
                ))}
              </select>
            </label>

            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Working days</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {WEEKDAY_CHOICES.map((day) => {
                  const active = availabilityWorkingDays.includes(day.value);
                  return (
                    <button
                      key={day.value}
                      type="button"
                      aria-pressed={active}
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
          </div>
        </div>

        <div className="rounded-[1.6rem] border border-[rgba(var(--app-primary-rgb),0.08)] bg-[rgba(var(--app-surface-rgb),0.5)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Appointment Library</div>
              <div className="mt-2 text-sm text-[rgba(var(--app-primary-rgb),0.62)]">
                Build as many reusable appointment presets as you need, then collapse the ones you are not editing.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => addBookingType("phone_call")}
                className="inline-flex items-center gap-2 rounded-2xl border border-[rgba(var(--app-primary-rgb),0.12)] bg-white px-3 py-2 text-sm font-semibold text-ink transition hover:border-[rgba(var(--app-primary-rgb),0.2)]"
              >
                <Plus className="h-4 w-4" />
                Phone-Style
              </button>
              <button
                type="button"
                onClick={() => addBookingType("in_person_consult")}
                className="inline-flex items-center gap-2 rounded-2xl border border-[rgba(var(--app-primary-rgb),0.12)] bg-white px-3 py-2 text-sm font-semibold text-ink transition hover:border-[rgba(var(--app-primary-rgb),0.2)]"
              >
                <Plus className="h-4 w-4" />
                In-Person
              </button>
            </div>
          </div>

          <div className="mt-4 space-y-4">
            {bookingTypes.map((bookingType) => {
              const expanded = expandedBookingTypeIds.includes(bookingType.id);
              return (
                <div
                  key={bookingType.id}
                  className="rounded-[1.4rem] border border-[rgba(var(--app-primary-rgb),0.08)] bg-white/80 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => toggleBookingTypeExpanded(bookingType.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <div className="rounded-full border border-[rgba(var(--app-primary-rgb),0.08)] bg-[rgba(var(--app-surface-rgb),0.45)] p-2 text-[rgba(var(--app-primary-rgb),0.72)]">
                        <ChevronDown className={`h-4 w-4 transition ${expanded ? "rotate-180" : ""}`} />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-ink">{bookingType.label}</div>
                        <div className="mt-1 text-xs text-[rgba(var(--app-primary-rgb),0.58)]">
                          {bookingType.type === "phone_call" ? "Phone-style preset" : "In-person preset"} ·{" "}
                          {bookingType.durationMinutes} min
                        </div>
                      </div>
                    </button>

                    <div className="flex items-center gap-3">
                      <label className="inline-flex items-center gap-2 text-sm font-medium text-ink">
                        Enabled
                        <input
                          type="checkbox"
                          checked={bookingType.enabled}
                          onChange={(event) =>
                            updateBookingType(bookingType.id, (current) => ({
                              ...current,
                              enabled: event.target.checked
                            }))
                          }
                          className="h-4 w-4 rounded border-slate-300"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => removeBookingType(bookingType.id)}
                        disabled={bookingTypes.length <= 1}
                        className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 px-3 py-2 text-sm text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Trash2 className="h-4 w-4" />
                        Remove
                      </button>
                    </div>
                  </div>

                  {expanded ? (
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <label className="block space-y-2">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Public Name</div>
                        <input
                          value={bookingType.label}
                          onChange={(event) =>
                            updateBookingType(bookingType.id, (current) => ({
                              ...current,
                              label: event.target.value
                            }))
                          }
                          className={qrFieldClass}
                        />
                      </label>

                      <label className="block space-y-2">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Style</div>
                        <select
                          value={bookingType.type}
                          onChange={(event) =>
                            updateBookingType(bookingType.id, (current) => ({
                              ...current,
                              type: event.target.value as QRBookingTypeConfig["type"]
                            }))
                          }
                          className={qrFieldClass}
                        >
                          <option value="phone_call">Phone-Style</option>
                          <option value="in_person_consult">In-Person</option>
                        </select>
                      </label>

                      <label className="block space-y-2">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Length (minutes)</div>
                        <input
                          type="number"
                          min={10}
                          max={180}
                          value={bookingType.durationMinutes}
                          onChange={(event) =>
                            updateBookingType(bookingType.id, (current) => ({
                              ...current,
                              durationMinutes: Number(event.target.value || 0)
                            }))
                          }
                          className={qrFieldClass}
                        />
                      </label>

                      <label className="block space-y-2">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Slot Step</div>
                        <input
                          type="number"
                          min={10}
                          max={60}
                          value={bookingType.slotStepMinutes}
                          onChange={(event) =>
                            updateBookingType(bookingType.id, (current) => ({
                              ...current,
                              slotStepMinutes: Number(event.target.value || 0)
                            }))
                          }
                          className={qrFieldClass}
                        />
                      </label>

                      <label className="block space-y-2 md:col-span-2">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Brief Description</div>
                        <input
                          value={bookingType.shortDescription ?? ""}
                          onChange={(event) =>
                            updateBookingType(bookingType.id, (current) => ({
                              ...current,
                              shortDescription: event.target.value
                            }))
                          }
                          placeholder="A short summary shown on the booking page."
                          className={qrFieldClass}
                        />
                      </label>

                      <label className="block space-y-2 md:col-span-2">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Full Description</div>
                        <textarea
                          value={bookingType.fullDescription ?? ""}
                          onChange={(event) =>
                            updateBookingType(bookingType.id, (current) => ({
                              ...current,
                              fullDescription: event.target.value
                            }))
                          }
                          placeholder="Shown after the homeowner clicks into this appointment type."
                          className={qrTextAreaClass}
                        />
                      </label>

                      <label className="block space-y-2">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Pre Buffer</div>
                        <input
                          type="number"
                          min={0}
                          max={240}
                          value={bookingType.preBufferMinutes}
                          onChange={(event) =>
                            updateBookingType(bookingType.id, (current) => ({
                              ...current,
                              preBufferMinutes: Number(event.target.value || 0)
                            }))
                          }
                          className={qrFieldClass}
                        />
                      </label>

                      <label className="block space-y-2">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Post Buffer</div>
                        <input
                          type="number"
                          min={0}
                          max={240}
                          value={bookingType.postBufferMinutes}
                          onChange={(event) =>
                            updateBookingType(bookingType.id, (current) => ({
                              ...current,
                              postBufferMinutes: Number(event.target.value || 0)
                            }))
                          }
                          className={qrFieldClass}
                        />
                      </label>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="mt-4 rounded-[1.2rem] border border-[rgba(var(--app-primary-rgb),0.08)] bg-white/80 px-4 py-3 text-xs text-[rgba(var(--app-primary-rgb),0.62)]">
            QR cards won’t need to recreate any of this. They’ll just choose which saved appointment options to include for that homeowner.
          </div>
        </div>
      </div>
    </section>
  );
}
