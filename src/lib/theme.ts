import { useEffect, useState, useCallback } from "react";

export type Theme = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";
const STORAGE_KEY = "openrun:theme";

function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
}

export function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  const v = window.localStorage.getItem(STORAGE_KEY);
  if (v === "light" || v === "dark" || v === "system") return v;
  return "system";
}

export function resolveTheme(t: Theme): ResolvedTheme {
  if (t === "system") return systemPrefersDark() ? "dark" : "light";
  return t;
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

  useEffect(() => {
    if (theme !== "system" || typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSys = () => {
      applyTheme("system");
      setResolved(resolveTheme("system"));
    };
    mq.addEventListener?.("change", onSys);
    return () => mq.removeEventListener?.("change", onSys);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    setStoredTheme(t);
  }, []);

  const toggle = useCallback(() => {
    setThemeState((prev) => {
      const cur = resolveTheme(prev);
      const next: Theme = cur === "dark" ? "light" : "dark";
      setStoredTheme(next);
      return next;
    });
  }, []);

  return [theme, setTheme, toggle, resolved];
}
