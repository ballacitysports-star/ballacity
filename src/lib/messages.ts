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


  // Last message per conversation
  const { data: lastMsgs } = await supabase
    .from("messages" as any)
    .select("conversation_id, body, created_at, sender_id, read_at")
    .in("conversation_id", ids)
    .order("created_at", { ascending: false });

  const lastByConv: Record<string, any> = {};
  const unreadByConv: Record<string, number> = {};
  for (const m of (lastMsgs ?? []) as any[]) {
    if (!lastByConv[m.conversation_id]) lastByConv[m.conversation_id] = m;
    if (m.sender_id !== me && !m.read_at) {
      unreadByConv[m.conversation_id] = (unreadByConv[m.conversation_id] ?? 0) + 1;
    }
  }

  return ((convs ?? []) as any[]).map((c) => {
    const others = ((allParts ?? []) as any[]).filter(
      (p) => p.conversation_id === c.id && p.user_id !== me,
    );
    const other = others[0];
    const prof = other ? profilesById[other.user_id] : null;
    return {
      ...c,
      other_user_id: other?.user_id ?? null,
      other_display_name: prof?.display_name ?? "Player",
      other_initials:
        prof?.avatar_initials ?? prof?.display_name?.slice(0, 2).toUpperCase() ?? "PL",
      other_avatar_url: prof?.avatar_url ?? null,
      last_message: lastByConv[c.id]?.body ?? null,
      unread: unreadByConv[c.id] ?? 0,
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

export async function getConversationOther(
  convId: string,
): Promise<{
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

export async function sendMessage(convId: string, body: string, attachment?: Attachment | null) {
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
  } as any);
  if (error) throw error;

  // Notify other participants
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
  await Promise.all(
    others.map((uid) =>
      createNotification({
        user_id: uid,
        type: "message",
        title: `New message from ${name}`,
        body: preview,
        link: `/messages/${convId}`,
      }),
    ),
  );
}

export async function markConversationRead(convId: string) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return;
  await supabase
    .from("messages" as any)
    .update({ read_at: new Date().toISOString() } as any)
    .eq("conversation_id", convId)
    .neq("sender_id", u.user.id)
    .is("read_at", null);
}
