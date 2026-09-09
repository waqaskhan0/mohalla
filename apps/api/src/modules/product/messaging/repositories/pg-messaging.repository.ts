import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { DatabaseService } from '../../../../database/database.service.js';
import type { CounterpartState } from '../domain/conversation-pair.js';
import type { RequestState } from '../domain/request-policy.js';
import type {
  ConversationRecord,
  InboxEntry,
  InboxPage,
  MessagePage,
  MessageRecord,
  MessagingRepository,
  ParticipantRecord,
} from './messaging.repository.port.js';

interface ConversationRow {
  id: string;
  user_low_id: string;
  user_high_id: string;
  initiated_by: string;
  last_message_at: Date | null;
  created_at: Date;
}

interface ParticipantRow {
  conversation_id: string;
  user_id: string;
  request_state: RequestState;
  unread_count: number;
  last_read_at: Date | null;
  hidden_at: Date | null;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  client_message_id: string;
  body: string | null;
  media_id: string | null;
  created_at: Date;
}

const toConversation = (r: ConversationRow): ConversationRecord => ({
  id: r.id,
  lowId: r.user_low_id,
  highId: r.user_high_id,
  initiatedBy: r.initiated_by,
  lastMessageAt: r.last_message_at,
  createdAt: r.created_at,
});

const toParticipant = (r: ParticipantRow): ParticipantRecord => ({
  conversationId: r.conversation_id,
  userId: r.user_id,
  requestState: r.request_state,
  unreadCount: r.unread_count,
  lastReadAt: r.last_read_at,
  hiddenAt: r.hidden_at,
});

const toMessage = (r: MessageRow): MessageRecord => ({
  id: r.id,
  conversationId: r.conversation_id,
  senderId: r.sender_id,
  clientMessageId: r.client_message_id,
  body: r.body,
  mediaId: r.media_id,
  createdAt: r.created_at,
});

const CONVERSATION_COLUMNS =
  'id, user_low_id, user_high_id, initiated_by, last_message_at, created_at';
const MESSAGE_COLUMNS =
  'id, conversation_id, sender_id, client_message_id, body, media_id, created_at';

@Injectable()
export class PgMessagingRepository implements MessagingRepository {
  constructor(private readonly db: DatabaseService) {}

  private q<R extends QueryResultRow>(
    client: PoolClient | undefined,
    sql: string,
    params: unknown[],
  ): Promise<QueryResult<R>> {
    return client === undefined ? this.db.query<R>(sql, params) : client.query<R>(sql, params);
  }

  // ---- conversations -----------------------------------------------------
  async findOrCreateConversation(
    input: {
      id: string;
      lowId: string;
      highId: string;
      initiatedBy: string;
      recipientState: RequestState;
    },
    client: PoolClient,
  ): Promise<{ conversation: ConversationRecord; created: boolean }> {
    // ON CONFLICT DO NOTHING rather than select-then-insert. Two first messages
    // crossing in flight would otherwise both find nothing, both insert, and
    // one would hit the UNIQUE constraint as a 500 on a first hello.
    const inserted = await client.query<ConversationRow>(
      `INSERT INTO conversations (id, user_low_id, user_high_id, initiated_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_low_id, user_high_id) DO NOTHING
       RETURNING ${CONVERSATION_COLUMNS}`,
      [input.id, input.lowId, input.highId, input.initiatedBy],
    );

    const row = inserted.rows[0];
    if (row !== undefined) {
      const recipientId = input.initiatedBy === input.lowId ? input.highId : input.lowId;

      // Both participant rows in the same statement, and in the same
      // transaction as the conversation. A conversation with one participant
      // row is a thread nobody can be shown, and the trigger that increments
      // the recipient's unread count would silently find nothing to update.
      await client.query(
        `INSERT INTO conversation_participants (conversation_id, user_id, request_state)
         VALUES ($1, $2, 'ACCEPTED'), ($1, $3, $4)`,
        [row.id, input.initiatedBy, recipientId, input.recipientState],
      );

      return { conversation: toConversation(row), created: true };
    }

    // The conflict path: somebody else's row is there, either from a previous
    // conversation or from the request that raced this one.
    const existing = await client.query<ConversationRow>(
      `SELECT ${CONVERSATION_COLUMNS} FROM conversations
        WHERE user_low_id = $1 AND user_high_id = $2`,
      [input.lowId, input.highId],
    );
    const found = existing.rows[0];
    if (found === undefined) {
      // Unreachable in practice: the insert conflicted, so the row exists.
      throw new Error('conversation vanished between insert and read');
    }
    return { conversation: toConversation(found), created: false };
  }

