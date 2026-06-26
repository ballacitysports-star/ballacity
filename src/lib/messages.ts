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
  body: string;
  read_at: string | null;
  created_at: string;
};

export type ConversationWithMeta = Conversation & {
  other_user_id: string | null;
  other_display_name: string | null;
  other_initials: string | null;
  last_message: string | null;
  unread: number;
};

// Find or create a 1:1 conversation between current user and otherUserId
export async function getOrCreateDirectConversation(otherUserId: string, gameId: string | null = null): Promise<string> {
  // Ensure we have a fresh session so auth.uid() on the server matches `me`.
  // A stale/expired JWT causes "new row violates row-level security policy".
  let { data: sess } = await supabase.auth.getSession();
  if (!sess.session) {
    const refreshed = await supabase.auth.refreshSession();
    sess = { session: refreshed.data.session } as any;
  }
  if (!sess.session?.user) throw new Error("Sign in to send messages.");
  const me = sess.session.user.id;
  if (me === otherUserId) throw new Error("You can't message yourself.");



  // Find existing: conversations where both users are participants
  const { data: mine } = await supabase
    .from("conversation_participants" as any)
    .select("conversation_id")
    .eq("user_id", me);
  const myConvIds = ((mine ?? []) as any[]).map((r) => r.conversation_id);
  if (myConvIds.length > 0) {
    const { data: shared } = await supabase
      .from("conversation_participants" as any)
      .select("conversation_id")
      .eq("user_id", otherUserId)
      .in("conversation_id", myConvIds);
    const sharedIds = ((shared ?? []) as any[]).map((r) => r.conversation_id);
    if (sharedIds.length > 0) return sharedIds[0];
  }

  // Create new
  const { data: conv, error } = await supabase
    .from("conversations" as any)
    .insert({ created_by: me, game_id: gameId } as any)
    .select("id")
    .single();
  if (error) {
    console.error("[messages] create conversation failed", error);
    throw new Error(error.message || "Could not start conversation.");
  }

  const convId = (conv as any).id as string;
  const { error: pErr } = await supabase
    .from("conversation_participants" as any)
    .insert([{ conversation_id: convId, user_id: me }, { conversation_id: convId, user_id: otherUserId }] as any);
  if (pErr) throw pErr;
  return convId;
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

  const otherIds = Array.from(new Set(((allParts ?? []) as any[]).filter((p) => p.user_id !== me).map((p) => p.user_id)));
  let profilesById: Record<string, { display_name: string; avatar_initials: string | null }> = {};
  if (otherIds.length) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_initials")
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
    const others = ((allParts ?? []) as any[]).filter((p) => p.conversation_id === c.id && p.user_id !== me);
    const other = others[0];
    const prof = other ? profilesById[other.user_id] : null;
    return {
      ...c,
      other_user_id: other?.user_id ?? null,
      other_display_name: prof?.display_name ?? "Player",
      other_initials: prof?.avatar_initials ?? (prof?.display_name?.slice(0, 2).toUpperCase() ?? "PL"),
      last_message: lastByConv[c.id]?.body ?? null,
      unread: unreadByConv[c.id] ?? 0,
    } as ConversationWithMeta;
  });
}

export async function getConversation(convId: string) {
  const { data, error } = await supabase.from("conversations" as any).select("*").eq("id", convId).maybeSingle();
  if (error) throw error;
  return data as unknown as Conversation | null;
}

export async function getConversationOther(convId: string): Promise<{ user_id: string; display_name: string; avatar_initials: string | null } | null> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return null;
  const { data: parts } = await supabase
    .from("conversation_participants" as any)
    .select("user_id")
    .eq("conversation_id", convId);
  const otherId = ((parts ?? []) as any[]).map((p) => p.user_id).find((id) => id !== u.user!.id);
  if (!otherId) return null;
  const { data: prof } = await supabase.from("profiles").select("id, display_name, avatar_initials").eq("id", otherId).maybeSingle();
  return {
    user_id: otherId,
    display_name: (prof as any)?.display_name ?? "Player",
    avatar_initials: (prof as any)?.avatar_initials ?? null,
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

export async function sendMessage(convId: string, body: string) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Sign in to send messages.");
  const me = u.user.id;
  const trimmed = body.trim();
  if (!trimmed) return;
  const { error } = await supabase.from("messages" as any).insert({
    conversation_id: convId,
    sender_id: me,
    body: trimmed.slice(0, 4000),
  } as any);
  if (error) throw error;

  // Notify other participants
  const { data: parts } = await supabase
    .from("conversation_participants" as any)
    .select("user_id")
    .eq("conversation_id", convId);
  const others = ((parts ?? []) as any[]).map((p) => p.user_id).filter((id) => id !== me);
  const { data: meProf } = await supabase.from("profiles").select("display_name").eq("id", me).maybeSingle();
  const name = (meProf as any)?.display_name ?? "Someone";
  await Promise.all(others.map((uid) =>
    createNotification({
      user_id: uid,
      type: "message",
      title: `New message from ${name}`,
      body: trimmed.slice(0, 140),
      link: `/messages/${convId}`,
    })
  ));
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
