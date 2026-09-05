import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  ANONYMOUS_ACTOR_ID,
  type Anonymisable,
  type AnonymisationOutcome,
} from '../ports/anonymisable.port.js';

/**
 * Posts, comments, likes and saved posts (BR-009 · ENGAGE-FR-006).
 *
 * BR-009 is the rule and it is the opposite of what most people expect:
 * "posts and comments are ANONYMIZED to 'Deleted User' — THEY ARE NOT ERASED."
 * PRIV-006 says users must be told so before confirming, precisely because it
 * "differs from the erasure many will assume".
 *
 * THE REASON IS THAT A THREAD IS NOT ONE PERSON'S PROPERTY. A neighbourhood
 * discussion about a water outage, with twelve replies, belongs to the twelve
 * people in it. Erasing the opening post to satisfy one of them destroys the
 * other eleven's record of what was agreed — and on a civic platform that
 * record is sometimes the only evidence a complaint was ever raised.
 *
 * SAVED POSTS GO, because a save is private to the saver (FEED-FR-007) and
 * carries no value to anybody else. The distinction that runs through this
 * whole file: what other people can see is kept and unlinked; what only the
 * deleting user could see is deleted.
 */
@Injectable()
export class ContentAnonymiser implements Anonymisable {
  readonly moduleName = 'content';

  async countFor(userId: string, client: PoolClient): Promise<AnonymisationOutcome> {
    const r = await client.query<{ posts: string; comments: string; likes: string; saved: string }>(
      `SELECT
         (SELECT COUNT(*) FROM posts WHERE author_id = $1) AS posts,
         (SELECT COUNT(*) FROM comments WHERE author_id = $1) AS comments,
         (SELECT COUNT(*) FROM likes WHERE user_id = $1) AS likes,
         (SELECT COUNT(*) FROM saved_posts WHERE user_id = $1) AS saved`,
      [userId],
    );
    const row = r.rows[0];
    return {
      module: this.moduleName,
      rowsAnonymised:
        Number(row?.posts ?? 0) + Number(row?.comments ?? 0) + Number(row?.likes ?? 0),
      rowsDeleted: Number(row?.saved ?? 0),
    };
  }

  async anonymise(userId: string, client: PoolClient): Promise<AnonymisationOutcome> {
    // The TEXT stays. Only the author moves.
    const posts = await client.query('UPDATE posts SET author_id = $2 WHERE author_id = $1', [
      userId,
      ANONYMOUS_ACTOR_ID,
    ]);
    const comments = await client.query('UPDATE comments SET author_id = $2 WHERE author_id = $1', [
      userId,
      ANONYMOUS_ACTOR_ID,
    ]);

    // ENGAGE-FR-006: likes are "retained as COUNTS; actor anonymised". The
    // composite primary key is (user_id, post_id), so repointing every like to
    // one actor would collide on any post the anonymous actor already "likes" -
    // and silently drop the count. ON CONFLICT DO NOTHING plus a delete of the
    // survivors keeps the count honest: each post keeps at most one like from
    // the anonymous actor, and the ones that would have collided are removed
    // rather than double-counted.
    //
    // This is the one place the count CAN move, and it moves DOWN by at most
    // the number of posts this user and every previously-erased user both
    // liked. Accepted deliberately: the alternative is a like row that still
    // carries a real person's id after their erasure, which PRIV-007 forbids
    // outright.
    await client.query(
      `INSERT INTO likes (user_id, post_id, created_at)
       SELECT $2, post_id, created_at FROM likes WHERE user_id = $1
       ON CONFLICT (user_id, post_id) DO NOTHING`,
      [userId, ANONYMOUS_ACTOR_ID],
    );
    const likes = await client.query('DELETE FROM likes WHERE user_id = $1', [userId]);

    // Private to the saver, and valuable to nobody else.
    const saved = await client.query('DELETE FROM saved_posts WHERE user_id = $1', [userId]);

    return {
      module: this.moduleName,
      rowsAnonymised: (posts.rowCount ?? 0) + (comments.rowCount ?? 0) + (likes.rowCount ?? 0),
      rowsDeleted: saved.rowCount ?? 0,
    };
  }
}

