-- Media privacy: stop persisting long-lived signed Storage URLs for private
-- media. Game covers are now stored as `storage://game-covers/<path>` and a
-- short-lived URL is minted per viewer, so access follows current permissions.
UPDATE public.hosted_games
SET image = 'storage://game-covers/' || split_part(
      substring(image from '/storage/v1/object/sign/game-covers/(.*)$'), '?', 1
    )
WHERE image LIKE '%/storage/v1/object/sign/game-covers/%';

-- Same for any chat/media columns that captured a signed URL instead of a path.
UPDATE public.highlight_reels
SET video_path = split_part(substring(video_path from '/storage/v1/object/sign/highlight-videos/(.*)$'), '?', 1)
WHERE video_path LIKE '%/storage/v1/object/sign/highlight-videos/%';