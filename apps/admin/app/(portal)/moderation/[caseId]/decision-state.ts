import type { ConversationExcerpt } from '../../../../lib/admin-api/schemas';

/**
 * The state the decision and conversation forms carry between submissions.
 *
 * IN ITS OWN MODULE because `actions.ts` is a `'use server'` file, and such a
 * file "can only export async functions". Exporting a type or a constant from
 * it is a build error, not a lint warning — the login form learned that in
 * Group 02.
 */

/** The three peer outcomes, and nothing else is accepted. */
export const OUTCOMES = ['restore', 'delete', 'no-action'] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** BR-038 — the API's own bounds, restated so the field can say them first. */
export const REASON_MIN = 5;
export const REASON_MAX = 500;

export type DecisionState =
  | { status: 'IDLE' }
  /** The decision was applied. The page re-renders showing the resolution. */
  | { status: 'APPLIED'; outcome: Outcome }
  /**
   * EDGE-024 — somebody else got there first.
   *
   * Carried as three named facts rather than a message, because the
   * requirement is that the second administrator is told the case "was already
   * resolved, BY WHOM AND HOW - not shown a generic error".
   */
  | { status: 'ALREADY_RESOLVED'; resolvedBy: string; outcome: string; version: string }
  /** A field the reader can fix, named so the field itself can show it. */
  | { status: 'INVALID'; field: 'reason' | 'outcome'; message: string }
  /** Everything else. `nothingChanged` is the fact the reader needs most. */
  | { status: 'FAILED'; message: string; reference?: string };

export const IDLE_DECISION: DecisionState = { status: 'IDLE' };

export type ConversationState =
  /**
   * THE STARTING STATE, AND IT IS NOT "LOADING".
   *
   * Reading a reported conversation writes an audit entry naming the
   * administrator and the conversation (MSG-FR-007, PRIV-009). So the excerpt
   * is not fetched until somebody asks for it: a page that loaded it on render
   * would record a look at somebody's private messages every time a case was
   * opened for any reason at all.
   */
  | { status: 'NOT_REQUESTED' }
  | { status: 'READ'; messages: ConversationExcerpt['messages'] }
  | { status: 'FAILED'; message: string; reference?: string };

export const UNREAD_CONVERSATION: ConversationState = { status: 'NOT_REQUESTED' };
