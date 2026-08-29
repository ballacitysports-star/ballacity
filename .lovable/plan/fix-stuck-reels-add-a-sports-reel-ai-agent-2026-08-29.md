# Fix stuck reels + add a sports reel AI agent

## What's wrong today

Uploading a clip inserts a row with `status: processing`, `processing_step: pending` — and then nothing ever picks it up. The processing endpoint exists (`/api/public/reels/process`), but no code, schedule, or button ever calls it, so every reel sits in the queue forever. The one reel in the database right now is in exactly that state (pending, 0 attempts, never started).

## Fix: actually run the pipeline

1. Kick off processing immediately after upload.
   - Add an authenticated server function `processMyReels` (`src/lib/reels.functions.ts`) that runs the existing pipeline for the signed-in user's queued reels only.
   - Move the step pipeline out of the route into `src/lib/reels-pipeline.server.ts` so the route and the server function share one implementation (no logic duplicated).
   - The reels page calls it right after insert, so the row starts moving within a second and the existing realtime subscription streams progress.

2. Add a "Retry" / "Resume processing" action.
   - On any reel stuck in processing or failed, show a button that calls the same server function, so a user is never blocked by a transient AI error.
   - Keep the 3-attempt cap and resume-from-last-step behaviour that already exists.

3. Sweep stuck rows on a schedule.
   - Keep `/api/public/reels/process` as the batch worker and attach a recurring schedule (every 5 minutes) so anything abandoned mid-flight (closed tab, cold error) gets retried without a user present.

4. Real thumbnails instead of the current placeholder.
   - The pipeline currently fakes a thumbnail path by renaming the video file, so thumbnails never load. Capture a frame in the browser at upload time (video element + canvas), upload it alongside the clip, and let the pipeline use that path. The server runtime can't run ffmpeg, so the browser is the right place.

## The sports reel AI agent

Yes — this can be built with Lovable AI, no extra keys. Gemini accepts video as input, so the agent can watch the clip rather than guess from the filename (which is all it does today).

New pipeline step, `analyze`, running before title/caption:
- Sends the uploaded clip to Gemini and gets back structured analysis: sport detected, key moments with timestamps and labels ("layup", "double play", "goal"), a suggested best 15–30s window, and a quality note (shaky, dark, too long).
- Later steps then write the title, caption, and hashtags from real content instead of the filename — noticeably better output.
- Stored on the reel row so the UI can show a "What the AI saw" section: moment chips with timestamps that seek the player when tapped.

Plus a conversational **Reel Coach** on the reels page:
- Chat panel grounded in that analysis: "make the caption funnier", "write a recruiting-style caption", "which moment should be the thumbnail", "what should I film differently next time".
- Streams responses; regenerating the title/caption/hashtags writes straight back to the reel.

## Technical notes

- New columns on `highlight_reels`: `ai_analysis jsonb`, `ai_moments jsonb`, `ai_sport text`, `suggested_clip jsonb`. Migration keeps existing grants and RLS untouched.
- Video is passed to the gateway by signed URL from the reels storage bucket; clips over the model's size limit fall back to the current metadata-only path so nothing hard-fails.
- Chat runs through a server function using the default chat model, with reel analysis as context; gateway 402/429 surface as clear in-app messages, not silent failures.
- `REELS_WORKER_SECRET` is already configured, so the batch worker stays authenticated as-is.

## Open question

Confirm which piece you want first — I can ship the "reels actually process" fix on its own and add the AI agent right after.
