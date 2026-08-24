/** Buckets that hold user-uploaded imagery, and whether they are publicly readable. */
export const IMAGE_BUCKETS = {
  avatars: { public: true, label: "Player avatars" },
  covers: { public: true, label: "Player covers" },
  "org-avatars": { public: true, label: "Gym logos" },
  "org-covers": { public: true, label: "Gym covers & gallery" },
  "team-avatars": { public: true, label: "Team logos" },
  "team-covers": { public: true, label: "Team covers" },
  "trainer-avatars": { public: true, label: "Trainer avatars" },
  "game-covers": { public: false, label: "Game covers" },
} as const;

export type ImageBucketKey = keyof typeof IMAGE_BUCKETS;

export const IMAGE_BUCKET_KEYS = Object.keys(IMAGE_BUCKETS) as ImageBucketKey[];

export const MODERATION_STATUSES = ["pending", "kept", "quarantined", "removed", "all"] as const;
export type ModerationStatus = (typeof MODERATION_STATUSES)[number];

export function isPublicImageBucket(bucket: string): boolean {
  return !!(IMAGE_BUCKETS as Record<string, { public: boolean }>)[bucket]?.public;
}

export function imageBucketLabel(bucket: string): string {
  return (IMAGE_BUCKETS as Record<string, { label: string }>)[bucket]?.label ?? bucket;
}

export function formatBytes(size: number | null | undefined): string {
  if (!size || size <= 0) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
