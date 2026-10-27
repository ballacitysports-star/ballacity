/**
 * Client state for the BallaCity Help drawer.
 *
 * One small external store so anything (the floating button, the /contact page,
 * a future "Need help?" link) can open the same drawer, and so the conversation
 * survives closing and reopening it.
 *
 * The conversation lives in memory only. It is never written to storage and is
 * thrown away the moment the signed-in member changes (sign-out, or a guardian
 * switching into and out of a child's profile on a shared device), so one
 * person's questions are never shown to the next.
 */

import { useSyncExternalStore } from "react";
import type { SupportLink } from "./knowledge";
import type { TicketCategory } from "./triage";

export type SupportMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  links?: SupportLink[];
  escalation?: TicketCategory | null;
  source?: "guardrail" | "ai" | "fallback";
};

export type SupportState = {
  open: boolean;
  /** Who the conversation belongs to. Null when signed out. */
  ownerId: string | null;
  messages: SupportMessage[];
  /** The quick-answer card being read, if any. */
  topicId: string | null;
};

const INITIAL: SupportState = { open: false, ownerId: null, messages: [], topicId: null };

let state: SupportState = INITIAL;
const listeners = new Set<() => void>();

function set(next: SupportState) {
  state = next;
  for (const l of [...listeners]) l();
}

export function getSupportState(): SupportState {
  return state;
}

export function subscribeSupport(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSupportState(): SupportState {
  return useSyncExternalStore(subscribeSupport, getSupportState, () => INITIAL);
}

export function openSupport(topicId: string | null = null) {
  set({ ...state, open: true, topicId });
}

export function closeSupport() {
  if (!state.open) return;
  set({ ...state, open: false });
}

export function setSupportTopic(topicId: string | null) {
  set({ ...state, topicId });
}

/** Call whenever the signed-in member changes. A different owner starts from nothing. */
export function setSupportOwner(userId: string | null) {
  if (state.ownerId === userId) return;
  set({ open: false, ownerId: userId, messages: [], topicId: null });
}

export function appendSupportMessage(message: SupportMessage) {
  set({ ...state, messages: [...state.messages, message] });
}

export function clearSupportConversation() {
  set({ ...state, messages: [], topicId: null });
}

/** Test helper: back to a clean, closed, signed-out store. */
export function resetSupportStore() {
  set(INITIAL);
}

let counter = 0;
export function newSupportMessageId(): string {
  counter += 1;
  return `support-${Date.now().toString(36)}-${counter}`;
}
