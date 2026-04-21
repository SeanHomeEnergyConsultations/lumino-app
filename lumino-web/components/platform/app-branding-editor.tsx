"use client";

import { useEffect, useMemo, useState } from "react";
import type { AppBrandingResponse } from "@/types/api";
import { authFetch, useAuth } from "@/lib/auth/client";
import { DEFAULT_ORGANIZATION_THEME, getOrganizationThemeStyle, ORGANIZATION_THEME_PRESETS } from "@/lib/branding/theme";

export function AppBrandingEditor() {
  const { session, appContext, appBranding, refreshAppBranding } = useAuth();
  const canEdit = Boolean(appContext?.isPlatformOwner);
  const [appName, setAppName] = useState<string>(DEFAULT_ORGANIZATION_THEME.appName);
  const [logoUrl, setLogoUrl] = useState("");
  const [primaryColor, setPrimaryColor] = useState<string>(DEFAULT_ORGANIZATION_THEME.primaryColor);
  const [accentColor, setAccentColor] = useState<string>(DEFAULT_ORGANIZATION_THEME.accentColor);
  const [backgroundColor, setBackgroundColor] = useState<string>(DEFAULT_ORGANIZATION_THEME.backgroundColor);
  const [backgroundAccentColor, setBackgroundAccentColor] = useState<string>(
    DEFAULT_ORGANIZATION_THEME.backgroundAccentColor
  );
  const [surfaceColor, setSurfaceColor] = useState<string>(DEFAULT_ORGANIZATION_THEME.surfaceColor);
  const [sidebarColor, setSidebarColor] = useState<string>(DEFAULT_ORGANIZATION_THEME.sidebarColor);
  const [selectedThemePresetId, setSelectedThemePresetId] = useState<
    "" | (typeof ORGANIZATION_THEME_PRESETS)[number]["id"]
  >("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!appBranding) return;
    setAppName(appBranding.appName || DEFAULT_ORGANIZATION_THEME.appName);
    setLogoUrl(appBranding.logoUrl || "");
    setPrimaryColor(appBranding.primaryColor || DEFAULT_ORGANIZATION_THEME.primaryColor);
    setAccentColor(appBranding.accentColor || DEFAULT_ORGANIZATION_THEME.accentColor);
    setBackgroundColor(appBranding.backgroundColor || DEFAULT_ORGANIZATION_THEME.backgroundColor);
    setBackgroundAccentColor(
      appBranding.backgroundAccentColor || DEFAULT_ORGANIZATION_THEME.backgroundAccentColor
    );
    setSurfaceColor(appBranding.surfaceColor || DEFAULT_ORGANIZATION_THEME.surfaceColor);
    setSidebarColor(appBranding.sidebarColor || DEFAULT_ORGANIZATION_THEME.sidebarColor);
    setSelectedThemePresetId("");
  }, [appBranding]);

  const previewBranding = useMemo(
    () => ({
      appName,
      logoUrl,
      primaryColor,
      accentColor,
      backgroundColor,
      backgroundAccentColor,
      surfaceColor,
      sidebarColor
    }),
    [accentColor, appName, backgroundAccentColor, backgroundColor, logoUrl, primaryColor, sidebarColor, surfaceColor]
  );

  function applyThemePreset(
    preset: (typeof ORGANIZATION_THEME_PRESETS)[number]
  ) {
    setSelectedThemePresetId(preset.id);
    setPrimaryColor(preset.theme.primaryColor);
    setAccentColor(preset.theme.accentColor);
    setBackgroundColor(preset.theme.backgroundColor);
    setBackgroundAccentColor(preset.theme.backgroundAccentColor);
    setSurfaceColor(preset.theme.surfaceColor);
    setSidebarColor(preset.theme.sidebarColor);
  }

  async function handleSave() {
    if (!session?.access_token || !canEdit) return;
    setSaveState("saving");
    setMessage(null);

    try {
      const response = await authFetch(session.access_token, "/api/app/branding", {
        method: "PATCH",
        body: JSON.stringify({
          appName: appName.trim(),
          logoUrl: logoUrl.trim(),
          primaryColor: primaryColor.trim(),
          accentColor: accentColor.trim(),
          backgroundColor: backgroundColor.trim(),
          backgroundAccentColor: backgroundAccentColor.trim(),
          surfaceColor: surfaceColor.trim(),
          sidebarColor: sidebarColor.trim()
        })
      });
      const json = (await response.json()) as AppBrandingResponse | { error?: string };
      if (!response.ok) {
        throw new Error("error" in json && json.error ? json.error : "Could not save app branding.");
      }
      await refreshAppBranding();
      setSaveState("saved");
      setMessage("Saved the live app brand.");
    } catch (error) {
      setSaveState("error");
      setMessage(error instanceof Error ? error.message : "Could not save app branding.");
    }
  }

  return (
    <section className="app-panel rounded-[2rem] border p-6">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="max-w-2xl">
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-mist">App Branding</div>
          <h2 className="mt-3 text-2xl font-semibold text-ink">Live app brand source of truth</h2>
          <p className="mt-2 text-sm text-[rgba(var(--app-primary-rgb),0.72)]">
            This controls the real app shell, logo, name, and theme for every organization. Org branding can stay as a future override layer, but this is the platform-wide brand that the live app follows now.
          </p>
          {message ? (
            <div
              className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${
                saveState === "error"
                  ? "border-rose-200 bg-rose-50 text-rose-700"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700"
              }`}
            >
              {message}
            </div>
          ) : null}
        </div>

        <div className="app-chip inline-flex rounded-full px-4 py-2 text-sm font-semibold text-[rgba(var(--app-primary-rgb),0.72)]">
          {canEdit ? "Platform owner can edit" : "Read only"}
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4">
          <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-[rgba(var(--app-primary-rgb),0.58)]">
            Theme preset
            <select
              value={selectedThemePresetId}
              onChange={(event) => {
                const preset = ORGANIZATION_THEME_PRESETS.find((item) => item.id === event.target.value);
                if (preset) {
                  applyThemePreset(preset);
                } else {
                  setSelectedThemePresetId("");
                }
              }}
              disabled={!canEdit}
              className="app-glass-input mt-2 w-full rounded-2xl px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink outline-none transition focus:border-ink disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="">Custom current theme</option>
              {ORGANIZATION_THEME_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-[rgba(var(--app-primary-rgb),0.58)] md:col-span-2">
              App name
              <input
                value={appName}
                onChange={(event) => setAppName(event.target.value)}
                disabled={!canEdit}
                className="app-glass-input mt-2 w-full rounded-2xl px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink outline-none transition focus:border-ink disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>
            <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-[rgba(var(--app-primary-rgb),0.58)] md:col-span-2">
              Logo URL
              <input
                value={logoUrl}
                onChange={(event) => setLogoUrl(event.target.value)}
                disabled={!canEdit}
                placeholder="https://..."
                className="app-glass-input mt-2 w-full rounded-2xl px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink outline-none transition focus:border-ink disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>
            {[
              { label: "Primary", value: primaryColor, setValue: setPrimaryColor },
              { label: "Accent", value: accentColor, setValue: setAccentColor },
              { label: "Background", value: backgroundColor, setValue: setBackgroundColor },
              {
                label: "Background glow",
                value: backgroundAccentColor,
                setValue: setBackgroundAccentColor
              },
              { label: "Surface", value: surfaceColor, setValue: setSurfaceColor },
              { label: "Sidebar", value: sidebarColor, setValue: setSidebarColor }
            ].map((field) => (
              <label
                key={field.label}
                className="block text-xs font-semibold uppercase tracking-[0.14em] text-[rgba(var(--app-primary-rgb),0.58)]"
              >
                {field.label}
                <div className="mt-2 flex items-center gap-3">
                  <input
                    type="color"
                    value={field.value}
                    onChange={(event) => field.setValue(event.target.value)}
                    disabled={!canEdit}
                    className="app-color-swatch h-11 w-14 rounded-2xl border border-[rgba(var(--app-primary-rgb),0.12)] p-1 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <input
                    value={field.value}
                    onChange={(event) => field.setValue(event.target.value)}
                    disabled={!canEdit}
                    className="app-glass-input w-full rounded-2xl px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink outline-none transition focus:border-ink disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>
              </label>
            ))}
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!canEdit || saveState === "saving"}
              className="app-primary-button rounded-2xl px-4 py-2.5 text-sm font-semibold transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saveState === "saving" ? "Saving..." : "Save Live App Brand"}
            </button>
          </div>
        </div>

        <div className="app-panel-soft overflow-hidden rounded-[1.75rem] border p-3" style={getOrganizationThemeStyle(previewBranding)}>
          <div
            className="rounded-[1.5rem] border border-[rgba(var(--app-primary-rgb),0.12)]"
            style={{
              background:
                "radial-gradient(circle at 14% 0%, rgba(255,255,255,0.24), transparent 20%), radial-gradient(circle at 88% 8%, rgba(var(--app-accent-rgb),0.18), transparent 24%), linear-gradient(180deg, rgba(var(--app-primary-rgb),0.08), rgba(var(--app-primary-rgb),0.01)), linear-gradient(180deg, var(--app-background) 0%, var(--app-background-accent) 100%)"
            }}
          >
            <div className="flex items-center justify-between border-b border-[rgba(var(--app-primary-rgb),0.08)] px-4 py-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: accentColor }}>
                  {appName}
                </div>
                <div className="mt-1 text-sm font-semibold text-ink">Metal base with floating glass</div>
              </div>
              <div className="app-glass-button rounded-full px-3 py-1 text-xs font-semibold text-[rgba(var(--app-primary-rgb),0.72)]">
                Preview
              </div>
            </div>

            <div className="grid min-h-[20rem] gap-0 md:grid-cols-[13rem_1fr]">
              <div className="border-r border-[rgba(var(--app-primary-rgb),0.08)] p-4" style={{ backgroundColor: "rgba(var(--app-sidebar-rgb),0.78)" }}>
                <div className="space-y-2">
                  {["Map", "Queue", "Leads", "Dashboard"].map((label, index) => (
                    <div
                      key={label}
                      className={`rounded-2xl px-3 py-2 text-sm font-medium ${
                        index === 0 ? "text-white" : "text-ink"
                      }`}
                      style={index === 0 ? { backgroundColor: primaryColor } : { backgroundColor: "rgba(var(--app-surface-rgb),0.44)" }}
                    >
                      {label}
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-4 p-4">
                <div className="app-panel rounded-[1.4rem] border p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-mist">Shell</div>
                  <div className="mt-2 text-lg font-semibold text-ink">Platform brand preview</div>
                  <div className="mt-2 text-sm text-[rgba(var(--app-primary-rgb),0.72)]">
                    Large surfaces should feel metallic, while controls and buttons should float like glass.
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  <div className="app-primary-button rounded-2xl px-4 py-2 text-sm font-semibold">Primary action</div>
                  <div className="app-glass-button rounded-2xl px-4 py-2 text-sm font-semibold text-ink">Glass action</div>
                  <div className="app-chip rounded-full px-3 py-1 text-xs font-semibold text-[rgba(var(--app-primary-rgb),0.72)]">Status chip</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
