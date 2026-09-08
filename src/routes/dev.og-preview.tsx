import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ExternalLink, Loader2, RefreshCw } from "lucide-react";

import { OG_IMAGE_SIZES, type OgImageSize, pageHead, withOgSize } from "@/lib/seo";

export const Route = createFileRoute("/dev/og-preview")({
  head: () =>
    pageHead({
      path: "/dev/og-preview",
      title: "OG Card Preview — ballaCity",
      description:
        "Paste any game, profile, or venue URL and preview its share card in every supported size.",
      noindex: true,
    }),
  component: OgPreviewPage,
});

type Extracted = {
  title: string | null;
  description: string | null;
  ogImage: string | null;
  twitterImage: string | null;
  twitterCard: string | null;
};

/** Turn any pasted value into a same-origin path we can fetch. */
function toLocalPath(input: string) {
  const raw = input.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw, window.location.origin);
    return `${url.pathname}${url.search}`;
  } catch {
    return raw.startsWith("/") ? raw : `/${raw}`;
  }
}

/** Rewrite an absolute card URL onto the current origin so previews load here. */
function toLocalImage(imageUrl: string) {
  try {
    const url = new URL(imageUrl, window.location.origin);
    return `${url.pathname}${url.search}`;
  } catch {
    return imageUrl;
  }
}

function metaFrom(doc: Document, selector: string) {
  return doc.querySelector(selector)?.getAttribute("content")?.trim() || null;
}

function OgPreviewPage() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [path, setPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Extracted | null>(null);
  const [nonce, setNonce] = useState(0);

  const load = useCallback(async (value: string) => {
    const target = toLocalPath(value);
    if (!target) return;
    setPath(target);
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch(target, { headers: { Accept: "text/html" } });
      const html = await res.text();
      if (!res.ok) throw new Error(`Page returned ${res.status}`);
      const doc = new DOMParser().parseFromString(html, "text/html");
      setData({
        title: doc.querySelector("title")?.textContent?.trim() || null,
        description: metaFrom(doc, 'meta[name="description"]'),
        ogImage: metaFrom(doc, 'meta[property="og:image"]'),
        twitterImage: metaFrom(doc, 'meta[name="twitter:image"]'),
        twitterCard: metaFrom(doc, 'meta[name="twitter:card"]'),
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get("url");
    if (initial) {
      setInput(initial);
      void load(initial);
    }
  }, [load]);

  const cards = useMemo(() => {
    const base = data?.ogImage ?? data?.twitterImage;
    if (!base) return null;
    return (Object.keys(OG_IMAGE_SIZES) as OgImageSize[]).map((size) => {
      const absolute = withOgSize(base, size);
      return {
        size,
        absolute,
        src: (() => {
          const local = toLocalImage(absolute);
          if (!nonce) return local;
          return `${local}${local.includes("?") ? "&" : "?"}_r=${nonce}`;
        })(),
        ...OG_IMAGE_SIZES[size],
      };
    });
  }, [data, nonce]);

  const generated = Boolean((data?.ogImage ?? "").includes("/api/public/og"));

  return (
    <div className="min-h-dvh bg-background px-4 pb-24 pt-6">
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => router.history.back()}
            className="grid h-9 w-9 place-items-center rounded-md border border-border text-muted-foreground hover:text-foreground"
            aria-label="Go back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-xl font-semibold text-foreground">OG card preview</h1>
            <p className="text-xs text-muted-foreground">
              Paste a game, player, team, trainer, or venue URL to see its share card in every
              supported size.
            </p>
          </div>
        </div>

        <form
          className="mt-6 rounded-xl border border-border bg-surface p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void load(input);
          }}
        >
          <label htmlFor="og-url" className="text-sm font-medium text-foreground">
            Page URL or path
          </label>
          <div className="mt-2 flex gap-2">
            <input
              id="og-url"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="/games/abc123 or https://open-run-connect.lovable.app/players/…"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground outline-none focus:border-primary"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Preview
            </button>
          </div>
          {path && (
            <p className="mt-2 break-all font-mono text-[11px] text-muted-foreground">
              fetched: {path}
            </p>
          )}
        </form>

        {error && (
          <p className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            Could not read that page: {error}
          </p>
        )}

        {data && (
          <section className="mt-4 rounded-xl border border-border bg-surface p-4">
            <h2 className="text-sm font-medium text-foreground">Head metadata</h2>
            <dl className="mt-2 space-y-1 text-xs">
              {[
                ["title", data.title],
                ["description", data.description],
                ["twitter:card", data.twitterCard],
                ["og:image", data.ogImage],
                ["twitter:image", data.twitterImage],
              ].map(([key, value]) => (
                <div key={key as string} className="flex gap-2">
                  <dt className="w-28 shrink-0 font-mono text-muted-foreground">{key}</dt>
                  <dd className="min-w-0 flex-1 break-all text-foreground">
                    {value || <span className="text-muted-foreground">— missing —</span>}
                  </dd>
                </div>
              ))}
            </dl>
            {!generated && data.ogImage && (
              <p className="mt-3 text-xs text-muted-foreground">
                This page uses a static image, not the generated card renderer — all sizes below
                show the same file.
              </p>
            )}
          </section>
        )}

        {cards && (
          <section className="mt-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-foreground">Rendered sizes</h2>
              <button
                type="button"
                onClick={() => setNonce(Date.now())}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Bypass cache
              </button>
            </div>
            {cards.map((card) => (
              <figure key={card.size} className="rounded-xl border border-border bg-surface p-3">
                <figcaption className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {card.size} · {card.width}×{card.height}
                  </span>
                  <a
                    href={card.src}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Open <ExternalLink className="h-3 w-3" />
                  </a>
                </figcaption>
                <img
                  src={card.src}
                  alt={`${card.size} share card preview`}
                  width={card.width}
                  height={card.height}
                  className="mt-2 w-full rounded-lg border border-border bg-background"
                  style={{ aspectRatio: `${card.width} / ${card.height}` }}
                />
                <p className="mt-2 break-all font-mono text-[10px] text-muted-foreground">
                  {card.absolute}
                </p>
              </figure>
            ))}
          </section>
        )}

        {data && !cards && (
          <p className="mt-4 rounded-lg border border-border bg-surface p-3 text-sm text-muted-foreground">
            This page does not declare an og:image, so there is no card to preview.
          </p>
        )}

        <div className="mt-6 flex justify-center gap-4 text-xs text-muted-foreground">
          <Link to="/dev/route-doctor" className="hover:text-foreground">
            Route Doctor
          </Link>
          <Link to="/" className="hover:text-foreground">
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
