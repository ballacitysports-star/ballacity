import { supabase } from "@/integrations/supabase/client";
import { createNotification } from "@/lib/notifications";

export type Conversation = {
  id: string;
  game_id: string | null;
  created_by: string;
  last_message_at: string;
  created_at: string;
};

export type ConversationParticipant = {
  conversation_id: string;
  user_id: string;
};

export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
  attachment_path?: string | null;
  attachment_type?: string | null;
  attachment_name?: string | null;
  attachment_size?: number | null;
  reply_to_id?: string | null;
  deleted_at?: string | null;
  is_request?: boolean;
};

export type MessageReaction = {
  message_id: string;
  user_id: string;
  emoji: string;
};

export const REACTION_EMOJIS = ["❤️", "😂", "😮", "😢", "🔥", "👍"] as const;

export type Attachment = {
  path: string;
  type: string;
  name: string;
  size: number;
};

export type ConversationWithMeta = Conversation & {
  other_user_id: string | null;
  other_display_name: string | null;
  other_initials: string | null;
  other_avatar_url: string | null;
  last_message: string | null;
  unread: number;
  is_request: boolean;
  accepted_by: string[];
};

// Find or create a 1:1 conversation between current user and otherUserId
export async function getOrCreateDirectConversation(
  otherUserId: string,
  gameId: string | null = null,
): Promise<string> {
  if (!otherUserId) throw new Error("Missing recipient.");
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) {
    await supabase.auth.refreshSession();
    const { data: u2 } = await supabase.auth.getUser();
    if (!u2.user) throw new Error("Sign in to send messages.");
  }

  const { data, error } = await supabase.rpc("create_direct_conversation" as any, {
    _other_user: otherUserId,
    _game_id: gameId,
  });
  if (error) {
    console.error("[messages] create_direct_conversation failed", error);
    throw new Error(error.message || "Could not start conversation.");
  }
  return data as unknown as string;
}

/**
 * Per-conversation preview and unread count.
 *
 * This used to be computed by selecting every message in every conversation
 * the member belongs to and reducing it client-side — the whole message
 * history over the wire on each inbox load, and silently truncated by
 * PostgREST's row cap, which left older threads with no preview and a unread
 * count of zero. `list_conversation_summaries` does it in one query.
 *
 * The old path is kept as a fallback purely so the client and the migration
 * can ship in either order: without it, deploying this build first would break
 * the inbox outright. It can go once the migration is out.
 */
async function conversationSummaries(
  ids: string[],
  me: string,
): Promise<{ lastByConv: Record<string, any>; unreadByConv: Record<string, number> }> {
  const lastByConv: Record<string, any> = {};
  const unreadByConv: Record<string, number> = {};

  const { data, error } = await supabase.rpc("list_conversation_summaries" as any);
  if (!error && Array.isArray(data)) {
    for (const row of data as any[]) {
      if (row.last_created_at) {
        lastByConv[row.conversation_id] = {
          body: row.last_body,
          created_at: row.last_created_at,
          sender_id: row.last_sender_id,
        };
      }
      if (row.unread) unreadByConv[row.conversation_id] = row.unread;
    }
    return { lastByConv, unreadByConv };
  }

  // Fallback: the function is not deployed yet.
  const { data: lastMsgs } = await supabase
    .from("messages" as any)
    .select("conversation_id, body, created_at, sender_id, read_at")
    .in("conversation_id", ids)
    .order("created_at", { ascending: false });
  for (const m of (lastMsgs ?? []) as any[]) {
    if (!lastByConv[m.conversation_id]) lastByConv[m.conversation_id] = m;
    if (m.sender_id !== me && !m.read_at) {
      unreadByConv[m.conversation_id] = (unreadByConv[m.conversation_id] ?? 0) + 1;
    }
  }
  return { lastByConv, unreadByConv };
}

