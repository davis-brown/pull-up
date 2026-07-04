// pull-up design system.
//
// Single source of truth for color, spacing, radius, and type. Components
// never hardcode values — they read tokens from useTheme(), which resolves
// the light or dark palette from the OS setting automatically.
//
// Palette rationale: warm neutrals (asphalt & sand, not blue-grays) with a
// burnt-orange brand accent; green is reserved exclusively for live activity.
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
  accent: string;
  onAccent: string;
  live: string;
  liveSurface: string;
  warning: string;
  warningSurface: string;
  warningBorder: string;
  danger: string;
  overlay: string;
}

const light: ThemeColors = {
  background: "#F7F5F2",
  surface: "#FFFFFF",
  surfaceMuted: "#EFECE7",
  border: "#E3DFD8",
  textPrimary: "#1D1A17",
  textSecondary: "#6E675E",
  textMuted: "#9B948A",
  accent: "#DE540A",
  onAccent: "#FFFFFF",
  live: "#177A3D",
  liveSurface: "#E1F4E7",
  warning: "#8A6404",
  warningSurface: "#FBF3DA",
  warningBorder: "#E8D08C",
  danger: "#B3261E",
  overlay: "rgba(29, 26, 23, 0.45)",
};

const dark: ThemeColors = {
  background: "#141210",
  surface: "#1F1C19",
  surfaceMuted: "#2A2622",
  border: "#3A342E",
  textPrimary: "#F1EDE7",
  textSecondary: "#A9A197",
  textMuted: "#756D62",
  accent: "#FF7A33",
  onAccent: "#221004",
  live: "#53C97C",
  liveSurface: "#1B3323",
  warning: "#E3B341",
  warningSurface: "#2E2817",
  warningBorder: "#57491F",
  danger: "#F2726A",
  overlay: "rgba(0, 0, 0, 0.55)",
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
  full: 999,
} as const;

// Type scale. Weights: regular 400, medium 500, semibold 600, bold 700.
export const type = {
  display: { fontSize: 30, fontWeight: "700" as const, letterSpacing: -0.5 },
  title: { fontSize: 21, fontWeight: "700" as const, letterSpacing: -0.3 },
  heading: { fontSize: 17, fontWeight: "600" as const },
  body: { fontSize: 15, fontWeight: "400" as const },
  bodyMedium: { fontSize: 15, fontWeight: "500" as const },
  caption: { fontSize: 13, fontWeight: "400" as const },
  label: {
    fontSize: 12,
    fontWeight: "600" as const,
    letterSpacing: 0.6,
    textTransform: "uppercase" as const,
  },
} as const;

export interface Theme {
  scheme: "light" | "dark";
  colors: ThemeColors;
  spacing: typeof spacing;
  radius: typeof radius;
  type: typeof type;
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
  };
}

// Shared screen options so navigation chrome (headers, screen backgrounds)
// matches the design system. Spread into Stack/Tabs screenOptions.
export function navChrome(t: Theme) {
  return {
    headerStyle: { backgroundColor: t.colors.surface },
    headerTintColor: t.colors.textPrimary,
    headerTitleStyle: { fontWeight: "600" as const, color: t.colors.textPrimary },
    headerShadowVisible: false,
    contentStyle: { backgroundColor: t.colors.background },
  };
}
