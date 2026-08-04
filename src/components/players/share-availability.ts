/**
 * Copy a shareable link to a single availability post.
 * The canonical URL is the Players tab with a `post` param, which opens the
 * post in a focused dialog (see /players).
 */
import { toast } from "sonner";

export function availabilityPostPath(id: string) {
  return `/players?post=${encodeURIComponent(id)}`;
}

export async function shareAvailability(id: string) {
  const url = `${window.location.origin}${availabilityPostPath(id)}`;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(url);
    } else {
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    toast.success("Link copied", {
      description: "Share it with anyone you want to reach this post.",
    });
  } catch (e: any) {
    toast.error("Couldn't copy link", {
      description: e?.message || "Please copy the URL manually.",
    });
  }
}
