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
    description: "Dark titanium body with a cool steel glow, crisp silver surfaces, and a sharper electric cobalt accent.",
    theme: {
      primaryColor: "#18212b",
      accentColor: "#3d8bff",
      backgroundColor: "#3b4652",
      backgroundAccentColor: "#6f86a4",
      surfaceColor: "#eef3f8",
      sidebarColor: "#c9d4df"
    }
  },
  {
    id: "solar-focused",
    label: "Solar",
    description: "Dark bronze body with a warm amber glow, sunlit alloy surfaces, and brighter honey-gold highlights.",
    theme: {
      primaryColor: "#2d241d",
      accentColor: "#ffb347",
      backgroundColor: "#4a4036",
      backgroundAccentColor: "#d9952f",
      surfaceColor: "#f4eadc",
      sidebarColor: "#cfb79e"
    }
  },
  {
    id: "roofing-focused",
    label: "Roofing",
    description: "Storm-slate body with a heated copper glow, zinc-toned surfaces, and tougher structural contrast.",
    theme: {
      primaryColor: "#242a31",
      accentColor: "#d87952",
      backgroundColor: "#3f4852",
      backgroundAccentColor: "#768392",
      surfaceColor: "#edf1f5",
      sidebarColor: "#c4ccd5"
    }
  },
  {
    id: "green-energy",
    label: "Green Energy",
    description: "Deep evergreen body with a fresh lime pulse, clean mineral surfaces, and brighter sustainability cues.",
    theme: {
      primaryColor: "#163326",
      accentColor: "#61d66f",
      backgroundColor: "#284637",
      backgroundAccentColor: "#3f7c5d",
      surfaceColor: "#eef6ef",
      sidebarColor: "#c8dccd"
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
    description: "Black mirror backdrop with a neon green pulse, smoked metallic framing, and sharp cyber-glass contrast.",
    theme: {
      primaryColor: "#08110b",
      accentColor: "#49ff73",
      backgroundColor: "#050505",
      backgroundAccentColor: "#11331b",
      surfaceColor: "#dce7dd",
      sidebarColor: "#94a89a"
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
  logoScale?: number | null;
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
    logoScale: branding?.logoScale ?? 1,
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
