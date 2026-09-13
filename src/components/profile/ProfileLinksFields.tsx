import { ExternalLink, Plus, X } from "lucide-react";
import { LINK_TYPES, LinkIcon } from "@/components/ProfileLinks";
import { Input } from "@/components/profile/ProfileFormPrimitives";
import type { ProfileLink, ProfileLinkType } from "@/lib/user-prefs-store";

/** Canonicalizes a user-typed URL (adds https://, lowercases host, trims). */
export function normalizeProfileUrl(raw: string): string {
  const t = raw.trim().replace(/\s+/g, "");
  if (!t) return "";
  const withProto = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withProto);
    u.hostname = u.hostname.toLowerCase();
    if (
      (u.protocol === "https:" && u.port === "443") ||
      (u.protocol === "http:" && u.port === "80")
    ) {
      u.port = "";
    }
    let out = u.toString();
    if (u.pathname === "/" && !u.search && !u.hash) out = out.replace(/\/$/, "");
    return out;
  } catch {
    return withProto;
  }
}

/** Returns a human-readable problem with the URL, or null when it's valid. */
export function validateProfileUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return "URL is required";
  if (t.length > 500) return "URL is too long (max 500 chars)";
  if (/\s/.test(t)) return "URL cannot contain spaces";
  let u: URL;
  try {
    u = new URL(normalizeProfileUrl(t));
  } catch {
    return "Enter a valid URL";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:")
    return "Enter a valid website (e.g. example.com)";
  const host = u.hostname;
  if (!host || host.length > 253) return "Enter a valid domain";
  if (!/^[a-z0-9.-]+$/i.test(host)) return "Domain has invalid characters";
  if (!host.includes(".")) return "Enter a valid domain (missing .com, .org, etc.)";
  const tld = host.split(".").pop() ?? "";
  if (tld.length < 2 || !/^[a-z]+$/i.test(tld)) return "Enter a valid domain extension";
  if (host === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return "Use a public website URL";
  return null;
}

/** Trims + normalizes links for persistence, dropping empty rows. */
export function cleanProfileLinks(links: ProfileLink[]): ProfileLink[] {
  return links
    .map((l) => ({ ...l, url: normalizeProfileUrl(l.url), label: l.label?.trim() || undefined }))
    .filter((l) => l.url);
}

/**
 * The canonical "Profile links" editor. Rendered by both Edit profile and
 * onboarding so the two can never drift.
 */
export function ProfileLinksFields({
  links,
  onChange,
}: {
  links: ProfileLink[];
  onChange: (next: ProfileLink[]) => void;
}) {
  const linkErrors = links.map((l) => validateProfileUrl(l.url));

  const addLink = (type: ProfileLinkType) => onChange([...links, { type, url: "" }]);
  const updateLink = (i: number, patch: Partial<ProfileLink>) =>
    onChange(links.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const removeLink = (i: number) => onChange(links.filter((_, idx) => idx !== i));

  return (
    <>
      <p className="text-xs text-muted-foreground mb-2">
        Add links to Perfect Game, PBR, Hudl, socials, or your own site.
      </p>
      <div className="space-y-2">
        {links.map((l, i) => (
          <div key={i} className="rounded-2xl border border-border bg-surface p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <LinkIcon type={l.type} className="h-3.5 w-3.5" />
                <select
                  value={l.type}
                  onChange={(e) => updateLink(i, { type: e.target.value as ProfileLinkType })}
                  className="bg-transparent text-xs font-semibold outline-none"
                  aria-label="Link type"
                >
                  {LINK_TYPES.map((opt) => (
                    <option key={opt.type} value={opt.type}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => removeLink(i)}
                aria-label="Remove link"
                className="grid h-7 w-7 place-items-center rounded-full border border-border text-muted-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <Input
              value={l.url}
              onChange={(v) => updateLink(i, { url: v })}
              placeholder={LINK_TYPES.find((t) => t.type === l.type)?.placeholder ?? "https://"}
              aria-invalid={linkErrors[i] ? true : undefined}
              className={
                linkErrors[i] ? "border-destructive focus-visible:ring-destructive" : undefined
              }
            />
            {linkErrors[i] && <p className="mt-1 text-xs text-destructive">{linkErrors[i]}</p>}
            <div className="mt-2">
              <Input
                value={l.label ?? ""}
                onChange={(v) => updateLink(i, { label: v })}
                maxLength={40}
                placeholder="Optional label (e.g. @handle)"
              />
            </div>
            {!linkErrors[i] && l.url.trim() && (
              <LinkPreview url={l.url} type={l.type} label={l.label} />
            )}
          </div>
        ))}
      </div>
      <div className="mt-3">
        <div className="text-xs text-muted-foreground mb-1.5">Add link</div>
        <div className="flex flex-wrap gap-2">
          {LINK_TYPES.map((t) => (
            <button
              key={t.type}
              type="button"
              onClick={() => addLink(t.type)}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold hover:border-lime/40"
            >
              <Plus className="h-3 w-3" /> {t.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function LinkPreview({ url, type, label }: { url: string; type: ProfileLinkType; label?: string }) {
  const href = normalizeProfileUrl(url);
  let host = "";
  let path = "";
  try {
    const u = new URL(href);
    host = u.hostname.replace(/^www\./, "");
    path = (u.pathname === "/" ? "" : u.pathname) + u.search + u.hash;
  } catch {
    host = href;
  }
  const title = label?.trim() || (LINK_TYPES.find((t) => t.type === type)?.label ?? host);
  return (
    <div className="mt-3">
      <div className="micro-label text-muted-foreground mb-1">Preview</div>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 rounded-2xl border border-border bg-background p-3 hover:border-lime/40 transition-colors"
      >
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border bg-surface overflow-hidden">
          <LinkIcon type={type} url={href} className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{title}</div>
          <div className="truncate text-xs text-muted-foreground">
            <span className="font-medium text-foreground/80">{host}</span>
            {path && <span className="opacity-70">{path}</span>}
          </div>
        </div>
        <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
      </a>
    </div>
  );
}
