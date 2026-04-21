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
    description: "Dark gunmetal body with a cold steel glow, pale titanium surfaces, and icy blue glass highlights.",
    theme: {
      primaryColor: "#1f2b38",
      accentColor: "#9fd4ff",
      backgroundColor: "#454f5b",
      backgroundAccentColor: "#8ca7c4",
      surfaceColor: "#e0e7ef",
      sidebarColor: "#afbbc8"
    }
  },
  {
    id: "solar-focused",
    label: "Solar Focused",
    description: "Dark bronze-metal body with a solar amber glow, warm alloy surfaces, and brighter honeyed glass accents.",
    theme: {
      primaryColor: "#2d241d",
      accentColor: "#ffb347",
      backgroundColor: "#51453a",
      backgroundAccentColor: "#e4a03a",
      surfaceColor: "#ece2d2",
      sidebarColor: "#bba894"
    }
  },
  {
    id: "roofing-focused",
    label: "Roofing Focused",
    description: "Storm-slate body with a heated copper glow, silver-zinc surfaces, and sharper structural contrast.",
    theme: {
      primaryColor: "#242a31",
      accentColor: "#d87952",
      backgroundColor: "#47505a",
      backgroundAccentColor: "#8b97a5",
      surfaceColor: "#dde3ea",
      sidebarColor: "#aab4c0"
    }
  },
  {
    id: "blue-gold",
    label: "Blue and Gold",
    description: "Deep naval body with a sapphire glow, pale brass surfaces, and bolder gold glass accents.",
    theme: {
      primaryColor: "#162844",
      accentColor: "#e0b84b",
      backgroundColor: "#24374e",
      backgroundAccentColor: "#4d6f95",
      surfaceColor: "#e7dfcf",
      sidebarColor: "#aeb8c5"
    }
  },
  {
    id: "midnight-glass",
    label: "Midnight Glass",
    description: "Black mirror backdrop with electric neon glow, bright metallic surfaces, and vivid cyber-glass controls.",
    theme: {
      primaryColor: "#101828",
      accentColor: "#00f5ff",
      backgroundColor: "#050505",
      backgroundAccentColor: "#ff00b8",
      surfaceColor: "#d6dfeb",
      sidebarColor: "#8fa0b7"
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
