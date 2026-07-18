import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { UserPlus, UserCheck, MessageCircle, CalendarClock } from "lucide-react";
import { toast } from "sonner";
import type { Org } from "@/lib/sample-data";
import { useFollow } from "@/lib/follows";
import { useAuth } from "@/hooks/use-auth";
import { BookSessionSheet } from "@/components/BookSessionSheet";

export function TrainerActions({ org }: { org: Org }) {
  const nav = useNavigate();
  const { user } = useAuth();
  const { isFollowing, pending, toggle } = useFollow(org.id);
  const [bookOpen, setBookOpen] = useState(false);

  const requireAuth = () => {
    if (!user) {
      toast("Sign in to continue");
      nav({ to: "/auth" });
      return false;
    }
    return true;
  };

  return (
    <>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!requireAuth()) return;
            toggle();
          }}
          disabled={pending}
          className={`inline-flex items-center justify-center gap-1.5 rounded-full border px-2.5 py-2 text-xs font-semibold transition-colors ${
            isFollowing
              ? "border-lime/60 bg-lime/10 text-lime"
              : "border-border bg-surface text-foreground hover:border-lime/50"
          } disabled:opacity-60`}
          aria-pressed={isFollowing}
          aria-label={isFollowing ? "Unfollow trainer" : "Follow trainer"}
        >
          {isFollowing ? <UserCheck className="h-3.5 w-3.5" /> : <UserPlus className="h-3.5 w-3.5" />}
          <span className="truncate">{isFollowing ? "Following" : "Follow"}</span>
        </button>

        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!requireAuth()) return;
            nav({ to: "/inbox", search: { to: org.id } as never });
          }}
          className="inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-2 text-xs font-semibold text-foreground hover:border-lime/50"
          aria-label={`Message ${org.name}`}
        >
          <MessageCircle className="h-3.5 w-3.5" />
          <span className="truncate">Message</span>
        </button>

        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!requireAuth()) return;
            setBookOpen(true);
          }}
          className="inline-flex items-center justify-center gap-1.5 rounded-full bg-lime-gradient px-2.5 py-2 text-xs font-bold text-primary-foreground glow-lime"
          aria-label={`Request availability from ${org.name}`}
        >
          <CalendarClock className="h-3.5 w-3.5" />
          <span className="truncate">Request</span>
        </button>
      </div>

      <BookSessionSheet org={org} open={bookOpen} onOpenChange={setBookOpen} />
    </>
  );
}
