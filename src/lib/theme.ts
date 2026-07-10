import { useEffect, useState, useCallback } from "react";

export type Theme = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";
const STORAGE_KEY = "openrun:theme";

export function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  const v = window.localStorage.getItem(STORAGE_KEY);
  if (v === "light" || v === "dark" || v === "system") return v;
  return "system";
}

export function resolveTheme(t: Theme): ResolvedTheme {
  return t === "system" ? getSystemTheme() : t;
}

export function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const resolved = resolveTheme(theme);
  const html = document.documentElement;
  html.classList.toggle("light", resolved === "light");
  html.classList.toggle("dark", resolved === "dark");
  html.dataset.theme = resolved;
  html.dataset.themePref = theme;
}

export function setStoredTheme(theme: Theme) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, theme);
  }
  applyTheme(theme);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("openrun:theme-change", { detail: theme }));
  }
}

export function useTheme(): [Theme, (t: Theme) => void, () => void, ResolvedTheme] {
  const [theme, setThemeState] = useState<Theme>(() => getStoredTheme());
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(getStoredTheme()));

  useEffect(() => {
    applyTheme(theme);
    setResolved(resolveTheme(theme));
  }, [theme]);

  useEffect(() => {
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<Theme>).detail;
      if (next === "light" || next === "dark" || next === "system") setThemeState(next);
    };
    window.addEventListener("openrun:theme-change", onChange);
    return () => window.removeEventListener("openrun:theme-change", onChange);
  }, []);

  // Follow OS changes when theme is "system"
  useEffect(() => {
    if (theme !== "system" || typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(prefers-color-scheme: light)");
    const onSys = () => {
      applyTheme("system");
      setResolved(getSystemTheme());
    };
    mql.addEventListener("change", onSys);
    return () => mql.removeEventListener("change", onSys);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    setStoredTheme(t);
  }, []);

  const toggle = useCallback(() => {
    setThemeState((prev) => {
      const currentResolved = resolveTheme(prev);
      const next: Theme = currentResolved === "dark" ? "light" : "dark";
      setStoredTheme(next);
      return next;
    });
  }, []);

  return [theme, setTheme, toggle, resolved];
}
