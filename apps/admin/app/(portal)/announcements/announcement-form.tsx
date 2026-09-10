'use client';

import { useActionState, useState } from 'react';
import { publishAnnouncement } from './actions';
import { IDLE_ANNOUNCEMENT, LIMITS, type Field } from './announcement-state';

/**
 * UX-ADM-007 — write an announcement (ADMIN-FR-009).
 *
 * BOTH LANGUAGES, GIVEN EQUAL WEIGHT ON THE SCREEN. ADMIN-FR-009 requires both
 * versions "because a single-language announcement fails half the audience",
 * and a form that put English first and full-width with Urdu tucked below as an
 * afterthought would teach the opposite. So the two sit side by side, in
 * identical fields, and the Urdu one is not labelled as the optional or the
 * secondary one — because it is neither.
 *
 * THE URDU FIELDS ARE PROPERLY URDU. `dir="rtl"` and `lang="ur"` on the inputs
 * themselves, with the Urdu line height, so the text renders and edits the way
 * it will be read. This is the one place in an English-only portal (ADR-002,
 * §7) where Urdu is typed, and getting it wrong here would mean an
 * administrator composing Urdu in a left-to-right box and being unable to tell
 * whether the result is right.
 *
 * THE BROADCAST IS OPT-IN AND UNCHECKED. It sends a push notification to every
 * user, and NOTIF-FR-005 caps it at two per rolling week "because over-use is a
 * direct cause of uninstalls". A checkbox that arrived already ticked would
 * make the expensive choice the default one. The remaining allowance is shown
 * BEFORE the writing starts, which is the API's own stated reason for having an
 * allowance route at all.
 *
 * PUBLISHING CANNOT BE UNDONE FROM HERE, and the form says so before the
 * button. There is no route to edit or withdraw an announcement
 * (ADMIN-API-GAP-009), which also means the portal is not a content editor —
 * §9's "DO NOT CREATE A GENERIC CMS" is satisfied by there being nothing to
 * edit with rather than by a missing button.
 */
export function AnnouncementForm({ remaining, limit }: { remaining: number; limit: number }) {
  const [state, submit, pending] = useActionState(publishAnnouncement, IDLE_ANNOUNCEMENT);
  const [broadcast, setBroadcast] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [values, setValues] = useState({ titleEn: '', titleUr: '', bodyEn: '', bodyUr: '' });

  const errorFor = (field: Field | 'expiresAt') =>
    state.status === 'INVALID' && state.field === field ? state.message : null;

  const canBroadcast = remaining > 0;

  if (state.status === 'PUBLISHED') {
    return (
      <div className="notice notice-success" role="status">
        <h2>Published</h2>
        <p>
          The announcement is live in both languages and will show until the expiry date you set.
        </p>
        {/*
          The SERVER's answer, not the checkbox's. A publication can succeed
          while its broadcast is refused, and telling an administrator a push
          went out when it did not is how the same announcement gets published
          twice.
        */}
        <p>
          {state.broadcast
            ? 'A push notification was sent to every user.'
            : state.broadcastRequested
              ? 'No push notification was sent — the announcement was published without it.'
              : 'No push notification was sent, as you chose.'}
        </p>
        <p className="muted small">
          This publication is recorded in the audit log with your name. It cannot be edited or
          withdrawn from the portal — it stops showing when it expires.
        </p>
        <p className="mono muted small">Announcement {state.id}</p>
      </div>
    );
  }

  return (
    <form action={submit} className="announcement-form">
      <div className="bilingual">
        <TextField
          id="titleEn"
          label="Title (English)"
          gloss="Shown to readers using the app in English"
          value={values.titleEn}
          max={LIMITS.title}
          error={errorFor('titleEn')}
          readOnly={confirming}
          onChange={(v) => setValues((s) => ({ ...s, titleEn: v }))}
        />
        <TextField
          id="titleUr"
          label="عنوان (اردو)"
          gloss="The title, in Urdu"
          urdu
          value={values.titleUr}
          max={LIMITS.title}
          error={errorFor('titleUr')}
          readOnly={confirming}
          onChange={(v) => setValues((s) => ({ ...s, titleUr: v }))}
        />
      </div>

      <div className="bilingual">
        <TextField
          id="bodyEn"
          label="Announcement (English)"
          gloss="Shown to readers using the app in English"
          multiline
          value={values.bodyEn}
          max={LIMITS.body}
          error={errorFor('bodyEn')}
          readOnly={confirming}
          onChange={(v) => setValues((s) => ({ ...s, bodyEn: v }))}
        />
        <TextField
          id="bodyUr"
          label="اعلان (اردو)"
          gloss="The announcement text, in Urdu"
          urdu
          multiline
          value={values.bodyUr}
          max={LIMITS.body}
          error={errorFor('bodyUr')}
          readOnly={confirming}
          onChange={(v) => setValues((s) => ({ ...s, bodyUr: v }))}
        />
      </div>

      <p className="field-note">
        Both versions are required. An announcement in one language reaches about half the people it
        is meant for, so there is no way to publish only one.
      </p>

      <div className="field">
        <label htmlFor="expiresAt">Show until</label>
        <p className="field-note" id="expiry-note">
          The last day the announcement appears. It stops showing on its own after that — nothing
          has to be done to take it down, and nothing can take it down sooner.
        </p>
        <input
          id="expiresAt"
          name="expiresAt"
          type="date"
          required
          readOnly={confirming}
          aria-describedby={errorFor('expiresAt') === null ? 'expiry-note' : 'expiry-error'}
          aria-invalid={errorFor('expiresAt') === null ? undefined : true}
        />
        {errorFor('expiresAt') !== null && (
          <p className="field-error" id="expiry-error" role="alert">
            {errorFor('expiresAt')}
          </p>
        )}
      </div>

      <fieldset className="broadcast-set">
        <legend>Push notification</legend>
        <label className="checkbox-row">
          <input
            type="checkbox"
            name="broadcast"
            checked={broadcast}
            disabled={!canBroadcast || confirming}
            onChange={(event) => setBroadcast(event.target.checked)}
          />
          <span>Also send this as a push notification to every user</span>
        </label>
        {canBroadcast ? (
          <p className="field-note">
            {remaining} of {limit} broadcasts remain in the current seven days. The limit exists
            because over-use of notifications is a direct cause of people uninstalling the app.
            Leaving this unticked still publishes the announcement in the app.
          </p>
        ) : (
          <p className="notice notice-warn">
            No broadcasts remain in the current seven days ({limit} of {limit} used). You can still
            publish the announcement — it will appear in the app without a push notification.
          </p>
        )}
      </fieldset>

      {confirming ? (
        <div className="confirm-delete" role="group" aria-labelledby="confirm-publish">
          <h3 id="confirm-publish" tabIndex={-1}>
            Publish this announcement?
          </h3>
          <p>
            It goes live in both languages immediately and shows until the date you chose. THE
            PORTAL CANNOT EDIT OR WITHDRAW IT — there is no route to do either, so a mistake stays
            visible until it expires.
          </p>
          {broadcast && (
            <p>
              A push notification will also be sent to every user. That cannot be recalled, and it
              uses one of your {limit} broadcasts for the week.
            </p>
          )}
          <p className="muted small">
            Your name is recorded in the audit log with this publication.
          </p>
          <div className="decision-row">
            <button type="submit" disabled={pending}>
              {pending ? 'Publishing…' : broadcast ? 'Publish and send' : 'Publish'}
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={pending}>
              Keep editing
            </button>
          </div>
        </div>
      ) : (
        <div className="decision-row">
          <button type="button" onClick={() => setConfirming(true)} disabled={pending}>
            Review and publish
          </button>
        </div>
      )}

      {state.status === 'BROADCAST_LIMIT' && (
        <div className="notice notice-warn" role="alert">
          <p>{state.message}</p>
          <p className="muted small">
            Nothing was published. Untick the push notification and publish again — the announcement
            itself is not limited.
          </p>
        </div>
      )}

      {state.status === 'FAILED' && (
        <div className="notice notice-error" role="alert">
          <p>{state.message}</p>
          {state.reference !== undefined && (
            <p className="mono muted small">Reference: {state.reference}</p>
          )}
        </div>
      )}
    </form>
  );
}