/**
 * Follows, blocks and events (EVENT-FR-004/005 · SAFETY-FR-005).
 *
 * FOLLOWS GO IN BOTH DIRECTIONS. A follow is a relationship between two live
 * accounts; when one no longer exists the edge describes nothing, and leaving
 * it would keep the erased person's id in somebody else's follower list.
 *
 * BLOCKS GO TOO, and that deserves a note. Somebody who blocked a person for
 * their safety loses that block when the blocked account is erased — which
 * sounds bad until you notice the alternative: a `blocks` row is a record that
 * two specific people are avoiding each other, and keeping one after erasure
 * would preserve exactly the link PRIV-007 requires to be gone. The protection
 * it offered ends with the account it pointed at.
 *
 * RSVPS ARE REMOVED FROM COUNTS (ADR-019's table), because an RSVP is a promise
 * to attend and a deleted account will not. An organiser counting on twelve
 * people should see eleven.
 *
 * EVENTS THEMSELVES ARE KEPT IF FUTURE, organiser anonymised — the neighbours
 * who RSVP'd still need to know when and where.
 */
@Injectable()
export class GraphAnonymiser implements Anonymisable {
  readonly moduleName = 'graph';

  async countFor(userId: string, client: PoolClient): Promise<AnonymisationOutcome> {
    const r = await client.query<{
      follows: string;
      blocks: string;
      rsvps: string;
      events: string;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM follows WHERE follower_id = $1 OR followee_id = $1) AS follows,
         (SELECT COUNT(*) FROM blocks WHERE blocker_id = $1 OR blocked_id = $1) AS blocks,
         (SELECT COUNT(*) FROM event_rsvps WHERE user_id = $1) AS rsvps,
         (SELECT COUNT(*) FROM events WHERE creator_id = $1) AS events`,
      [userId],
    );
    const row = r.rows[0];
    return {
      module: this.moduleName,
      rowsAnonymised: Number(row?.events ?? 0),
      rowsDeleted: Number(row?.follows ?? 0) + Number(row?.blocks ?? 0) + Number(row?.rsvps ?? 0),
    };
  }

  async anonymise(userId: string, client: PoolClient): Promise<AnonymisationOutcome> {
    const follows = await client.query(
      'DELETE FROM follows WHERE follower_id = $1 OR followee_id = $1',
      [userId],
    );
    const blocks = await client.query(
      'DELETE FROM blocks WHERE blocker_id = $1 OR blocked_id = $1',
      [userId],
    );

    // The trigger on `event_rsvps` moves the counts down as these go, which is
    // what "removed from counts" means in practice.
    const rsvps = await client.query('DELETE FROM event_rsvps WHERE user_id = $1', [userId]);

    const events = await client.query('UPDATE events SET creator_id = $2 WHERE creator_id = $1', [
      userId,
      ANONYMOUS_ACTOR_ID,
    ]);

    return {
      module: this.moduleName,
      rowsAnonymised: events.rowCount ?? 0,
      rowsDeleted: (follows.rowCount ?? 0) + (blocks.rowCount ?? 0) + (rsvps.rowCount ?? 0),
    };
  }
}

/**
 * Conversations and messages (BR-046 · ARCH-CONFLICT-004 · EDGE-030).
 *
 * THIS IS THE UNRESOLVED POINT, AND ADR-019 STATES IT PLAINLY RATHER THAN
 * BURYING IT: PRIV-007 requires permanent erasure, and BR-046 says the
 * counterpart keeps their copy of a conversation — which contains messages the
 * deleted user wrote. Those two cannot both be satisfied completely.
 *
 * THE DEFAULT APPLIED, and it is ADR-019's: "retain the message BODY as the
 * counterpart's own record; erase the IDENTITY LINK. The conversation is
 * equally the counterpart's data, and DELETING ONE SIDE OF A TWO-PARTY RECORD
 * DESTROYS THE OTHER PARTY'S HISTORY."
 *
 * IT REQUIRES LEGAL CONFIRMATION UNDER OD-019 BEFORE LAUNCH. The SRS already
 * marks BR-046 and PRIV-006/007 as Legal review. This implements the recorded
 * default; it does not settle the question, and the code says so where somebody
 * changing it will read it.
 *
 * EDGE-030: pending message requests are WITHDRAWN. "Requests are withdrawn
 * from recipients' views. Existing accepted conversations remain for the other
 * participant." So a stranger's unanswered request disappears — nobody is left
 * holding a decision about a person who no longer exists — while a conversation
 * two people actually had stays with the one still here.
 */
@Injectable()
export class MessagingAnonymiser implements Anonymisable {
  readonly moduleName = 'messaging';

  async countFor(userId: string, client: PoolClient): Promise<AnonymisationOutcome> {
    const r = await client.query<{ messages: string; participants: string }>(
      `SELECT
         (SELECT COUNT(*) FROM messages WHERE sender_id = $1) AS messages,
         (SELECT COUNT(*) FROM conversation_participants WHERE user_id = $1) AS participants`,
      [userId],
    );
    const row = r.rows[0];
    return {
      module: this.moduleName,
      rowsAnonymised: Number(row?.messages ?? 0),
      rowsDeleted: Number(row?.participants ?? 0),
    };
  }

  async anonymise(userId: string, client: PoolClient): Promise<AnonymisationOutcome> {
    // EDGE-030, and it runs FIRST — before the participant rows go, while there
    // is still a conversation to find them by. A request nobody can answer is
    // withdrawn; an accepted conversation is left alone.
    await client.query(
      `UPDATE conversation_participants p
          SET request_state = 'WITHDRAWN'
         FROM conversations c
        WHERE p.conversation_id = c.id
          AND p.request_state = 'PENDING'
          AND $1 IN (c.user_low_id, c.user_high_id)
          AND p.user_id <> $1`,
      [userId],
    );

    // The BODY stays; the SENDER moves. This is ARCH-CONFLICT-004's recorded
    // default, pending OD-019.
    const messages = await client.query('UPDATE messages SET sender_id = $2 WHERE sender_id = $1', [
      userId,
      ANONYMOUS_ACTOR_ID,
    ]);

    // BR-046: "removes conversations from the deleting user's side ONLY". Their
    // participant row goes, so the thread leaves their inbox and their unread
    // counts with it. The counterpart's row is untouched, which is what leaves
    // them their copy.
    const participants = await client.query(
      'DELETE FROM conversation_participants WHERE user_id = $1',
      [userId],
    );

    // The conversation ROW is deliberately not deleted. It carries the pair,
    // and the counterpart's participant row points at it - deleting it would
    // cascade away the very copy BR-046 preserves. `user_low_id` and
    // `user_high_id` still name the erased user, so those are repointed too.
    await client.query(
      `UPDATE conversations
          SET user_low_id  = LEAST($2::uuid, CASE WHEN user_low_id = $1 THEN user_high_id ELSE user_low_id END),
              user_high_id = GREATEST($2::uuid, CASE WHEN user_high_id = $1 THEN user_low_id ELSE user_high_id END),
              initiated_by = CASE WHEN initiated_by = $1 THEN $2::uuid ELSE initiated_by END
        WHERE $1 IN (user_low_id, user_high_id)`,
      [userId, ANONYMOUS_ACTOR_ID],
    );

    return {
      module: this.moduleName,
      rowsAnonymised: messages.rowCount ?? 0,
      rowsDeleted: participants.rowCount ?? 0,
    };
  }
}

/**
 * Reports and notifications (ADMIN-FR-002 · NOTIF-FR-002).
 *
 * REPORTS ARE RETAINED WITH AN ANONYMISED REPORTER, because ADR-019 says
 * "moderation history MUST SURVIVE". A person who reports harassment and then
 * deletes their account should not thereby close the case — and an abuser who
 * could clear the reports against them by deleting an account would have found
 * a very cheap way to launder a history.
 *
 * NOTIFICATIONS ADDRESSED TO THEM GO ENTIRELY. A notification is a message to
 * one person; with that person gone it addresses nobody, and NOTIF-FR-002
 * already removes notifications whose target no longer exists.
 *
 * DEVICE TOKENS GO, and that one is not merely tidy: a token is a live delivery
 * credential for a physical handset. Leaving one after erasure would mean the
 * platform could still push to somebody who asked to be forgotten.
 */
@Injectable()
export class SafetyAnonymiser implements Anonymisable {
  readonly moduleName = 'safety-and-notifications';

  async countFor(userId: string, client: PoolClient): Promise<AnonymisationOutcome> {
    const r = await client.query<{
      reports: string;
      notifications: string;
      devices: string;
      prefs: string;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM reports WHERE reporter_id = $1) AS reports,
         (SELECT COUNT(*) FROM notifications WHERE recipient_id = $1 OR actor_id = $1) AS notifications,
         (SELECT COUNT(*) FROM device_tokens WHERE user_id = $1) AS devices,
         (SELECT COUNT(*) FROM notification_preferences WHERE user_id = $1) AS prefs`,
      [userId],
    );
    const row = r.rows[0];
    return {
      module: this.moduleName,
      rowsAnonymised: Number(row?.reports ?? 0),
      rowsDeleted:
        Number(row?.notifications ?? 0) + Number(row?.devices ?? 0) + Number(row?.prefs ?? 0),
    };
  }

  async anonymise(userId: string, client: PoolClient): Promise<AnonymisationOutcome> {
    // `reports` has UNIQUE (reporter_id, target_type, target_id), so repointing
    // two reports of the same item by two erased users would collide. The
    // second is dropped rather than the update failing: the distinct-reporter
    // count that already hid the content was correct when it was taken, and the
    // moderation case carries it.
    await client.query(
      `DELETE FROM reports r
        WHERE r.reporter_id = $1
          AND EXISTS (
            SELECT 1 FROM reports other
             WHERE other.reporter_id = $2
               AND other.target_type = r.target_type
               AND other.target_id = r.target_id
          )`,
      [userId, ANONYMOUS_ACTOR_ID],
    );
    const reports = await client.query(
      'UPDATE reports SET reporter_id = $2, target_owner_id = NULL WHERE reporter_id = $1',
      [userId, ANONYMOUS_ACTOR_ID],
    );

    const notifications = await client.query(
      'DELETE FROM notifications WHERE recipient_id = $1 OR actor_id = $1',
      [userId],
    );
    const devices = await client.query('DELETE FROM device_tokens WHERE user_id = $1', [userId]);
    const prefs = await client.query('DELETE FROM notification_preferences WHERE user_id = $1', [
      userId,
    ]);

    return {
      module: this.moduleName,
      rowsAnonymised: reports.rowCount ?? 0,
      rowsDeleted: (notifications.rowCount ?? 0) + (devices.rowCount ?? 0) + (prefs.rowCount ?? 0),
    };
  }
}