export async function listMyConversations(): Promise<ConversationWithMeta[]> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return [];
  const me = u.user.id;

  const { data: myParts } = await supabase
    .from("conversation_participants" as any)
    .select("conversation_id")
    .eq("user_id", me);
  const ids = ((myParts ?? []) as any[]).map((r) => r.conversation_id);
  if (ids.length === 0) return [];

  const { data: convs } = await supabase
    .from("conversations" as any)
    .select("*")
    .in("id", ids)
    .order("last_message_at", { ascending: false });

  const { data: allParts } = await supabase
    .from("conversation_participants" as any)
    .select("conversation_id, user_id")
    .in("conversation_id", ids);

  const otherIds = Array.from(
    new Set(((allParts ?? []) as any[]).filter((p) => p.user_id !== me).map((p) => p.user_id)),
  );
  let profilesById: Record<
    string,
    { display_name: string; avatar_initials: string | null; avatar_url: string | null }
  > = {};
  if (otherIds.length) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_initials, avatar_url")
      .in("id", otherIds);
    profilesById = Object.fromEntries(((profs ?? []) as any[]).map((p) => [p.id, p]));
  }

  const { lastByConv, unreadByConv } = await conversationSummaries(ids, me);

  return buildConversationList({
    me,
    convs: (convs ?? []) as any[],
    participants: (allParts ?? []) as any[],
    profilesById,
    lastByConv,
    unreadByConv,
  });
}

export type ConversationListInput = {
  me: string;
  convs: any[];
  participants: { conversation_id: string; user_id: string }[];
  profilesById: Record<
    string,
    { display_name?: string | null; avatar_initials?: string | null; avatar_url?: string | null }
  >;
  lastByConv: Record<string, { body?: string | null } | undefined>;
  unreadByConv: Record<string, number>;
};

/**
 * Assemble the inbox rows. Pure, so the parts that have actually gone wrong —
 * whether a thread counts as a request, and what a thread with a missing
 * counterpart renders as — can be tested without a database.
 *
 * A thread is a "request" until you are listed in `accepted_by`, which a
 * trigger fills in when you send your first message. That means a thread
 * created but never written to is a request for everyone, including whoever
 * opened it.
 */
export function buildConversationList(input: ConversationListInput): ConversationWithMeta[] {
  const { me, convs, participants, profilesById, lastByConv, unreadByConv } = input;
  return convs.map((c) => {
    const other = participants.find((p) => p.conversation_id === c.id && p.user_id !== me);
    const prof = other ? profilesById[other.user_id] : null;
    const accepted = (c.accepted_by ?? []) as string[];
    return {
      ...c,
      other_user_id: other?.user_id ?? null,
      other_display_name: prof?.display_name ?? "Player",
      other_initials:
        prof?.avatar_initials ?? prof?.display_name?.slice(0, 2).toUpperCase() ?? "PL",
      other_avatar_url: prof?.avatar_url ?? null,
      last_message: lastByConv[c.id]?.body ?? null,
      unread: unreadByConv[c.id] ?? 0,
      accepted_by: accepted,
      is_request: !accepted.includes(me),
    } as ConversationWithMeta;
  });
}

export async function getConversation(convId: string) {
  const { data, error } = await supabase
    .from("conversations" as any)
    .select("*")
    .eq("id", convId)
    .maybeSingle();
  if (error) throw error;
  return data as unknown as Conversation | null;
}

export async function getConversationOther(convId: string): Promise<{
  user_id: string;
  display_name: string;
  avatar_initials: string | null;
  avatar_url: string | null;
} | null> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return null;
  const { data: parts } = await supabase
    .from("conversation_participants" as any)
    .select("user_id")
    .eq("conversation_id", convId);
  const otherId = ((parts ?? []) as any[]).map((p) => p.user_id).find((id) => id !== u.user!.id);
  if (!otherId) return null;
  const { data: prof } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_initials, avatar_url")
    .eq("id", otherId)
    .maybeSingle();
  return {
    user_id: otherId,
    display_name: (prof as any)?.display_name ?? "Player",
    avatar_initials: (prof as any)?.avatar_initials ?? null,
    avatar_url: (prof as any)?.avatar_url ?? null,
  };
}

