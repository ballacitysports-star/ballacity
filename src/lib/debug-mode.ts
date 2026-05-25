import { useEffect, useState } from "react";

const KEY = "openrun:debug-mode";
const listeners = new Set<(v: boolean) => void>();

function read(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function apply(v: boolean) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.debug = v ? "1" : "0";
}

export function setDebugMode(v: boolean) {
  try {
    window.localStorage.setItem(KEY, v ? "1" : "0");
  } catch {
    // ignore
  }
  apply(v);
  listeners.forEach((l) => l(v));
}

export function useDebugMode(): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(false);
  useEffect(() => {
    const initial = read();
    setV(initial);
    apply(initial);
    const cb = (next: boolean) => setV(next);
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  }, []);
  return [v, setDebugMode];
}
