import {
  getGamePaymentSettings,
  getMyGameRemoval,
  getMyJoinRequest,
  listMySubmissionsForGame,
  type GamePaymentSettings,
  type JoinRequest,
  type PaymentSubmission,
} from "@/lib/payments";

export type GameViewerStatus = {
  settings: GamePaymentSettings | null;
  subs: PaymentSubmission[];
  req: JoinRequest | null;
  /** The host removed the viewer from this game and has not let them back (src/lib/host-removal.ts). */
  removed: boolean;
};

type Loaders = {
  getSettings: (gameId: string) => Promise<GamePaymentSettings | null>;
  listMySubmissions: (gameId: string) => Promise<PaymentSubmission[]>;
  getMyRequest: (gameId: string) => Promise<JoinRequest | null>;
  /** Never rejects: a missing table or a failed read counts as not removed (getMyGameRemoval). */
  getMyRemoval: (gameId: string) => Promise<boolean>;
};

const DEFAULT_LOADERS: Loaders = {
  getSettings: getGamePaymentSettings,
  listMySubmissions: listMySubmissionsForGame,
  getMyRequest: getMyJoinRequest,
  getMyRemoval: getMyGameRemoval,
};

/**
 * The game page's status read: the settings row, then the viewer's own
 * submissions, join request and removal record.
 *
 * The settings row decides the join button (approval, fee), so it is handed to
 * `onSettings` the moment it arrives. The viewer's own rows are read alongside
 * but are not waited for: the page used to set the settings only once all three
 * reads had answered, so one slow submissions or join-request read held the
 * button on the "request to join" default (approval assumed until the settings
 * say otherwise) for as long as that read took. The pay screen made the same
 * split for the same reason.
 *
 * Resolves with all of them once they have all answered, and rejects if the
 * settings, submissions or request read fails, exactly as before; only the
 * settings arrive earlier. The removal read is best effort (a failure reads as
 * not removed): the database refuses a removed player's place either way.
 */
export async function loadGameViewerStatus(
  gameId: string,
  onSettings: (settings: GamePaymentSettings | null) => void,
  loaders: Loaders = DEFAULT_LOADERS,
): Promise<GameViewerStatus> {
  const [settings, subs, req, removed] = await Promise.all([
    loaders.getSettings(gameId).then((s) => {
      onSettings(s);
      return s;
    }),
    loaders.listMySubmissions(gameId),
    loaders.getMyRequest(gameId),
    loaders.getMyRemoval(gameId).catch(() => false),
  ]);
  return { settings, subs, req, removed };
}
