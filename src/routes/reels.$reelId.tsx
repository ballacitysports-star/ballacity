import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Lock } from "lucide-react";
import { ogImageUrl, pageHead } from "@/lib/seo";
import { getPublicReel } from "@/lib/public-reel.functions";

/**
 * Shareable page for one posted reel. Only adult, posted, non-family reels resolve
 * (see getPublicReel); everything else shows the same "not available" state.
 * The head carries no signed media URL (they expire) — previews use a generated card.
 */
export const Route = createFileRoute("/reels/$reelId")({
  loader: async ({ params }) => {
    const reel = await getPublicReel({ data: { id: params.reelId } }).catch(
      () => ({ found: false }) as const,
    );
    return { reel };
  },
  head: ({ loaderData, params }) => {
    const reel = loaderData?.reel;
    if (!reel?.found) {
      return pageHead({
        title: "Highlight — BallaCity",
        description: "A highlight on BallaCity.",
        noindex: true,
      });
    }
    return pageHead({
      path: `/reels/${params.reelId}`,
      title: `${reel.title} — BallaCity`,
      description: (reel.caption || "Watch this highlight on BallaCity.").slice(0, 155),
      ogType: "video.other",
      noindex: true,
      image: ogImageUrl({ kind: "player", title: reel.title, subtitle: reel.sport }),
    });
  },
  component: ReelPage,
});

function ReelPage() {
  const { reel } = Route.useLoaderData();
  const [showOriginal, setShowOriginal] = useState(false);

  if (!reel.found) {
    return (
      <main className="page-shell-narrow grid min-h-dvh place-items-center py-6 text-center">
        <div>
          <Lock className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
          <h1 className="mt-3 text-lg font-semibold">This highlight isn&apos;t available</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            It may have been removed or isn&apos;t shared publicly.
          </p>
          <Link to="/" className="mt-4 inline-block text-sm font-semibold text-lime">
            Go to BallaCity
          </Link>
        </div>
      </main>
    );
  }

  const src = showOriginal && reel.fallbackVideoUrl ? reel.fallbackVideoUrl : reel.videoUrl;
  return (
    <main className="page-shell-narrow min-h-dvh py-4">
      <h1 className="text-lg font-semibold">{reel.title}</h1>
      <video
        key={src}
        src={src}
        poster={reel.thumbnailUrl ?? undefined}
        controls
        playsInline
        preload="metadata"
        className="mt-3 w-full rounded-lg bg-black"
        onError={() => {
          if (!showOriginal && reel.fallbackVideoUrl) setShowOriginal(true);
        }}
      />
      {reel.caption && <p className="mt-3 whitespace-pre-wrap text-sm">{reel.caption}</p>}
      {reel.hashtags.length > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          {reel.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ")}
        </p>
      )}
      <Link
        to="/"
        className="mt-6 inline-flex rounded-full bg-lime px-4 py-2 text-sm font-bold text-primary-foreground"
      >
        Join BallaCity
      </Link>
    </main>
  );
}