/**
 * The identity itself (PRIV-007).
 *
 * "Personal data is PERMANENTLY ERASED 30 days after deletion is requested."
 * Phone, date of birth, display name, photo, city, bio, sessions.
 *
 * THE USER ROW SURVIVES, in state DELETED. It is not a person any more — every
 * field that described one is gone — but it is what the anonymised content's
 * foreign keys used to point at, and the audit log holds its id pseudonymously
 * under OD-019. Deleting the row would cascade through half the schema and take
 * other people's threads with it.
 *
 * THE IDENTIFIER HASH MOVES TO THE RESERVED LIST rather than being freed, so
 * the number "cannot be recycled while a ban or dispute could still apply"
 * (ADR-019). The hash is not personal data — it cannot be reversed to a number
 * without the pepper, which is deliberately not rotatable for this reason.
 */
@Injectable()
export class IdentityAnonymiser implements Anonymisable {
  readonly moduleName = 'identity';

  async countFor(userId: string, client: PoolClient): Promise<AnonymisationOutcome> {
    const r = await client.query<{ identifiers: string; sessions: string; profiles: string }>(
      `SELECT
         (SELECT COUNT(*) FROM user_identifiers WHERE user_id = $1) AS identifiers,
         (SELECT COUNT(*) FROM sessions WHERE user_id = $1) AS sessions,
         (SELECT COUNT(*) FROM profiles WHERE user_id = $1) AS profiles`,
      [userId],
    );
    const row = r.rows[0];
    return {
      module: this.moduleName,
      rowsAnonymised: Number(row?.profiles ?? 0),
      rowsDeleted: Number(row?.identifiers ?? 0) + Number(row?.sessions ?? 0),
    };
  }

