/**
 * Server-only writer for the administrative audit log.
 *
 * Every privileged action funnels through `logAdminAction` so entries are
 * shaped consistently and scrubbed of sensitive values before storage.
 * The table itself is append-only at the database level.
 */
import type { AuditAction } from "@/lib/audit-actions";

const SENSITIVE_KEY =
  /(pass(word|wd|phrase)?|token|secret|api[-_]?key|authorization|auth[-_]?header|cookie|session|refresh|jwt|bearer|cvv|cvc|card[-_]?(number|num|pan)|pan|iban|routing|account[-_]?number|ssn|tax[-_]?id|credential|private[-_]?key|otp|pin)/i;

const MAX_STRING = 2000;
const MAX_DEPTH = 6;
const MAX_KEYS = 60;
const MAX_ARRAY = 40;

/**
 * Recursively strips credential-shaped keys and truncates long values.
 * Never store passwords, tokens, or payment credentials in audit history.
 */
export function sanitizeAuditValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string")
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…[truncated]` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return "[depth limit]";
  if (Array.isArray(value))
    return value.slice(0, MAX_ARRAY).map((v) => sanitizeAuditValue(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    let n = 0;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (n >= MAX_KEYS) {
        out["…"] = "[key limit]";
        break;
      }
      n += 1;
      out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : sanitizeAuditValue(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

export type AuditEntry = {
  action: AuditAction;
  targetType: string;
  targetId?: string | null;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
  /** Extra structured context (request source, counts, flags). */
  metadata?: Record<string, unknown>;
};

type AdminClient = {
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
  };
};

/**
 * Appends one entry. Never throws into the caller's action: a failed audit
 * write is reported to the server log so the admin action itself still
 * completes, but the failure is visible.
 */
export async function logAdminAction(
  admin: AdminClient,
  actorId: string | null,
  entry: AuditEntry,
): Promise<{ logged: boolean }> {
  const row = {
    actor_id: actorId,
    action: entry.action,
    target_type: entry.targetType,
    target_id: entry.targetId ? String(entry.targetId).slice(0, 200) : null,
    reason: entry.reason ? entry.reason.slice(0, 1000) : null,
    before: sanitizeAuditValue(entry.before ?? null),
    after: sanitizeAuditValue(entry.after ?? null),
    metadata: sanitizeAuditValue(entry.metadata ?? {}),
  };
  try {
    const { error } = await admin.from("admin_audit_log").insert(row);
    if (error) {
      console.error("[audit] failed to write entry", entry.action, error.message);
      return { logged: false };
    }
    return { logged: true };
  } catch (err) {
    console.error("[audit] failed to write entry", entry.action, err);
    return { logged: false };
  }
}
