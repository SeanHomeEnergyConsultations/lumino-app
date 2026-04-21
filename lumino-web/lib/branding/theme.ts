import type { CSSProperties } from "react";

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
    description: "Cool titanium body with a pale steel sidebar, brighter alloy surfaces, and icy blue glass highlights.",
    theme: {
      primaryColor: "#273241",
      accentColor: "#9fc2df",
      backgroundColor: "#aeb7c1",
      backgroundAccentColor: "#edf5fb",
      surfaceColor: "#f8fbff",
      sidebarColor: "#c2cbd5"
    }
  },
  {
    id: "solar-focused",
    label: "Solar Focused",
    description: "Sun-warmed brushed metal with a champagne glow, bright ivory surfaces, and amber glass accents.",
    theme: {
      primaryColor: "#2f343c",
      accentColor: "#d8a548",
      backgroundColor: "#bbb7af",
      backgroundAccentColor: "#f5e7c7",
      surfaceColor: "#fffaf1",
      sidebarColor: "#cbc2b7"
    }
  },
  {
    id: "roofing-focused",
    label: "Roofing Focused",
    description: "Slate-and-zinc base with weathered copper glow, cooler silver surfaces, and tougher structural contrast.",
    theme: {
      primaryColor: "#2a3038",
      accentColor: "#b86c4e",
      backgroundColor: "#9ea7b3",
      backgroundAccentColor: "#d9e0e8",
      surfaceColor: "#eef2f6",
      sidebarColor: "#b0bac5"
    }
  },
  {
    id: "blue-gold",
    label: "Blue and Gold",
    description: "Naval metal body with a deep sapphire glow, pale brass-tinted surfaces, and refined gold glass accents.",
    theme: {
      primaryColor: "#223553",
      accentColor: "#c7a14c",
      backgroundColor: "#98a8bb",
      backgroundAccentColor: "#d8e4f2",
      surfaceColor: "#faf7ef",
      sidebarColor: "#b7c1cd"
    }
  },
  {
    id: "midnight-glass",
    label: "Midnight Glass",
    description: "Dark alloy backdrop with a cool midnight glow, brighter metallic surfaces, and crisp blue-white glass controls.",
    theme: {
      primaryColor: "#d7e4f5",
      accentColor: "#78b7ff",
      backgroundColor: "#232a33",
      backgroundAccentColor: "#3b4c64",
      surfaceColor: "#cbd4de",
      sidebarColor: "#8d99a8"
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
  return `${red}, ${green}, ${blue}`;
}

type BrandingThemeInput = {
  appName?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  backgroundColor?: string | null;
  backgroundAccentColor?: string | null;
  surfaceColor?: string | null;
  sidebarColor?: string | null;
} | null | undefined;

export function getResolvedOrganizationTheme(branding?: BrandingThemeInput) {
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

export function getOrganizationThemeVariables(branding?: BrandingThemeInput): Record<string, string> {
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

export function getOrganizationThemeStyle(
  branding?: BrandingThemeInput
): CSSProperties & Record<string, string> {
  return getOrganizationThemeVariables(branding);
}
