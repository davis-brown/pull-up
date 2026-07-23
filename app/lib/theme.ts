// pull-up design system.
//
// Single source of truth for color, spacing, radius, type, shadows, and
// fonts. Components never hardcode values — they read tokens from
// useTheme(), which resolves the light or dark palette from the OS setting
// automatically.
//
// Palette rationale (spec 3a–3f, "electric" set): near-white paper and
// violet-tinted neutrals with an electric-violet brand accent (#5A3FF0) and
// an electric-lime accent (#C4F52E) reserved for the leveling system. Green
// is reserved exclusively for live activity.
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useColorScheme } from "react-native";
import { storage } from "./storage";

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  // Extra-quiet footnote copy, one step past textMuted (the check-in
  // screen's "auto-checkout" line).
  textFootnote: string;
  accent: string;
  accentPressed: string;
  accentSurface: string;
  accentSoft: string;
  onAccent: string;
  // Electric lime, reserved for the leveling system (XP bars, level badges,
  // streak accents — spec 3d/3e). Never a general CTA color; that's `accent`.
  xp: string;
  onXp: string;
  chipBorder: string;
  quietDot: string;
  live: string;
  liveSurface: string;
  warning: string;
  warningSurface: string;
  warningBorder: string;
  danger: string;
  overlay: string;
  // Machined-metal finish. Neutral surfaces use metalTop→metalBottom
  // gradients with a metalEdge top highlight (the "milled edge"); the
  // accent CTA uses accentMetalTop→accentMetalBottom. sheen is the
  // translucent band swept across buttons on press.
  metalTop: string;
  metalBottom: string;
  metalEdge: string;
  accentMetalTop: string;
  accentMetalBottom: string;
  sheen: string;
}

const light: ThemeColors = {
  background: "#FAF9FE",
  surface: "#FFFFFF",
  // A muted gray one step darker than the paper background, so chips, badge
  // tiles, and inactive track fills read without needing a border (spec's
  // #ECEAF5 chip/style-tag gray).
  surfaceMuted: "#ECEAF5",
  border: "#E7E5F2",
  textPrimary: "#161326",
  textSecondary: "#55536B",
  textMuted: "#7A7791",
  textFootnote: "#8A87A0",
  accent: "#5A3FF0",
  accentPressed: "#4526C9",
  accentSurface: "#EEE9FF",
  accentSoft: "#B9A9FA",
  onAccent: "#FFFFFF",
  xp: "#C4F52E",
  onXp: "#161326",
  chipBorder: "#DAD7E8",
  quietDot: "#C4C1D6",
  live: "#12B981",
  liveSurface: "#E4F7EF",
  warning: "#8A6404",
  warningSurface: "#FBF3DA",
  warningBorder: "#E8D08C",
  danger: "#B3261E",
  overlay: "rgba(22, 19, 38, 0.45)",
  metalTop: "#FFFFFF",
  metalBottom: "#F1EFFA",
  metalEdge: "#FFFFFF",
  accentMetalTop: "#6E52FF",
  accentMetalBottom: "#4A2CD8",
  sheen: "rgba(255, 255, 255, 0.55)",
};

const dark: ThemeColors = {
  background: "#161326",
  surface: "#26233B",
  surfaceMuted: "#201D33",
  border: "#3B3752",
  textPrimary: "#F2F1F9",
  textSecondary: "#D6D3E6",
  textMuted: "#84819A",
  textFootnote: "#6B6884",
  accent: "#6E52FF",
  accentPressed: "#5A3FF0",
  accentSurface: "#2A2450",
  accentSoft: "#B9A9FA",
  onAccent: "#FFFFFF",
  xp: "#C4F52E",
  onXp: "#161326",
  chipBorder: "#3B3752",
  quietDot: "#4A4763",
  live: "#12B981",
  liveSurface: "#143026",
  warning: "#E3B341",
  warningSurface: "#2A2415",
  warningBorder: "#57491F",
  danger: "#F2726A",
  overlay: "rgba(0, 0, 0, 0.6)",
  metalTop: "#2A2740",
  metalBottom: "#1B1830",
  metalEdge: "rgba(255, 255, 255, 0.14)",
  accentMetalTop: "#6E52FF",
  accentMetalBottom: "#4A2CD8",
  sheen: "rgba(255, 255, 255, 0.2)",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999,
} as const;

// Loaded font family names (see app/_layout.tsx for useFonts wiring). Body
// copy is Barlow; display/condensed headings and buttons are Barlow
// Condensed, always uppercase.
export const fonts = {
  body: "Barlow_400Regular",
  bodyMedium: "Barlow_500Medium",
  bodySemi: "Barlow_600SemiBold",
  bodyBold: "Barlow_700Bold",
  condensed: "BarlowCondensed_700Bold",
  condensedHeavy: "BarlowCondensed_800ExtraBold",
} as const;

