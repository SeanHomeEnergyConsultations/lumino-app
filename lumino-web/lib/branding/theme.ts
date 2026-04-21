import type { CSSProperties } from "react";
import type { OrganizationBranding } from "@/types/api";

export const DEFAULT_ORGANIZATION_THEME = {
  appName: "Lumino",
  primaryColor: "#0b1220",
  accentColor: "#94a3b8",
  backgroundColor: "#f4efe6",
  backgroundAccentColor: "#dbe8f6",
  surfaceColor: "#ffffff",
  sidebarColor: "#f6f2ea"
} as const;

export const ORGANIZATION_THEME_PRESETS = [
  {
    id: "titanium-glass",
    label: "Titanium Glass",
    description: "Neutral titanium shell with icy blue highlights and crisp floating controls.",
    theme: {
      primaryColor: "#273241",
      accentColor: "#9fc2df",
      backgroundColor: "#cdd4dc",
      backgroundAccentColor: "#eef3f8",
      surfaceColor: "#fcfdff",
      sidebarColor: "#b9c2cc"
    }
  },
  {
    id: "solar-focused",
    label: "Solar Focused",
    description: "Brushed steel base with warm solar amber highlights and bright frosted controls.",
    theme: {
      primaryColor: "#2f343c",
      accentColor: "#d8a548",
      backgroundColor: "#d4d8dd",
      backgroundAccentColor: "#f4f1e8",
      surfaceColor: "#fffdf8",
      sidebarColor: "#c2c7ce"
    }
  },
  {
    id: "roofing-focused",
    label: "Roofing Focused",
    description: "Slate-metal shell with copper roofing accents and cooler structural depth.",
    theme: {
      primaryColor: "#2a3038",
      accentColor: "#b86c4e",
      backgroundColor: "#c8ced6",
      backgroundAccentColor: "#e8edf2",
      surfaceColor: "#fbfcfe",
      sidebarColor: "#b4bcc7"
    }
  },
  {
    id: "blue-gold",
    label: "Blue and Gold",
    description: "Polished naval metal with deep blue authority and refined gold highlights.",
    theme: {
      primaryColor: "#223553",
      accentColor: "#c7a14c",
      backgroundColor: "#cfd6df",
      backgroundAccentColor: "#edf1f6",
      surfaceColor: "#fffefb",
      sidebarColor: "#bcc6d1"
    }
  }
] as const;

function expandHexColor(input: string) {
  const normalized = input.replace("#", "").trim();
  if (normalized.length === 3) {
    return normalized
      .split("")
      .map((char) => `${char}${char}`)
      .join("");
  }
  return normalized.slice(0, 6);
}

function hexToRgbString(input: string) {
  const expanded = expandHexColor(input);
  const red = Number.parseInt(expanded.slice(0, 2), 16);
  const green = Number.parseInt(expanded.slice(2, 4), 16);
  const blue = Number.parseInt(expanded.slice(4, 6), 16);
  return `${red} ${green} ${blue}`;
}

export function getResolvedOrganizationTheme(branding?: OrganizationBranding | null) {
  return {
    appName: branding?.appName ?? DEFAULT_ORGANIZATION_THEME.appName,
    logoUrl: branding?.logoUrl ?? null,
    primaryColor: branding?.primaryColor ?? DEFAULT_ORGANIZATION_THEME.primaryColor,
    accentColor: branding?.accentColor ?? DEFAULT_ORGANIZATION_THEME.accentColor,
    backgroundColor: branding?.backgroundColor ?? DEFAULT_ORGANIZATION_THEME.backgroundColor,
    backgroundAccentColor:
      branding?.backgroundAccentColor ?? DEFAULT_ORGANIZATION_THEME.backgroundAccentColor,
    surfaceColor: branding?.surfaceColor ?? DEFAULT_ORGANIZATION_THEME.surfaceColor,
    sidebarColor: branding?.sidebarColor ?? DEFAULT_ORGANIZATION_THEME.sidebarColor
  };
}

export function getOrganizationThemeStyle(
  branding?: OrganizationBranding | null
): CSSProperties & Record<string, string> {
  const theme = getResolvedOrganizationTheme(branding);

  return {
    "--app-primary": theme.primaryColor,
    "--app-primary-rgb": hexToRgbString(theme.primaryColor),
    "--app-accent": theme.accentColor,
    "--app-accent-rgb": hexToRgbString(theme.accentColor),
    "--app-background": theme.backgroundColor,
    "--app-background-rgb": hexToRgbString(theme.backgroundColor),
    "--app-background-accent": theme.backgroundAccentColor,
    "--app-background-accent-rgb": hexToRgbString(theme.backgroundAccentColor),
    "--app-surface": theme.surfaceColor,
    "--app-surface-rgb": hexToRgbString(theme.surfaceColor),
    "--app-sidebar": theme.sidebarColor,
    "--app-sidebar-rgb": hexToRgbString(theme.sidebarColor)
  };
}
