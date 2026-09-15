import { AI_FEATURES } from "@/lib/ai/config";
import { AGE_COHORTS } from "@/lib/child-policy";

/**
 * Names every part of the stored row that the parser threw away.
 *
 * This is the compensating control for `parseAiFeatures` falling back to
 * defaults without complaining: the parser cannot report what it discarded
 * without changing its fail-soft contract, so this re-walks the raw row and
 * says what the gate will never see.
 */
export function describeFeatureDrift(raw: unknown): string[] {
  const out: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return raw == null ? out : ["the row is not a JSON object — the whole config is at defaults"];
  }
  const src = raw as Record<string, unknown>;

  if ("killSwitch" in src && typeof src["killSwitch"] !== "boolean") {
    out.push(
      `killSwitch is ${JSON.stringify(src["killSwitch"])}, not true or false — read as false`,
    );
  }
  for (const key of Object.keys(src)) {
    if (key !== "killSwitch" && key !== "features") out.push(`unknown key "${key}" — ignored`);
  }

  const featureSrc = src["features"];
  if (featureSrc === undefined) return out;
  if (!featureSrc || typeof featureSrc !== "object" || Array.isArray(featureSrc)) {
    out.push("features is not a JSON object — every feature is at its default");
    return out;
  }

  for (const [name, value] of Object.entries(featureSrc as Record<string, unknown>)) {
    if (!(AI_FEATURES as readonly string[]).includes(name)) {
      out.push(`unknown feature "${name}" — ignored`);
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      out.push(`features.${name} is not a JSON object — read as its default`);
      continue;
    }
    const f = value as Record<string, unknown>;
    if ("enabled" in f && typeof f["enabled"] !== "boolean") {
      out.push(
        `features.${name}.enabled is ${JSON.stringify(f["enabled"])}, not true or false — read as its default`,
      );
    }
    if ("cohorts" in f) {
      const c = f["cohorts"];
      if (!Array.isArray(c)) {
        out.push(`features.${name}.cohorts is not an array — read as its default`);
      } else {
        for (const item of c) {
          if (!(AGE_COHORTS as readonly string[]).includes(item as string)) {
            out.push(`features.${name}.cohorts contains ${JSON.stringify(item)} — dropped`);
          }
        }
      }
    }
  }
  return out;
}
