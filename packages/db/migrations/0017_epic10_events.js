/**
 * 0017 — EPIC-10 · events and RSVPs.
 *
 * `07-database-design.md` §2.6.
 *
 * EVENTS ARE THE MOBILIZATION LAYER — EVENT-FR-001 calls them "the product's
 * clearest differentiator from a general social feed". That is also why the
 * rules here are stricter than the ones on posts: a fake gathering does not
 * merely waste a scroll, it wastes a real journey.
 *
 * FOUR RULES MADE STRUCTURAL.
 *
 * 1. TYPE DETERMINES WHICH FIELD IS REQUIRED (EVENT-FR-002), as a conditional
 *    CHECK rather than an application `if`. An ONLINE event without a link is
 *    an event nobody can attend, and a PHYSICAL event without a location is the
 *    same thing; both are unrepresentable rather than merely rejected.
 *
 * 2. ONE RSVP PER USER PER EVENT, by composite primary key. EVENT-FR-004's
 *    acceptance criterion — "GIVEN a user changes from Interested to Going...
 *    THEN they are counted once, under Going" — is then a property of the key,
 *    not of remembering to UPDATE rather than INSERT.
 *
 * 3. COUNTS MOVE BY TRIGGER, including on the change from Interested to Going,
 *    which has to decrement one and increment the other in the same statement.
 *    Doing that in the application means every future path has to remember.
 *
 * 4. THE THRESHOLD IS TWO, NOT THREE. BR-044, and the requirement gives the
 *    reason: "a fake gathering wastes real travel and time". The column is here;
 *    EPIC-12 owns the counting.
 *
 * WHAT IS DELIBERATELY ABSENT: any read path from `event_rsvps` to a list of
 * people. ARCH-CONFLICT-006 / D-17 — EVENT-FR-004 permits a public COUNT but
 * states the attendee list is not shown in V1. The table exists because RSVP is
 * one-per-user and because reminders must be addressed (EVENT-FR-008), not
 * because anyone can read who is going.
 */

exports.shorthands = undefined;