  async anonymise(userId: string, client: PoolClient): Promise<AnonymisationOutcome> {
    // The hash is reserved BEFORE the identifier row is deleted, because after
    // the delete there is nothing left to read it from.
    await client.query(
      `INSERT INTO reserved_identifiers (identifier_hash, reason)
       SELECT value_hash, 'ACCOUNT_ERASED' FROM user_identifiers WHERE user_id = $1
       ON CONFLICT (identifier_hash) DO NOTHING`,
      [userId],
    );

    const identifiers = await client.query('DELETE FROM user_identifiers WHERE user_id = $1', [
      userId,
    ]);
    const sessions = await client.query('DELETE FROM sessions WHERE user_id = $1', [userId]);

    // The profile row is DELETED rather than blanked. A blanked profile is
    // still a profile - it appears in a count, it can be opened, and it says
    // "this person was here". PROFILE rows for erased users should not exist,
    // and every read path already handles a missing one because a user can be
    // mid-onboarding without one.
    const profiles = await client.query('DELETE FROM profiles WHERE user_id = $1', [userId]);

    // The user row stays, stripped. `date_of_birth` cannot be nulled - it is
    // NOT NULL and constrained - so it is set to the same synthetic date the
    // anonymous actor carries, which describes nobody.
    await client.query(
      `UPDATE users
          SET state = 'DELETED',
              username = NULL,
              password_hash = 'account-erased-no-password',
              date_of_birth = DATE '1970-01-01',
              language = NULL,
              suspended_until = NULL,
              state_changed_at = now()
        WHERE id = $1`,
      [userId],
    );

    return {
      module: this.moduleName,
      rowsAnonymised: profiles.rowCount ?? 0,
      rowsDeleted: (identifiers.rowCount ?? 0) + (sessions.rowCount ?? 0),
    };
  }
}
