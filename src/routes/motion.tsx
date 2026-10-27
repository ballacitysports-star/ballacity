import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Gauge } from "lucide-react";
import { MotionReview } from "@/components/motion/MotionReview";
import { pageHead } from "@/lib/seo";

/**
 * Frame-by-frame review of a clip for coaches, trainers and athletes: slow motion,
 * drawing tools, side-by-side comparison, and a kinogram. The video is played from
 * the device and never uploaded; nothing here reads the body or calls AI.
 */
export const Route = createFileRoute("/motion")({
  head: () =>
    pageHead({
      path: "/motion",
      title: "Motion review | BallaCity",
      description:
        "Review a clip frame by frame in slow motion, draw angles and lines, compare two clips side by side, and save a kinogram. Your video stays on your device.",
    }),
  component: MotionPage,
});

function MotionPage() {
  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/95 px-2 py-2.5 backdrop-blur">
        <Link
          to="/reels"
          search={{ game: "", title: "", upload: "" }}
          className="rounded-full p-2 hover:bg-surface"
          aria-label="Back to reels"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        <span className="text-sm font-medium">Motion review</span>
      </header>
      <main className="page-shell pb-28 pt-5">
        <div className="flex items-center gap-2 text-lime">
          <Gauge className="h-5 w-5" aria-hidden />
          <span className="section-eyebrow">Motion review</span>
        </div>
        <h1 className="mt-1 page-title">Review a movement, frame by frame</h1>
        <p className="mt-1 mb-4 page-subtitle">
          Step through a clip, slow it down, draw angles and lines, compare two attempts side by
          side, and save a kinogram. Built for coaches, trainers and athletes. Your video is played
          from your device and is never uploaded.
        </p>
        <MotionReview />
      </main>
    </div>
  );
}