exports.up = async (pgm) => {
  pgm.sql(`
    CREATE TYPE event_type AS ENUM ('ONLINE', 'PHYSICAL');
    CREATE TYPE event_status AS ENUM ('SCHEDULED', 'CANCELLED');
    CREATE TYPE event_visibility_state AS ENUM ('VISIBLE', 'AUTO_HIDDEN', 'ADMIN_REMOVED');
    CREATE TYPE rsvp_response AS ENUM ('GOING', 'INTERESTED');
  `);

  // ---------------------------------------------------------------- events
  pgm.createTable('events', {
    id: { type: 'uuid', primaryKey: true },
    // BR-043: "any active user may create events. Creation is not restricted
    // to verified organizations." No role column, because there is no role to
    // record - the absence is the rule.
    creator_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    title: { type: 'text', notNull: true },
    description: { type: 'text', notNull: true },
    /**
     * Stored with its timezone, displayed in Pakistan Standard Time (§12).
     * `timestamptz` rather than a local time plus a zone name: an event has one
     * instant, and every reminder, ordering and "has it started" comparison in
     * this file depends on that being unambiguous.
     */
    starts_at: { type: 'timestamptz', notNull: true },
    event_type: { type: 'event_type', notNull: true },
    /** ONLINE only. BR-045: the platform hosts no video; this always links out. */
    meeting_url: { type: 'text', notNull: false },
    /** PHYSICAL only. Free text - Pakistan has no reliable address database. */
    location_text: { type: 'text', notNull: false },
    category_id: { type: 'uuid', notNull: false, references: 'categories', onDelete: 'SET NULL' },
    status: { type: 'event_status', notNull: true, default: 'SCHEDULED' },
    visibility_state: { type: 'event_visibility_state', notNull: true, default: 'VISIBLE' },

    going_count: { type: 'integer', notNull: true, default: 0 },
    interested_count: { type: 'integer', notNull: true, default: 0 },
    /** BR-044: two, not three. Maintained by EPIC-12 with the threshold check. */
    distinct_report_count: { type: 'integer', notNull: true, default: 0 },

    edited_at: { type: 'timestamptz', notNull: false },
    cancelled_at: { type: 'timestamptz', notNull: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.sql(`
    -- EVENT-FR-002: "exactly one type per event", and the type decides which
    -- field is mandatory. A conditional CHECK rather than an application 'if',
    -- because an ONLINE event with no link is an event nobody can attend.
    ALTER TABLE events ADD CONSTRAINT events_type_requires_its_field
      CHECK (
        (event_type = 'ONLINE'   AND meeting_url   IS NOT NULL AND location_text IS NULL)
        OR
        (event_type = 'PHYSICAL' AND location_text IS NOT NULL AND meeting_url   IS NULL)
      );

    -- §12 field bounds. As elsewhere, these are BYTE ceilings on top of the
    -- character limits the application enforces - char_length cannot count
    -- grapheme clusters, and Urdu would be charged twice over if it tried.
    ALTER TABLE events ADD CONSTRAINT events_title_length
      CHECK (char_length(title) BETWEEN 3 AND 120 AND btrim(title) <> '');
    ALTER TABLE events ADD CONSTRAINT events_description_length
      CHECK (char_length(description) BETWEEN 10 AND 2000 AND btrim(description) <> '');
    ALTER TABLE events ADD CONSTRAINT events_location_length
      CHECK (location_text IS NULL OR char_length(location_text) BETWEEN 3 AND 200);

    -- §12: "Valid http or https URL", max 500. The application validates the
    -- URL properly; this refuses the shapes that could never be one, including
    -- the javascript: and data: schemes that would be an XSS vector if any
    -- surface ever rendered the link as markup (SEC-016).
    ALTER TABLE events ADD CONSTRAINT events_meeting_url_shape
      CHECK (
        meeting_url IS NULL
        OR (char_length(meeting_url) <= 500 AND meeting_url ~* '^https?://[^[:space:]]+$')
      );

    ALTER TABLE events ADD CONSTRAINT events_counts_non_negative
      CHECK (going_count >= 0 AND interested_count >= 0 AND distinct_report_count >= 0);

    -- A cancelled event, and only a cancelled event, carries the timestamp.
    ALTER TABLE events ADD CONSTRAINT events_cancelled_at_matches_status
      CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL));

    -- EVENT-FR-005: "events with a future start time, SOONEST first". Ascending,
    -- unlike every other list in this schema - a feed is read newest-first, but
    -- an events list is read by what is about to happen.
    --
    -- NOT partial on \`starts_at > now()\`: now() is not immutable, so it cannot
    -- appear in an index predicate. The state filter is what the partial index
    -- can do, and the time comparison happens in the query.
    CREATE INDEX events_upcoming
      ON events (starts_at ASC, id ASC)
      WHERE visibility_state = 'VISIBLE';

    -- An events list on the creator's own profile (EVENT-FR-001 step 8).
    -- Includes AUTO_HIDDEN, because an author sees their own hidden content
    -- marked under review (BR-032).
    CREATE INDEX events_by_creator
      ON events (creator_id, starts_at DESC)
      WHERE visibility_state IN ('VISIBLE', 'AUTO_HIDDEN');

    -- EVENT-FR-001 E4: "a maximum of 5 events per user per day". Counted from
    -- the table rather than from a counter, so the limit cannot drift from the
    -- thing it is limiting.
    CREATE INDEX events_by_creator_created
      ON events (creator_id, created_at DESC);

    COMMENT ON COLUMN events.status IS
      'EVENT-FR-007: a CANCELLED event stays VISIBLE, marked, until its original date passes - so attendees who never open the notification still learn of it.';
    COMMENT ON COLUMN events.distinct_report_count IS
      'BR-044: events auto-hide at TWO distinct reports, not the three that applies to other content, because a fake gathering wastes real travel and time.';
  `);

  // ----------------------------------------------------------- event_rsvps
  pgm.createTable('event_rsvps', {
    event_id: { type: 'uuid', notNull: true, references: 'events', onDelete: 'CASCADE' },
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    response: { type: 'rsvp_response', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('event_rsvps', 'event_rsvps_pkey', {
    primaryKey: ['event_id', 'user_id'],
  });

  pgm.sql(`
    -- EVENT-FR-008 addresses reminders to everyone who answered Going. That is
    -- the ONLY query that reads this table by event, and it is not a read path
    -- for users - see the file header on ARCH-CONFLICT-006.
    CREATE INDEX event_rsvps_going
      ON event_rsvps (event_id)
      WHERE response = 'GOING';

    -- "Events I am attending", for the viewer's own RSVP state.
    CREATE INDEX event_rsvps_by_user ON event_rsvps (user_id, event_id);

    COMMENT ON TABLE event_rsvps IS
      'ARCH-CONFLICT-006 / D-17: the COUNT is public, the LIST is not. There is no GET /events/{id}/attendees and no response body carries attendee identities. This table exists because RSVP is one-per-user and reminders must be addressed.';
  `);

  // ---------------------------------------------------- counts, by trigger
  //
  // The interesting case is UPDATE. EVENT-FR-004's criterion is that changing
  // from Interested to Going leaves the person counted ONCE, under Going - so
  // one column has to fall as the other rises, in the same statement. An
  // application that inserted-or-updated and then adjusted counts separately
  // would double-count under concurrency, and the person would appear twice at
  // exactly the moment turnout is being judged.
  pgm.sql(`
    CREATE OR REPLACE FUNCTION event_rsvps_maintain_counts()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $fn$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        UPDATE events
           SET going_count      = going_count      + (NEW.response = 'GOING')::int,
               interested_count = interested_count + (NEW.response = 'INTERESTED')::int
         WHERE id = NEW.event_id;

      ELSIF TG_OP = 'DELETE' THEN
        UPDATE events
           SET going_count      = GREATEST(going_count      - (OLD.response = 'GOING')::int, 0),
               interested_count = GREATEST(interested_count - (OLD.response = 'INTERESTED')::int, 0)
         WHERE id = OLD.event_id;

      ELSIF TG_OP = 'UPDATE' AND OLD.response IS DISTINCT FROM NEW.response THEN
        UPDATE events
           SET going_count = GREATEST(
                 going_count
                 - (OLD.response = 'GOING')::int
                 + (NEW.response = 'GOING')::int, 0),
               interested_count = GREATEST(
                 interested_count
                 - (OLD.response = 'INTERESTED')::int
                 + (NEW.response = 'INTERESTED')::int, 0)
         WHERE id = NEW.event_id;
      END IF;

      RETURN NULL;
    END
    $fn$;

    CREATE TRIGGER event_rsvps_counts
      AFTER INSERT OR UPDATE OR DELETE ON event_rsvps
      FOR EACH ROW
      EXECUTE FUNCTION event_rsvps_maintain_counts();
  `);

  // ---- EVENT-FR-002: the type is frozen once anyone has committed ---------
  //
  // "The type cannot be changed after RSVPs exist, because attendees committed
  // to a specific mode of attendance." Somebody who agreed to walk to a park
  // has not agreed to join a video call, and the other way round. Enforced here
  // as well as in the application, because it is a promise made to people who
  // are not the one making the edit.
  pgm.sql(`
    CREATE OR REPLACE FUNCTION events_type_frozen_after_rsvp()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $fn$
    BEGIN
      IF NEW.event_type IS DISTINCT FROM OLD.event_type
         AND EXISTS (SELECT 1 FROM event_rsvps WHERE event_id = OLD.id) THEN
        RAISE EXCEPTION 'the event type cannot change once people have responded (EVENT-FR-002)'
          USING ERRCODE = 'restrict_violation';
      END IF;
      RETURN NEW;
    END
    $fn$;

    CREATE TRIGGER events_type_frozen
      BEFORE UPDATE ON events
      FOR EACH ROW
      EXECUTE FUNCTION events_type_frozen_after_rsvp();
  `);

  // ------------------------------------------ SEARCH-FR-004: events search
  //
  // EPIC-08 built the cross-script key and deferred events to this epic,
  // because this epic owns the table. Title AND description, which is what the
  // requirement asks for: "user searches event titles and descriptions".
  pgm.sql(`
    ALTER TABLE events ADD COLUMN search_key text
      GENERATED ALWAYS AS (search_key(title || ' ' || description)) STORED;

    CREATE INDEX events_search_key_trgm
      ON events USING GIN (search_key gin_trgm_ops)
      WHERE visibility_state = 'VISIBLE';

    COMMENT ON COLUMN events.search_key IS
      'SEARCH-FR-004, using the EPIC-08 transliteration so an event announced in Urdu is found by a Roman Urdu query. Generated, so it can never disagree with the text it indexes.';
  `);
};

exports.down = async (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS events_type_frozen ON events;
    DROP TRIGGER IF EXISTS event_rsvps_counts ON event_rsvps;
    DROP FUNCTION IF EXISTS events_type_frozen_after_rsvp();
    DROP FUNCTION IF EXISTS event_rsvps_maintain_counts();
  `);
  pgm.dropTable('event_rsvps');
  pgm.dropTable('events');
  pgm.sql(`
    DROP TYPE IF EXISTS rsvp_response;
    DROP TYPE IF EXISTS event_visibility_state;
    DROP TYPE IF EXISTS event_status;
    DROP TYPE IF EXISTS event_type;
  `);
};
