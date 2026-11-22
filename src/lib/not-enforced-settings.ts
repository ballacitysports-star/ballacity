/**
 * Seeded flags that nothing reads. No code in src/ and no database function looks at them, so changing one changes
 * nothing. Each row says so. `maintenance_mode` is not the maintenance switch: that is the `maintenance` row, edited
 * in the Maintenance card. When a flag gets a real reader, remove it from this list (not-enforced-settings.test.ts checks).
 */
export const NOT_ENFORCED_SETTINGS: Record<string, string> = {
  maintenance_mode: "Not enforced. Use the Maintenance card to turn maintenance on.",
  signups_enabled: "Not enforced. Turning it off does not stop sign-ups.",
  games_creation_enabled: "Not enforced. Turning it off does not stop hosts creating games.",
  reels_enabled: "Not enforced. Turning it off does not stop highlight reels.",
  announcement_banner: "Not enforced. The app shows no banner with this text.",
};

/** The "not enforced" note for a setting key, or null when the key is read somewhere. */
export function notEnforcedNote(key: string): string | null {
  return Object.hasOwn(NOT_ENFORCED_SETTINGS, key) ? NOT_ENFORCED_SETTINGS[key] : null;
}
