# Advanced AI Reel Agent

Upgrade the reel AI from "caption writer" into a full highlight agent: it watches the clip more densely, builds an edit plan, produces a jumpable play-by-play timeline, writes a coaching report, and can act on your reel through tools — all without re-encoding video.

## What you get

**1. Auto-edit & cut list**
- The agent proposes a multi-clip edit: ordered segments with start/end times, a one-line reason for each, and suggested pacing (slow-mo, hold, quick cut).
- A "Preview edit" player plays only the chosen segments back-to-back, so you see the cut without exporting anything.
- Per-segment controls: nudge in/out points, drop a segment, reorder. Your edits are saved with the reel.

**2. Play-by-play timeline**
- Timestamped moments ("0:04 — line drive to the gap", "0:11 — turn and burn") shown as a strip under the video.
- Tap any moment to jump the player to that second. Moments also mark up the edit timeline.

**3. Coaching & technique report**
- Sport-aware breakdown using the sport ladders already in the app: what looked strong, 2–3 specific technique notes, and 2–3 drills to work on.
- Includes a confidence note when the footage is too short/blurry to judge, so it never invents detail.

**4. Auto captions & overlay rendering**
- Speech-to-text on the clip's audio produces spoken-word captions with timings.
- The existing on-screen text cards plus captions render live over the player (styled overlay layer), with a toggle for captions and for overlay cards.
- "Copy all" and "Use this post" keep working, now including the timeline and cut list.

**5. Tool-using Reel Coach**
- The coach becomes an agent that can look things up and act: read this reel's analysis, look up the game it came from, read your player profile/sport levels, then apply changes — set the caption, rewrite overlays, replace the cut list, or set the thumbnail moment.
- Every action that changes your reel asks for confirmation in chat before it runs, and shows what it changed.

**6. Denser analysis**
- More frames sampled across the clip (adaptive: more for longer clips), plus the audio track, so moment timing and sport detection get noticeably sharper.
- Progress for the new steps appears in the existing per-step progress checklist on the reel card.

## Technical notes

- **Frames:** `src/lib/reel-frames.ts` gains adaptive sampling (target ~12–24 frames by duration, capped by size) and returns each frame's timestamp so moments carry real seconds instead of frame indices. Audio is extracted client-side into a compressed track for transcription.
- **Pipeline:** `src/lib/reels-pipeline.server.ts` gets new steps after `analyze` — `transcribe`, `timeline`, `editplan`, `coach` — each a step runner writing into `step_progress`, so the live progress bar and resume-on-retry behavior already built continue to work. `STEPS` and the label map in `src/lib/recaps.ts` are extended together.
- **Model calls:** all through Lovable AI Gateway. Vision/analysis steps use `google/gemini-3.7-flash` with the existing `callLovableAIParts` JSON helper; transcription uses the gateway speech-to-text endpoint. Prompts stay small, schemas stay loose with clamping in code.
- **Schema:** one migration adding `ai_timeline jsonb`, `ai_edit_plan jsonb`, `ai_coaching jsonb`, `ai_transcript jsonb`, `frame_times double precision[]`, `audio_path text` to `public.highlight_reels`. Existing RLS/grants on that table already cover them.
- **Agent:** `askReelCoach` in `src/lib/reels.functions.ts` moves to an AI SDK tool loop (`stepCountIs(50)`) with server-side tools: `getReelAnalysis`, `getGameContext`, `getMyProfile`, plus mutating tools `setCaption`, `setOverlays`, `setEditPlan`, `setThumbnailMoment` marked as needing approval. All tools scope every query to `auth.uid()` and to the reel's owner.
- **Player UI:** new `src/components/reels/ReelPlayer.tsx` owns the video element, segment playback, overlay/caption layer, and timeline strip; `ReelCoach.tsx` gains the approval prompts and an edit-plan panel. No video encoding anywhere — playback-time only.
- Reels page keeps its realtime row patching, so new fields stream in as each step completes.
