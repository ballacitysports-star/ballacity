import { useNavigate } from "@tanstack/react-router";
import { useMessageOrGuardian } from "@/components/messages/useMessageOrGuardian";
import { describeMessagingError } from "@/lib/minor-messaging";
import {
  Calendar,
  MapPin,
  MessageCircle,
  Pencil,
  Search,
  Send,
  Share2,
  Ticket,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/UserAvatar";
import { Distance } from "@/components/Distance";
import { RequestStatusPanel } from "@/components/RequestStatusPanel";
import { SPORTS } from "@/lib/sample-data";
import { formatSportLevel, resolvePlayerLevel } from "@/lib/sport-levels";
import { formatAvailabilityWindow } from "@/lib/availability-timeslots";
import type { AvailabilityWithAuthor } from "@/lib/availability";
import { getOrCreateDirectConversation } from "@/lib/messages";
import { shareAvailability } from "./share-availability";

/**
 * Focused view of a single availability post — what a shared
 * `/players?post=<id>` link opens.
 */
export function AvailabilityDetailDialog({
  a,
  isMine,
  canInvite,
  onContact,
  onEdit,
  onClose,
}: {
  a: AvailabilityWithAuthor;
  isMine: boolean;
  canInvite: boolean;
  onContact: () => void;
  onEdit: () => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const when = formatAvailabilityWindow(a);

  const guardianFallback = useMessageOrGuardian();
  const handleMessage = () => guardianFallback.startMessage(a.user_id, a.author_name);

  return (
    <>
    {guardianFallback.dialog}
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isMine ? "Your availability" : "Player availability"}</DialogTitle>
        </DialogHeader>
        <div className="rounded-2xl border border-lime/40 bg-lime/5 p-4">
          <div className="flex items-start gap-3">
            <UserAvatar
              avatarUrl={a.author_avatar_url}
              initials={a.author_initials}
              name={a.author_name}
              size="lg"
              rounded="square"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold truncate">{a.author_name}</p>
                <span className="shrink-0 rounded-full bg-lime/15 px-2 py-0.5 text-[10px] font-bold text-lime">
                  {formatSportLevel(
                    resolvePlayerLevel(a.author_sport_levels, a.sports[0], a.skill_level),
                  ) ?? a.skill_level}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {a.sports.length === 0 ? (
                  <span className="text-xs text-muted-foreground">Any sport</span>
                ) : (
                  a.sports.map((s) => {
                    const emoji = SPORTS.find((sp) => sp.name === s)?.emoji ?? "🎯";
                    return (
                      <span
                        key={s}
                        className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold"
                      >
                        {emoji} {s}
                      </span>
                    );
                  })
                )}
              </div>
              {when && (
                <p className="mt-2 flex items-start gap-1 text-xs text-muted-foreground">
                  <Calendar className="mt-0.5 h-3.5 w-3.5 shrink-0" />{" "}
                  <span className="min-w-0 flex-1 whitespace-normal break-words">{when}</span>
                </p>
              )}
              {(a.city || a.travel_radius_km) && (
                <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5" />
                  {a.city || "Anywhere"} · up to <Distance km={a.travel_radius_km} />
                </p>
              )}
              {a.note && <p className="mt-2 text-sm leading-snug">{a.note}</p>}
            </div>
          </div>
        </div>

        {!isMine && (
          <div className="mt-3">
            <RequestStatusPanel availabilityId={a.id} />
          </div>
        )}

        {isMine ? (
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => shareAvailability(a.id)}
              className="rounded-full"
            >
              <Share2 className="h-4 w-4 mr-1" /> Share
            </Button>
            <Button
              onClick={onEdit}
              className="rounded-full bg-lime-gradient text-primary-foreground"
            >
              <Pencil className="h-4 w-4 mr-1" /> Edit
            </Button>
          </DialogFooter>
        ) : (
          <>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={handleMessage} className="rounded-full">
                <MessageCircle className="h-4 w-4 mr-1" /> Message
              </Button>
              <Button variant="outline" onClick={onContact} className="rounded-full">
                {canInvite ? (
                  <>
                    <Ticket className="h-4 w-4 mr-1" /> Invite
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-1" /> Contact
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  onClose();
                  navigate({ to: "/pickup" });
                }}
                className="rounded-full"
              >
                <Search className="h-4 w-4 mr-1" /> Find a game
              </Button>
              <Button
                variant="outline"
                onClick={() => shareAvailability(a.id)}
                className="rounded-full"
              >
                <Share2 className="h-4 w-4 mr-1" /> Share
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}