export async function listMessages(convId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from("messages" as any)
    .select("*")
    .eq("conversation_id", convId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as Message[];
}

export type UploadOptions = {
  onProgress?: (pct: number) => void;
  signal?: AbortSignal;
};

export async function uploadMessageAttachment(
  convId: string,
  file: File,
  opts: UploadOptions = {},
): Promise<Attachment> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Sign in to send attachments.");
  const MAX = 20 * 1024 * 1024;
  if (file.size > MAX) throw new Error("Attachment too large (max 20MB).");
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  const path = `${convId}/${u.user.id}/${Date.now()}-${safeName}`;
  const contentType = file.type || "application/octet-stream";

  // Use a signed upload URL so we can PUT via XHR and report progress / support cancel.
  const { data: signed, error: signErr } = await supabase.storage
    .from("message-attachments")
    .createSignedUploadUrl(path);
  if (signErr || !signed) throw signErr ?? new Error("Could not start upload.");

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signed.signedUrl, true);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && opts.onProgress) {
        opts.onProgress(Math.round((ev.loaded / ev.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        opts.onProgress?.(100);
        resolve();
      } else {
        reject(new Error(`Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    if (opts.signal) {
      if (opts.signal.aborted) {
        xhr.abort();
        return;
      }
      opts.signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send(file);
  });

  return { path, type: contentType, name: file.name, size: file.size };
}

export async function getAttachmentUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from("message-attachments")
    .createSignedUrl(path, 60 * 60);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export async function sendMessage(
  convId: string,
  body: string,
  attachment?: Attachment | null,
  opts?: { replyToId?: string | null },
) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Sign in to send messages.");
  const me = u.user.id;
  const trimmed = (body ?? "").trim();
  if (!trimmed && !attachment) return;
  const { error } = await supabase.from("messages" as any).insert({
    conversation_id: convId,
    sender_id: me,
    body: trimmed ? trimmed.slice(0, 4000) : null,
    attachment_path: attachment?.path ?? null,
    attachment_type: attachment?.type ?? null,
    attachment_name: attachment?.name ?? null,
    attachment_size: attachment?.size ?? null,
    reply_to_id: opts?.replyToId ?? null,
  } as any);
  if (error) throw error;

  // A recipient who has not accepted the thread is looking at a message
  // request. They still have to hear about it once: this used to notify only
  // people in accepted_by, and a recipient is never in accepted_by before
  // they reply, so the very first message — the one that starts every
  // conversation — reached nobody. The thread sat unread until they happened
  // to open the inbox, which is what "messaging doesn't work" looked like.
  const { data: convRow } = await supabase
    .from("conversations" as any)
    .select("accepted_by")
    .eq("id", convId)
    .maybeSingle();
  const accepted: string[] = ((convRow as any)?.accepted_by ?? []) as string[];

  const { data: parts } = await supabase
    .from("conversation_participants" as any)
    .select("user_id")
    .eq("conversation_id", convId);
  const others = ((parts ?? []) as any[]).map((p) => p.user_id).filter((id) => id !== me);
  const { data: meProf } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", me)
    .maybeSingle();
  const name = (meProf as any)?.display_name ?? "Someone";
  const preview = trimmed ? trimmed.slice(0, 140) : `📎 ${attachment?.name ?? "Attachment"}`;
  const known = others.filter((uid) => accepted.includes(uid));
  const strangers = others.filter((uid) => !accepted.includes(uid));

  // Only the opening message of a request notifies, so someone who has not
  // been accepted cannot push a stream of alerts at a person who never
  // answered. Counted after the insert, so the first message is exactly 1.
  let firstContact = false;
  if (strangers.length > 0) {
    const { count } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", convId)
      .eq("sender_id", me);
    firstContact = (count ?? 0) <= 1;
  }

  await Promise.all([
    ...known.map((uid) =>
      createNotification({
        user_id: uid,
        type: "message",
        title: `New message from ${name}`,
        body: preview,
        link: `/messages/${convId}`,
      }),
    ),
    // Type stays "message" so this counts toward the inbox badge and honours
    // the member's existing message preferences. The body deliberately omits
    // the text: an unaccepted sender should not get to put arbitrary words on
    // someone's lock screen.
    ...(firstContact
      ? strangers.map((uid) =>
          createNotification({
            user_id: uid,
            type: "message",
            title: `Message request from ${name}`,
            body: "They'd like to start a conversation.",
            link: `/messages/${convId}`,
          }),
        )
      : []),
  ]);
}

/**
 * Mark everything the other person sent as read.
 *
 * The result used to be discarded, so a failure here was invisible: the badge
 * simply never cleared and nothing said why. It stays non-throwing — a failed
 * read receipt should not break opening a thread — but it reports, so the next
 * time this breaks there is something to find.
 */
export async function markConversationRead(convId: string): Promise<boolean> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return false;
  const { error } = await supabase
    .from("messages" as any)
    .update({ read_at: new Date().toISOString() } as any)
    .eq("conversation_id", convId)
    .neq("sender_id", u.user.id)
    .is("read_at", null);
  if (error) {
    console.error("[messages] markConversationRead failed", { convId, error });
    return false;
  }
  return true;
}

export async function unsendMessage(messageId: string) {
  // Read the attachment before the RPC nulls the reference, or the file is
  // stranded: unsend_message clears attachment_path and sets deleted_at, but
  // nothing ever removed the object from the bucket. The row stopped pointing
  // at it while the file itself stayed readable to every participant of that
  // conversation for as long as the bucket lived — and any signed URL already
  // handed out kept working regardless. "Unsend" has to mean the file is gone.
  const { data: row } = await supabase
    .from("messages")
    .select("attachment_path")
    .eq("id", messageId)
    .maybeSingle();

  const { error } = await supabase.rpc("unsend_message" as any, { _id: messageId });
  if (error) throw error;

  const path = (row as { attachment_path?: string | null } | null)?.attachment_path;
  if (path) {
    // The bucket's DELETE policy allows the sender only, which is exactly who
    // can reach this. Non-fatal: the message is already unsent either way, and
    // failing here should not make the caller think it wasn't.
    const { error: removeError } = await supabase.storage
      .from("message-attachments")
      .remove([path]);
    if (removeError) {
      console.error("[messages] attachment left in storage after unsend", {
        messageId,
        removeError,
      });
    }
  }
}

export async function acceptConversation(convId: string) {
  const { error } = await supabase.rpc("accept_conversation" as any, { _conv: convId });
  if (error) throw error;
}

export async function declineConversation(convId: string) {
  const { error } = await supabase.rpc("decline_conversation" as any, { _conv: convId });
  if (error) throw error;
}

export async function addReaction(messageId: string, emoji: string) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Sign in first.");
  const { error } = await supabase
    .from("message_reactions" as any)
    .insert({ message_id: messageId, user_id: u.user.id, emoji } as any);
  if (error && !String(error.message).toLowerCase().includes("duplicate")) throw error;
}

export async function removeReaction(messageId: string, emoji: string) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return;
  await supabase
    .from("message_reactions" as any)
    .delete()
    .eq("message_id", messageId)
    .eq("user_id", u.user.id)
    .eq("emoji", emoji);
}

export async function listReactionsFor(messageIds: string[]): Promise<MessageReaction[]> {
  if (messageIds.length === 0) return [];
  const { data } = await supabase
    .from("message_reactions" as any)
    .select("message_id, user_id, emoji")
    .in("message_id", messageIds);
  return (data ?? []) as unknown as MessageReaction[];
}