  async findConversationById(id: string, client?: PoolClient): Promise<ConversationRecord | null> {
    const r = await this.q<ConversationRow>(
      client,
      `SELECT ${CONVERSATION_COLUMNS} FROM conversations WHERE id = $1`,
      [id],
    );
    const row = r.rows[0];
    return row === undefined ? null : toConversation(row);
  }

  async findConversationForPair(
    lowId: string,
    highId: string,
    client?: PoolClient,
  ): Promise<ConversationRecord | null> {
    const r = await this.q<ConversationRow>(
      client,
      `SELECT ${CONVERSATION_COLUMNS} FROM conversations
        WHERE user_low_id = $1 AND user_high_id = $2`,
      [lowId, highId],
    );
    const row = r.rows[0];
    return row === undefined ? null : toConversation(row);
  }

  // ---- participants ------------------------------------------------------
  async findParticipant(
    conversationId: string,
    userId: string,
    client?: PoolClient,
  ): Promise<ParticipantRecord | null> {
    const r = await this.q<ParticipantRow>(
      client,
      `SELECT conversation_id, user_id, request_state, unread_count, last_read_at, hidden_at
         FROM conversation_participants
        WHERE conversation_id = $1 AND user_id = $2`,
      [conversationId, userId],
    );
    const row = r.rows[0];
    return row === undefined ? null : toParticipant(row);
  }

