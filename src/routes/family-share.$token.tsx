import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Lock } from "lucide-react";
import { pageHead } from "@/lib/seo";
import { getSharedFamilyPost } from "@/lib/family-share.functions";

/**
 * A private link to ONE family clip, shared by a parent. Public (no sign-in) but
 * not discoverable: no indexing, no referrer, and the page shows only the video and
 * the caption the parent wrote. No child name, profile or comments. Links expire
 * and can be revoked; a link that is unknown, expired, revoked or on hold all look
 * the same here.
 */
export const Route = createFileRoute("/family-share/$token")({
  head: () => {
    const head = pageHead({
      title: "A private clip — ballaCity",
      description: "A clip shared privately by a parent.",
      noindex: true,
    });
    // Keep the secret in the address from leaking to other sites via the Referer.
    return { ...head, meta: [...head.meta, { name: "referrer", content: "no-referrer" }] };
  },
  component: FamilySharePage,
});

function FamilySharePage() {
  const { token } = Route.useParams();
  const fetchClip = useServerFn(getSharedFamilyPost);
  const { data, isLoading } = useQuery({
    queryKey: ["family-share", token],
    queryFn: () => fetchClip({ data: { token } }),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const [showOriginal, setShowOriginal] = useState(false);

  if (isLoading) {
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" />
      </main>
    );
  }

  if (!data?.found) {
    return (
      <main className="mx-auto grid min-h-dvh max-w-sm place-items-center p-6 text-center">
        <div>
          <Lock className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
          <h1 className="mt-3 text-lg font-semibold">This link isn&apos;t available</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            It may have expired or been turned off by the person who shared it.
          </p>
        </div>
      </main>
    );
  }

  const src = showOriginal && data.fallbackVideoUrl ? data.fallbackVideoUrl : data.videoUrl;

  return (
    <main className="mx-auto min-h-dvh max-w-xl p-4">
      <p className="micro-label text-muted-foreground">Shared privately</p>
      <h1 className="mt-1 text-lg font-semibold">{data.title}</h1>
      <video
        key={src ?? "none"}
        src={src ?? undefined}
        poster={data.thumbnailUrl ?? undefined}
        controls
        playsInline
        preload="metadata"
        className="mt-3 w-full rounded-lg bg-black"
        onError={() => {
          if (!showOriginal && data.fallbackVideoUrl) setShowOriginal(true);
        }}
      />
      {data.caption && <p className="mt-3 whitespace-pre-wrap text-sm">{data.caption}</p>}
      <p className="mt-6 text-xs text-muted-foreground">
        A parent shared this clip with you privately. Please don&apos;t forward it or post it
        elsewhere.
      </p>
    </main>
  );
}
