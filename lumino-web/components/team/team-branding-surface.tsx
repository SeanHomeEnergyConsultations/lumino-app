"use client";

import { ImagePlus, X } from "lucide-react";
import { SquareImageCropDialog } from "@/components/shared/square-image-crop-dialog";
import { useTeamWorkspace } from "@/components/team/team-workspace-context";
import { ORGANIZATION_THEME_PRESETS } from "@/lib/branding/theme";

const brandingFieldClassName = "app-focus-ring w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink";

export function TeamBrandingSurface() {
  const {
    brandName,
    setBrandName,
    logoUrl,
    logoScale,
    setLogoScale,
    logoUploadState,
    logoUploadError,
    logoFileName,
    logoInputKey,
    setLogoInputKey,
    pendingLogoFile,
    setPendingLogoFile,
    primaryColor,
    setPrimaryColor,
    accentColor,
    setAccentColor,
    backgroundColor,
    setBackgroundColor,
    backgroundAccentColor,
    setBackgroundAccentColor,
    surfaceColor,
    setSurfaceColor,
    sidebarColor,
    setSidebarColor,
    selectedThemePresetId,
    setSelectedThemePresetId,
    backgroundTextColor,
    surfaceTextColor,
    sidebarTextColor,
    accentTextColor,
    brandingState,
    clearLogo,
    handleSaveBranding,
    handleCroppedLogo,
    applyThemePreset
  } = useTeamWorkspace();

  return (
    <>
      <section className="mt-6 app-panel rounded-[2rem] border p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Branding</div>
            <p className="mt-2 text-sm text-slate-500">
              Fine-tune the org look after the team, territories, and coaching pieces are in place.
            </p>
          </div>
          <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-700">
            Live preview
          </div>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-[1fr_0.9fr]">
          <div className="space-y-3">
            <div className="space-y-2">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Theme Presets</div>
                <div className="mt-1 text-xs text-slate-500">Apply a metallic base, then fine-tune the shell colors below.</div>
              </div>
              <div className="app-chip rounded-2xl px-3 py-3">
                <select
                  value={selectedThemePresetId}
                  onChange={(event) => {
                    const nextPresetId = event.target.value as "" | (typeof ORGANIZATION_THEME_PRESETS)[number]["id"];
                    setSelectedThemePresetId(nextPresetId);
                    if (nextPresetId) {
                      applyThemePreset(nextPresetId);
                    }
                  }}
                  className={brandingFieldClassName}
                >
                  <option value="">Choose a preset theme</option>
                  {ORGANIZATION_THEME_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
                <div className="mt-2 text-xs text-slate-500">
                  {selectedThemePresetId
                    ? ORGANIZATION_THEME_PRESETS.find((preset) => preset.id === selectedThemePresetId)?.description
                    : "Preset themes give you a fast metallic starting point before you fine-tune colors."}
                </div>
              </div>
            </div>

            <input
              type="text"
              value={brandName}
              onChange={(event) => setBrandName(event.target.value)}
              placeholder="Organization name"
              className={brandingFieldClassName}
            />

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Logo</div>
              <div className="mt-3 flex items-center gap-4">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logoUrl}
                    alt={`${brandName} logo preview`}
                    className="h-20 w-20 rounded-[1.4rem] border border-slate-200 object-contain"
                    style={{ transform: `scale(${logoScale})` }}
                  />
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded-[1.4rem] border border-dashed border-slate-300 bg-slate-50 text-slate-400">
                    <ImagePlus className="h-5 w-5" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-ink">
                    {logoFileName ?? "Upload a logo from your phone or computer"}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">PNG, JPG, or other image formats up to 10 MB.</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800">
                      <ImagePlus className="h-4 w-4" />
                      {logoUrl ? "Replace Logo" : "Upload Logo"}
                      <input
                        key={logoInputKey}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (!file) return;
                          setPendingLogoFile(file);
                        }}
                      />
                    </label>
                    {logoUrl ? (
                      <button
                        type="button"
                        onClick={clearLogo}
                        className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                      >
                        <X className="h-4 w-4" />
                        Remove
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
              {logoUploadState === "uploading" ? (
                <div className="mt-3 text-xs font-semibold uppercase tracking-[0.16em] text-[rgba(var(--app-accent-rgb),0.8)]">
                  Uploading logo...
                </div>
              ) : null}
              {logoUploadError ? (
                <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
                  {logoUploadError}
                </div>
              ) : null}
              <div className="mt-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Logo Size</div>
                  <div className="text-xs text-slate-500">{Math.round(logoScale * 100)}%</div>
                </div>
                <input
                  type="range"
                  min="0.4"
                  max="1.6"
                  step="0.05"
                  value={logoScale}
                  onChange={(event) => setLogoScale(Number(event.target.value))}
                  className="mt-3 w-full accent-[var(--app-primary)]"
                />
                <div className="mt-1 text-xs text-slate-500">Slide to shrink or enlarge the logo inside the badge.</div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="app-chip rounded-2xl px-3 py-2 text-sm text-slate-600">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Primary</span>
                <input
                  type="color"
                  value={primaryColor}
                  onChange={(event) => setPrimaryColor(event.target.value)}
                  className="app-color-swatch rounded-xl"
                />
              </label>
              <label className="app-chip rounded-2xl px-3 py-2 text-sm text-slate-600">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Accent</span>
                <input
                  type="color"
                  value={accentColor}
                  onChange={(event) => setAccentColor(event.target.value)}
                  className="app-color-swatch rounded-xl"
                />
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="app-chip rounded-2xl px-3 py-2 text-sm text-slate-600">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Background</span>
                <input
                  type="color"
                  value={backgroundColor}
                  onChange={(event) => setBackgroundColor(event.target.value)}
                  className="app-color-swatch rounded-xl"
                />
              </label>
              <label className="app-chip rounded-2xl px-3 py-2 text-sm text-slate-600">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Background Glow</span>
                <input
                  type="color"
                  value={backgroundAccentColor}
                  onChange={(event) => setBackgroundAccentColor(event.target.value)}
                  className="app-color-swatch rounded-xl"
                />
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="app-chip rounded-2xl px-3 py-2 text-sm text-slate-600">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Surface</span>
                <input
                  type="color"
                  value={surfaceColor}
                  onChange={(event) => setSurfaceColor(event.target.value)}
                  className="app-color-swatch rounded-xl"
                />
              </label>
              <label className="app-chip rounded-2xl px-3 py-2 text-sm text-slate-600">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Sidebar</span>
                <input
                  type="color"
                  value={sidebarColor}
                  onChange={(event) => setSidebarColor(event.target.value)}
                  className="app-color-swatch rounded-xl"
                />
              </label>
            </div>

            <button
              type="button"
              onClick={() => void handleSaveBranding()}
              disabled={!brandName.trim() || brandingState === "saving" || logoUploadState === "uploading"}
              className="app-primary-button rounded-2xl px-4 py-2.5 text-sm font-semibold transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {brandingState === "saving" ? "Saving..." : "Save Branding"}
            </button>
          </div>

          <div
            className="overflow-hidden rounded-3xl border border-slate-200 p-4"
            style={{
              background: `radial-gradient(circle at 18% 0%, ${accentColor}52, transparent 24%), radial-gradient(circle at 82% 100%, ${primaryColor}3d, transparent 28%), linear-gradient(180deg, ${backgroundColor} 0%, ${backgroundAccentColor} 100%)`
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: backgroundTextColor }}>
                Shell preview
              </div>
              <div
                className="rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]"
                style={{
                  borderColor: `${surfaceColor}90`,
                  backgroundColor: `${surfaceColor}2e`,
                  color: backgroundTextColor
                }}
              >
                Live feel
              </div>
            </div>
            <div className="mt-3 overflow-hidden rounded-[2rem] border shadow-[0_28px_60px_rgba(15,23,42,0.18)]" style={{ borderColor: `${surfaceColor}8a` }}>
              <div className="grid min-h-[22rem] grid-cols-[0.92fr_1.35fr]">
                <div
                  className="relative overflow-hidden border-r px-4 py-4"
                  style={{
                    background: `linear-gradient(180deg, ${sidebarColor} 0%, ${backgroundColor} 100%)`,
                    borderColor: `${surfaceColor}60`,
                    color: sidebarTextColor
                  }}
                >
                  <div className="absolute inset-x-0 top-0 h-24 opacity-60" style={{ background: `radial-gradient(circle at top, ${accentColor}50, transparent 70%)` }} />
                  <div className="relative flex items-center gap-3">
                    <div
                      className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-[1.1rem] border text-sm font-semibold shadow-[0_12px_24px_rgba(15,23,42,0.14)]"
                      style={{
                        borderColor: `${surfaceColor}70`,
                        backgroundColor: `${surfaceColor}ea`,
                        color: primaryColor
                      }}
                    >
                      {logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={logoUrl}
                          alt={`${brandName} logo`}
                          className="h-full w-full object-contain"
                          style={{ transform: `scale(${logoScale})` }}
                        />
                      ) : (
                        brandName
                          .split(/\s+/)
                          .map((part) => part[0])
                          .join("")
                          .slice(0, 2)
                          .toUpperCase() || "LU"
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: accentColor }}>
                        {brandName}
                      </div>
                      <div className="truncate text-sm font-semibold" style={{ color: sidebarTextColor }}>
                        Field CRM
                      </div>
                    </div>
                  </div>

                  <div className="relative mt-5 space-y-2">
                    {[
                      { label: "Dashboard", active: true },
                      { label: "Follow Up", active: false },
                      { label: "Map", active: false },
                      { label: "Appointments", active: false }
                    ].map((item) => (
                      <div
                        key={item.label}
                        className="rounded-2xl px-3 py-2.5 text-sm font-medium transition"
                        style={
                          item.active
                            ? {
                                background: `linear-gradient(135deg, ${primaryColor} 0%, ${accentColor} 100%)`,
                                color: accentTextColor,
                                boxShadow: "0 14px 28px rgba(15,23,42,0.16)"
                              }
                            : {
                                backgroundColor: `${surfaceColor}20`,
                                color: sidebarTextColor,
                                border: `1px solid ${surfaceColor}22`
                              }
                        }
                      >
                        {item.label}
                      </div>
                    ))}
                  </div>

                  <div
                    className="relative mt-5 rounded-[1.4rem] border px-3 py-3"
                    style={{
                      borderColor: `${surfaceColor}40`,
                      backgroundColor: `${surfaceColor}16`
                    }}
                  >
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: accentColor }}>
                      Coaching cue
                    </div>
                    <div className="mt-2 text-sm font-semibold" style={{ color: sidebarTextColor }}>
                      Best window today: 4:30–6:30 PM
                    </div>
                  </div>
                </div>

                <div
                  className="px-4 py-4"
                  style={{
                    background: `linear-gradient(180deg, ${surfaceColor}f3 0%, ${surfaceColor}de 100%)`,
                    color: surfaceTextColor
                  }}
                >
                  <div className="flex items-center justify-between gap-3 rounded-[1.5rem] border px-4 py-3" style={{ borderColor: `${primaryColor}14`, backgroundColor: `${surfaceColor}bc` }}>
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: accentColor }}>
                        Today
                      </div>
                      <div className="mt-1 text-base font-semibold" style={{ color: surfaceTextColor }}>
                        Knocks, appointments, and follow-up all in one place
                      </div>
                    </div>
                    <div
                      className="rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]"
                      style={{
                        backgroundColor: `${accentColor}22`,
                        color: primaryColor
                      }}
                    >
                      Live
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    {[
                      { label: "Knocks", value: "42" },
                      { label: "Opportunities", value: "11" },
                      { label: "Appointments", value: "4" }
                    ].map((item) => (
                      <div
                        key={item.label}
                        className="rounded-[1.4rem] border px-3 py-3"
                        style={{
                          borderColor: `${primaryColor}12`,
                          backgroundColor: `${backgroundColor}12`
                        }}
                      >
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: accentColor }}>
                          {item.label}
                        </div>
                        <div className="mt-2 text-2xl font-semibold" style={{ color: surfaceTextColor }}>
                          {item.value}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div
                    className="mt-4 rounded-[1.6rem] border p-4"
                    style={{
                      borderColor: `${primaryColor}14`,
                      backgroundColor: `${sidebarColor}24`
                    }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: accentColor }}>
                          Follow Up
                        </div>
                        <div className="mt-1 text-sm font-semibold" style={{ color: surfaceTextColor }}>
                          7 leads need attention before end of day
                        </div>
                      </div>
                      <div
                        className="rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]"
                        style={{
                          backgroundColor: `${accentColor}22`,
                          color: primaryColor
                        }}
                      >
                        Due now
                      </div>
                    </div>
                    <div className="mt-4 space-y-2">
                      {[
                        "Warm lead needs call back",
                        "Appointment reminder pending",
                        "Neighborhood revisit window opens"
                      ].map((item, index) => (
                        <div
                          key={item}
                          className="flex items-center justify-between gap-3 rounded-2xl border px-3 py-2"
                          style={{
                            borderColor: `${primaryColor}12`,
                            backgroundColor: index === 0 ? `${accentColor}12` : `${surfaceColor}8a`
                          }}
                        >
                          <div className="text-sm font-medium" style={{ color: surfaceTextColor }}>
                            {item}
                          </div>
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: accentColor }}>
                            {index === 0 ? "Priority" : "Queued"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <SquareImageCropDialog
        file={pendingLogoFile}
        open={Boolean(pendingLogoFile)}
        title="Crop logo"
        onCancel={() => {
          setPendingLogoFile(null);
          setLogoInputKey((current) => current + 1);
        }}
        onConfirm={(file) => {
          void handleCroppedLogo(file);
        }}
      />
    </>
  );
}
