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
    description: "Cool metallic shell with icy glass surfaces and a darker control spine.",
    theme: {
      primaryColor: "#1d2738",
      accentColor: "#8db6d9",
      backgroundColor: "#dfe5ec",
      backgroundAccentColor: "#f6f8fb",
      surfaceColor: "#ffffff",
      sidebarColor: "#d7dde6"
    }
  },
  {
    id: "obsidian-chrome",
    label: "Obsidian Chrome",
    description: "Dark brushed-metal control language with sharper silver highlights.",
    theme: {
      primaryColor: "#171b23",
      accentColor: "#c1d4ea",
      backgroundColor: "#ccd3dc",
      backgroundAccentColor: "#eef2f6",
      surfaceColor: "#fbfcfe",
      sidebarColor: "#c4ccd7"
    }
  },
  {
    id: "champagne-fog",
    label: "Champagne Fog",
    description: "Warmer premium shell with satin gold notes and soft frosted surfaces.",
    theme: {
      primaryColor: "#3a2f28",
      accentColor: "#c8a96b",
      backgroundColor: "#efe6db",
      backgroundAccentColor: "#f8fbff",
      surfaceColor: "#fffdfb",
      sidebarColor: "#e7ddd0"
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
