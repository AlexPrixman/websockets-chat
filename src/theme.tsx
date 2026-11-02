import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";

export type ThemePreference = "light" | "dark" | "system";
type Theme = "light" | "dark";
const storageKey = "circlechat-theme";
const mediaQuery = "(prefers-color-scheme: dark)";
const validPreference = (value: unknown): value is ThemePreference =>
  value === "light" || value === "dark" || value === "system";

export function readThemePreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(storageKey);
    return validPreference(saved) ? saved : "system";
  } catch {
    return "system";
  }
}

function deviceTheme(): Theme {
  return typeof window.matchMedia === "function" && window.matchMedia(mediaQuery).matches
    ? "dark"
    : "light";
}

function applyTheme(preference: ThemePreference): Theme {
  const resolved = preference === "system" ? deviceTheme() : preference;
  document.documentElement.dataset.theme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    "content", resolved === "dark" ? "#14221e" : "#f6f8f9",
  );
  return resolved;
}

// Called before React mounts, so a saved dark theme does not render as light first.
export function initializeTheme() {
  return applyTheme(readThemePreference());
}

const ThemeContext = createContext<{
  preference: ThemePreference;
  resolved: Theme;
  setPreference: (value: ThemePreference) => void;
} | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, updatePreference] = useState(readThemePreference);
  const [resolved, setResolved] = useState<Theme>(() =>
    preference === "system" ? deviceTheme() : preference,
  );

  useEffect(() => {
    const sync = () => setResolved(applyTheme(preference));
    sync();
    if (preference !== "system" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(mediaQuery);
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [preference]);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) {
        updatePreference(readThemePreference());
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  function setPreference(value: ThemePreference) {
    updatePreference(value);
    setResolved(applyTheme(value));
    try {
      localStorage.setItem(storageKey, value);
    } catch {
      // The switch still works when browser storage is unavailable.
    }
  }

  return (
    <ThemeContext.Provider value={{ preference, resolved, setPreference }}>
      {children}
    </ThemeContext.Provider>
  );
}

function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("Theme controls must be inside ThemeProvider");
  return context;
}

export function ThemeSwitch() {
  const { resolved, setPreference } = useTheme();
  const next = resolved === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="theme-switch icon"
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      onClick={() => setPreference(next)}
    >
      {resolved === "dark" ? <Sun size={19} /> : <Moon size={19} />}
    </button>
  );
}

const choices = [
  { value: "light", label: "Light", detail: "Bright & fresh", Icon: Sun },
  { value: "dark", label: "Dark", detail: "Easy on the eyes", Icon: Moon },
  { value: "system", label: "Device", detail: "System default", Icon: Monitor },
] as const;

export function ThemeSettings() {
  const { preference, setPreference } = useTheme();
  return (
    <section className="theme-settings" aria-labelledby="appearance-heading">
      <h3 id="appearance-heading">Make it your space</h3>
      <p>Follow your device, or choose your own look. Your choice stays on this browser.</p>
      <div className="theme-options" role="group" aria-label="Color theme">
        {choices.map(({ value, label, detail, Icon }) => (
          <button
            type="button"
            key={value}
            className={`theme-option theme-option-${value}`}
            aria-label={value === "system" ? "Device theme (default)" : `${label} theme`}
            aria-pressed={preference === value}
            onClick={() => setPreference(value)}
          >
            <span className="theme-swatch" aria-hidden="true">
              <span /><span /><span />
            </span>
            <span className="theme-option-label"><Icon size={15} />{label}
              {preference === value && <Check size={14} />}
            </span>
            <small>{detail}</small>
          </button>
        ))}
      </div>
    </section>
  );
}