// Type scale. Entries with an explicit fontFamily omit fontWeight — RN
// Android breaks glyph shaping when a weight is paired with a named family.
export const type = {
  hero: {
    fontFamily: fonts.condensedHeavy,
    fontSize: 44,
    textTransform: "uppercase" as const,
    letterSpacing: 0.9,
    lineHeight: 42,
  },
  display: {
    fontFamily: fonts.condensedHeavy,
    fontSize: 30,
    textTransform: "uppercase" as const,
    letterSpacing: 0.6,
  },
  displayCondensed: {
    fontFamily: fonts.condensedHeavy,
    fontSize: 24,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
  },
  title: {
    fontFamily: fonts.bodySemi,
    fontSize: 19,
  },
  heading: {
    fontFamily: fonts.bodySemi,
    fontSize: 16,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 16,
  },
  bodyMedium: {
    fontFamily: fonts.bodyMedium,
    fontSize: 16,
  },
  caption: {
    fontFamily: fonts.body,
    fontSize: 13,
  },
  button: {
    fontFamily: fonts.condensed,
    fontSize: 17,
    textTransform: "uppercase" as const,
    letterSpacing: 1.4,
  },
  overline: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    textTransform: "uppercase" as const,
    letterSpacing: 1.2,
  },
  label: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    textTransform: "uppercase" as const,
    letterSpacing: 1.2,
  },
} as const;

// Shadow presets. shadowColor/shadowOpacity/shadowRadius/shadowOffset are
// consumed on iOS; elevation is the Android equivalent.
export const shadows = {
  cta: {
    shadowColor: "#5A3FF0",
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  // Spec 3a: live pins carry the brand violet glow (0 6px 16px
  // rgba(90,63,240,.45)).
  pin: {
    shadowColor: "#5A3FF0",
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  sheet: {
    shadowColor: "#161326",
    shadowOpacity: 0.14,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: -8 },
    elevation: 12,
  },
  chrome: {
    shadowColor: "#161326",
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
} as const;

export interface Theme {
  scheme: "light" | "dark";
  colors: ThemeColors;
  spacing: typeof spacing;
  radius: typeof radius;
  type: typeof type;
  shadows: typeof shadows;
  fonts: typeof fonts;
}

// User-selectable appearance: follow the OS or force light/dark. Persisted
// on-device and applied app-wide via ThemePreferenceProvider.
export type ThemePreference = "system" | "light" | "dark";

const PREFERENCE_KEY = "pullup.theme";

interface PreferenceState {
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
}

const PreferenceContext = createContext<PreferenceState>({
  preference: "system",
  setPreference: () => {},
});

export function ThemePreferenceProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>("system");

  useEffect(() => {
    void storage.get(PREFERENCE_KEY).then((stored) => {
      if (stored === "light" || stored === "dark" || stored === "system") {
        setPreferenceState(stored);
      }
    });
  }, []);

  const setPreference = (p: ThemePreference) => {
    setPreferenceState(p);
    void storage.set(PREFERENCE_KEY, p);
  };

  return createElement(
    PreferenceContext.Provider,
    { value: { preference, setPreference } },
    children,
  );
}

export function useThemePreference(): PreferenceState {
  return useContext(PreferenceContext);
}

export function useTheme(): Theme {
  const system = useColorScheme() === "dark" ? "dark" : "light";
  const { preference } = useThemePreference();
  const scheme = preference === "system" ? system : preference;
  return {
    scheme,
    colors: scheme === "dark" ? dark : light,
    spacing,
    radius,
    type,
    shadows,
    fonts,
  };
}

// A handful of screens (the slide-to-check-in modal, spec 3d) are always
// dark, regardless of the user's theme preference or OS setting. This
// resolves the dark palette into a full Theme object without touching the
// global preference — callers use it locally instead of useTheme().
export function darkTheme(): Theme {
  return {
    scheme: "dark",
    colors: dark,
    spacing,
    radius,
    type,
    shadows,
    fonts,
  };
}

// Shared screen options so navigation chrome (headers, screen backgrounds)
// matches the design system. Spread into Stack/Tabs screenOptions.
export function navChrome(t: Theme) {
  return {
    headerStyle: { backgroundColor: t.colors.surface },
    headerTintColor: t.colors.textPrimary,
    headerTitleStyle: { fontFamily: t.fonts.bodySemi, color: t.colors.textPrimary },
    headerShadowVisible: false,
    contentStyle: { backgroundColor: t.colors.background },
  };
}