/**
 * One field, in one language.
 *
 * `urdu` sets `dir` and `lang` on the CONTROL rather than on a wrapper, because
 * those attributes are what the browser's text engine and a screen reader both
 * read — a wrapper with the right direction and an input without it gives an
 * administrator a right-to-left label above a left-to-right box.
 *
 * THE URDU LABEL IS IN URDU. The person filling this in is writing Urdu; the
 * English gloss beneath is there for an administrator who does not read it.
 *
 * EVERY FIELD CARRIES A GLOSS, INCLUDING THE ENGLISH ONES, and that is a layout
 * decision as much as a copy one. The first version gave the gloss only to the
 * Urdu fields, so the Urdu input sat one line lower than its English pair and
 * the two boxes in a row did not share a baseline — measured at a 1440px
 * viewport, where they are side by side. Identical structure in both columns is
 * what keeps them aligned, and it costs a line of useful copy rather than a
 * subgrid.
 */
function TextField({
  id,
  label,
  gloss,
  value,
  max,
  error,
  readOnly,
  onChange,
  urdu = false,
  multiline = false,
}: {
  id: string;
  label: string;
  gloss: string;
  value: string;
  max: number;
  error: string | null;
  readOnly: boolean;
  onChange: (value: string) => void;
  urdu?: boolean;
  multiline?: boolean;
}) {
  // Only the error is a description: the gloss lives inside the label, so it
  // is already announced with it rather than repeated after it.
  const describedBy = error === null ? '' : `${id}-error`;

  const shared = {
    id,
    name: id,
    value,
    maxLength: max,
    readOnly,
    required: true,
    onChange: (event: { target: { value: string } }) => onChange(event.target.value),
    ...(urdu ? { dir: 'rtl' as const, lang: 'ur' } : {}),
    ...(describedBy === '' ? {} : { 'aria-describedby': describedBy }),
    ...(error === null ? {} : { 'aria-invalid': true as const }),
  };

  return (
    <div className={urdu ? 'field field-urdu' : 'field'}>
      <label htmlFor={id}>
        <span className="label-main" {...(urdu ? { dir: 'rtl', lang: 'ur' } : {})}>
          {label}
        </span>
        <span className="label-gloss">{gloss}</span>
      </label>
      {multiline ? <textarea rows={5} {...shared} /> : <input type="text" {...shared} />}
      <p className="muted small">
        {value.length} of {max}
      </p>
      {error !== null && (
        <p className="field-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