  async setRequestState(
    conversationId: string,
    userId: string,
    state: RequestState,
    client: PoolClient,
  ): Promise<boolean> {
    const r = await client.query(
      `UPDATE conversation_participants SET request_state = $3
        WHERE conversation_id = $1 AND user_id = $2 AND request_state <> $3`,
      [conversationId, userId, state],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async setHidden(
    conversationId: string,
    userId: string,
    hiddenAt: Date | null,
    client: PoolClient,
  ): Promise<boolean> {
    const r = await client.query(
      `UPDATE conversation_participants SET hidden_at = $3
        WHERE conversation_id = $1 AND user_id = $2`,
      [conversationId, userId, hiddenAt],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async setHiddenForBlocker(
    blockerId: string,
    blockedId: string,
    hiddenAt: Date | null,
    client: PoolClient,
  ): Promise<number> {
    // The BLOCKER's side only. Hiding the blocked user's copy too would be a
    // disclosure: a thread that vanishes from your inbox tells you exactly what
    // happened, which BR-025 forbids.
    const r = await client.query(
      `UPDATE conversation_participants p
          SET hidden_at = $3
         FROM conversations c
        WHERE p.conversation_id = c.id
          AND p.user_id = $1
          AND $2 IN (c.user_low_id, c.user_high_id)`,
      [blockerId, blockedId, hiddenAt],
    );
    return r.rowCount ?? 0;
  }

  async promotePendingRequest(
    recipientId: string,
    senderId: string,
    client: PoolClient,
  ): Promise<boolean> {
    const r = await client.query(
      `UPDATE conversation_participants p
          SET request_state = 'ACCEPTED'
         FROM conversations c
        WHERE p.conversation_id = c.id
          AND p.user_id = $1
          AND $2 IN (c.user_low_id, c.user_high_id)
          AND p.request_state = 'PENDING'`,
      [recipientId, senderId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  // ---- messages ----------------------------------------------------------
  async insertMessage(
    input: {
      id: string;
      conversationId: string;
      senderId: string;
      clientMessageId: string;
      body: string | null;
      mediaId: string | null;
    },
    client: PoolClient,
  ): Promise<{ message: MessageRecord; created: boolean }> {
    const inserted = await client.query<MessageRow>(
      `INSERT INTO messages (id, conversation_id, sender_id, client_message_id, body, media_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (conversation_id, client_message_id) DO NOTHING
       RETURNING ${MESSAGE_COLUMNS}`,
      [
        input.id,
        input.conversationId,
        input.senderId,
        input.clientMessageId,
        input.body,
        input.mediaId,
      ],
    );

    const row = inserted.rows[0];
    if (row !== undefined) return { message: toMessage(row), created: true };

    // The replay path. Return the ORIGINAL row rather than the payload that was
    // just re-sent: EDGE-021 says a duplicate renders once, and the original is
    // what the other participant already has. Returning the retry's timestamp
    // would move the message in one client's ordering and not the other's.
    //
    // `sender_id` is in the WHERE clause, so a caller replaying somebody else's
    // client id gets nothing rather than a message they did not write.
    const existing = await client.query<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS} FROM messages
        WHERE conversation_id = $1 AND client_message_id = $2 AND sender_id = $3`,
      [input.conversationId, input.clientMessageId, input.senderId],
    );
    const found = existing.rows[0];
    if (found === undefined) {
      // The id is taken by the OTHER participant's message. Two devices cannot
      // legitimately collide on a UUIDv7, so this is a client sending an id it
      // did not generate.
      throw Object.assign(new Error('client message id belongs to another sender'), {
        code: '42501',
      });
    }
    return { message: toMessage(found), created: false };
  }

  async listMessages(
    conversationId: string,
    limit: number,
    cursor: { createdAt: Date; id: string } | undefined,
    client?: PoolClient,
  ): Promise<MessagePage> {
    const params: unknown[] = [conversationId, limit + 1];
    let keyset = '';
    if (cursor !== undefined) {
      params.push(cursor.createdAt, cursor.id);
      keyset = ' AND (created_at, id) < ($3, $4)';
    }

    const r = await this.q<MessageRow>(
      client,
      `SELECT ${MESSAGE_COLUMNS} FROM messages
        WHERE conversation_id = $1${keyset}
        ORDER BY created_at DESC, id DESC
        LIMIT $2`,
      params,
    );

    const hasMore = r.rows.length > limit;
    const rows = hasMore ? r.rows.slice(0, limit) : r.rows;
    const last = rows[rows.length - 1];
    return {
      messages: rows.map(toMessage),
      nextCursor:
        hasMore && last !== undefined ? { createdAt: last.created_at, id: last.id } : null,
    };
  }

  async listMessagesSince(
    conversationId: string,
    since: Date,
    limit: number,
    client?: PoolClient,
  ): Promise<MessageRecord[]> {
    // Strictly greater than, so a client that reconnects with the timestamp of
    // the last message it holds does not receive that message again. The client
    // id would make a re-delivery harmless, but sending it is still wasted
    // bytes on a mobile connection (D-03).
    const r = await this.q<MessageRow>(
      client,
      `SELECT ${MESSAGE_COLUMNS} FROM messages
        WHERE conversation_id = $1 AND created_at > $2
        ORDER BY created_at ASC, id ASC
        LIMIT $3`,
      [conversationId, since, limit],
    );
    return r.rows.map(toMessage);
  }

  // ---- inbox -------------------------------------------------------------
  async listInbox(
    userId: string,
    states: readonly RequestState[],
    limit: number,
    before: Date | undefined,
    client?: PoolClient,
  ): Promise<InboxPage> {
    const params: unknown[] = [userId, [...states], limit + 1];
    let keyset = '';
    if (before !== undefined) {
      params.push(before);
      // COALESCE, because a conversation with no messages yet sorts by when it
      // was created. Without it a thread whose only message failed to send
      // would sort to the bottom and look lost.
      keyset = ' AND COALESCE(c.last_message_at, c.created_at) < $4';
    }

    const r = await this.q<{
      conversation_id: string;
      other_user_id: string;
      request_state: RequestState;
      unread_count: number;
      last_message_at: Date | null;
      sort_at: Date;
      preview_body: string | null;
      preview_has_media: boolean;
      preview_sender_id: string | null;
      other_user_state: CounterpartState;
    }>(
      client,
      `SELECT c.id AS conversation_id,
              other.user_id AS other_user_id,
              me.request_state,
              me.unread_count,
              c.last_message_at,
              COALESCE(c.last_message_at, c.created_at) AS sort_at,
              last_msg.body AS preview_body,
              (last_msg.media_id IS NOT NULL) AS preview_has_media,
              last_msg.sender_id AS preview_sender_id,
              u.state AS other_user_state
         FROM conversation_participants me
         JOIN conversations c ON c.id = me.conversation_id
         JOIN conversation_participants other
           ON other.conversation_id = c.id AND other.user_id <> me.user_id
         JOIN users u ON u.id = other.user_id
         LEFT JOIN LATERAL (
           SELECT m.body, m.media_id, m.sender_id
             FROM messages m
            WHERE m.conversation_id = c.id
            ORDER BY m.created_at DESC, m.id DESC
            LIMIT 1
         ) last_msg ON true
        WHERE me.user_id = $1
          AND me.request_state = ANY($2::message_request_state[])
          -- EDGE-019 / MSG-FR-003: "blocked users' conversations are hidden
          -- while the block stands and restored on unblock". One column, so
          -- nothing has to be deleted and nothing has to be put back.
          AND me.hidden_at IS NULL
          -- AN EMPTY THREAD IS NOT A CONVERSATION. Opening one creates the row
          -- (BR-024 wants exactly one, ever, so it is created on first open
          -- rather than on first send) but MSG-FR-003 lists conversations "by
          -- most recent activity, showing... a message preview", and there is
          -- neither. Without this, tapping Message on a profile and changing
          -- your mind puts a REQUEST BADGE on that person's phone - a
          -- notification of contact that never happened, from the one feature
          -- built to prevent unwanted contact.
          AND c.last_message_at IS NOT NULL${keyset}
        ORDER BY sort_at DESC
        LIMIT $3`,
      params,
    );

    const hasMore = r.rows.length > limit;
    const rows = hasMore ? r.rows.slice(0, limit) : r.rows;
    const last = rows[rows.length - 1];

    const entries: InboxEntry[] = rows.map((row) => ({
      conversationId: row.conversation_id,
      otherUserId: row.other_user_id,
      requestState: row.request_state,
      unreadCount: row.unread_count,
      lastMessageAt: row.last_message_at,
      previewBody: row.preview_body,
      previewHasMedia: row.preview_has_media,
      previewSenderId: row.preview_sender_id,
      otherUserState: row.other_user_state,
    }));

    return {
      entries,
      nextBefore: hasMore && last !== undefined ? last.sort_at : null,
    };
  }

  async countUnread(
    userId: string,
    client?: PoolClient,
  ): Promise<{ conversations: number; requests: number }> {
    // Counts CONVERSATIONS with something unread, not unread messages. The
    // inbox shows a badge per thread and a count of threads; a total of 400
    // unread messages across two threads is not what "2" means on that screen.
    const r = await this.q<{ accepted: string; pending: string }>(
      client,
      `SELECT
         COUNT(*) FILTER (WHERE p.request_state = 'ACCEPTED' AND p.unread_count > 0) AS accepted,
         COUNT(*) FILTER (WHERE p.request_state = 'PENDING') AS pending
       FROM conversation_participants p
       JOIN conversations c ON c.id = p.conversation_id
      WHERE p.user_id = $1
        AND p.hidden_at IS NULL
        -- Same rule as the listing, and it matters more here: this is the
        -- number on the badge. See listInbox for why an empty thread counts
        -- as nothing.
        AND c.last_message_at IS NOT NULL`,
      [userId],
    );
    const row = r.rows[0];
    return {
      conversations: Number(row?.accepted ?? 0),
      // Every pending request counts, read or not — MSG-FR-005 shows "a request
      // count", and reading a request must not change what the sender or the
      // recipient sees anywhere (MSG-FR-009).
      requests: Number(row?.pending ?? 0),
    };
  }

  async markRead(
    conversationId: string,
    userId: string,
    at: Date,
    client: PoolClient,
  ): Promise<Date | null> {
    // GREATEST, so a slow request arriving after a newer one cannot move the
    // marker backwards and un-read messages the user has already seen.
    const r = await client.query<{ last_read_at: Date | null }>(
      `UPDATE conversation_participants
          SET last_read_at = GREATEST(COALESCE(last_read_at, $3), $3),
              unread_count = 0
        WHERE conversation_id = $1 AND user_id = $2
        RETURNING last_read_at`,
      [conversationId, userId, at],
    );
    return r.rows[0]?.last_read_at ?? null;
  }

  // ---- request quota -----------------------------------------------------
  async countRecentRequestsBy(senderId: string, since: Date, client?: PoolClient): Promise<number> {
    // Counts threads this sender OPENED that landed as requests and have not
    // been accepted. An accepted thread stops counting, which is the right
    // shape: the limit is on unsolicited contact, and an accepted conversation
    // is by definition no longer unsolicited.
    const r = await this.q<{ n: string }>(
      client,
      `SELECT COUNT(*) AS n
         FROM conversations c
         JOIN conversation_participants p
           ON p.conversation_id = c.id AND p.user_id <> c.initiated_by
        WHERE c.initiated_by = $1
          AND c.created_at >= $2
          AND p.request_state <> 'ACCEPTED'`,
      [senderId, since],
    );
    return Number(r.rows[0]?.n ?? 0);
  }

  // ---- read-side helper --------------------------------------------------
  async counterpartState(userId: string, client?: PoolClient): Promise<CounterpartState | null> {
    const r = await this.q<{ state: CounterpartState }>(
      client,
      'SELECT state FROM users WHERE id = $1',
      [userId],
    );
    return r.rows[0]?.state ?? null;
  }
}
