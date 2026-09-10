import { describe, expect, it } from 'vitest';
import {
  functionSource,
  readCode,
  readFile,
  readProse,
} from '../../../lib/test-support/read-source';
import {
  announcementPublishedSchema,
  broadcastAllowanceSchema,
} from '../../../lib/admin-api/schemas';
import { FIELDS, LIMITS } from './announcement-state';

/**
 * UX-ADM-007 — announcements (ADMIN-FR-009, NOTIF-FR-005).
 *
 * Verified against the running API and database before these were written:
 *
 *   - a bilingual announcement published through the browser stored both
 *     versions intact, expired on the chosen day, wrote no outbox row and left
 *     the allowance at 0 of 2, with ADMIN_PUBLISHED_ANNOUNCEMENT in the audit
 *     log
 *   - two broadcasts took the allowance to 1 of 2 then 2 of 2, each writing an
 *     outbox row and ADMIN_BROADCAST_ANNOUNCEMENT
 *   - a third returned 429 RATE_LIMITED stating the limit
 *   - with the allowance spent, the form disables the checkbox and still
 *     offers to publish
 */

const PAGE = 'app/(portal)/announcements/page.tsx';
const FORM = 'app/(portal)/announcements/announcement-form.tsx';
const ACTIONS = 'app/(portal)/announcements/actions.ts';

describe('ADMIN-FR-009 — both languages, and neither is the secondary one', () => {
  it('requires all four content fields', () => {
    // "Both language versions are required, because a single-language
    // announcement fails half the audience." The API enforces it in the schema
    // shape; the portal checks per field so the reader is told WHICH version is
    // missing rather than handed one message about both.
    expect([...FIELDS]).toEqual(['titleEn', 'titleUr', 'bodyEn', 'bodyUr']);

    const publish = functionSource(ACTIONS, 'publishAnnouncement');
    expect(publish).toContain('for (const field of FIELDS)');

    // THE GUARD MUST BE UNCONDITIONAL ON LANGUAGE. Asserting that the loop
    // contains `values[field] === ''` was not enough: a mutation appended
    // `&& !field.endsWith('Ur')` to it, made Urdu optional, and the test still
    // passed. So the rule is now about what the guard must NOT consider.
    // THE COMPLETE GUARD LINE, closing brace included. The first version
    // asserted only `values[field] === ''`, and a mutation appended
    // `&& !field.endsWith('Ur')` to it — Urdu became optional and the test
    // still passed. A partial match on a condition is not a test of that
    // condition.
    expect(publish).toContain("if (values[field] === '') {");
    expect(publish).not.toContain('endsWith');
  });

  it('names the missing language in the message', () => {
    const missing = readCode(ACTIONS);
    expect(missing).toContain('The Urdu title is required');
    expect(missing).toContain('The English title is required');
    // And says why, because the rule is not arbitrary.
    expect(readProse(ACTIONS)).toContain('reaches half the audience');
  });

  it('gives the two languages the same field structure', () => {
    // A form with English full-width and Urdu tucked below as an afterthought
    // would teach the opposite of the rule it implements.
    const form = readFile(FORM);
    const pairs = form.match(/<div className="bilingual">/g) ?? [];
    expect(pairs).toHaveLength(2);

    // Every field carries a gloss, including the English ones. Measured at a
    // 1440px viewport: giving it only to the Urdu side pushed the Urdu input a
    // line lower than its pair, so the two boxes in a row did not share a
    // baseline.
    const glosses = form.match(/gloss="/g) ?? [];
    expect(glosses).toHaveLength(4);
  });

  it('keeps the bilingual pair the same size', () => {
    // Urdu Naskh takes 1.85 leading against Latin's 1.5, so two controls with
    // the same `rows` are not the same height. Both fixes are in the
    // stylesheet rather than hardcoded per field.
    const css = readCode('app/globals.css');
    expect(css).toContain('align-items: stretch');
    expect(css).toContain('.bilingual > .field textarea');
    expect(css).toContain(".bilingual > .field input[type='text']");
  });

  it('offers no way to publish one language alone', () => {
    const form = readCode(FORM);
    // No per-language submit, and no "skip translation" affordance.
    expect(form).not.toContain('English only');
    expect(form).not.toContain('skipUrdu');
    expect(readProse(FORM)).toContain('there is no way to publish only one');
  });
});

describe('the Urdu fields are actually Urdu', () => {
  it('sets dir and lang on the controls, not on a wrapper', () => {
    // Those attributes are what the browser's text engine and a screen reader
    // both read. A wrapper with the right direction and an input without it
    // gives an administrator a right-to-left label above a left-to-right box.
    // Verified in the browser: computed direction rtl, line-height 31.45px
    // against Latin's 24px.
    const form = readCode(FORM);
    expect(form).toContain("dir: 'rtl' as const, lang: 'ur'");
    expect(form).toContain('urdu ? ');
  });

  it('labels the Urdu fields in Urdu', () => {
    // The person filling this in is writing Urdu. The English gloss beneath is
    // for an administrator who does not read it.
    const form = readFile(FORM);
    expect(form).toContain('عنوان (اردو)');
    expect(form).toContain('اعلان (اردو)');
  });

  it('gives the Urdu controls Urdu leading', () => {
    const css = readCode('app/globals.css');
    expect(css).toContain('.field-urdu');
    expect(css).toContain('var(--line-height-urdu)');
  });
});

describe('NOTIF-FR-005 — the broadcast cap is stated before the writing starts', () => {
  it('fetches the allowance while rendering the page', () => {
    // The API's own reason for having this route: "so the portal can say so
    // before an administrator writes one, rather than refusing after they
    // have." Somebody who has written a bilingual announcement and ticked the
    // push box should not learn about the cap when they press publish.
    const page = readCode(PAGE);
    expect(page).toContain('/admin/announcements/allowance');
    expect(page).toContain('broadcastAllowanceSchema');
  });

  it('floors the remaining count rather than trusting subtraction', () => {
    // `used` could exceed `limit` if the limit were ever lowered, and
    // "-1 broadcasts remain" is not a sentence.
    expect(readCode(PAGE)).toContain('Math.max(allowance.limit - allowance.used, 0)');
    expect(Object.keys(broadcastAllowanceSchema.shape).sort()).toEqual(['limit', 'used']);
  });

  it('leaves the checkbox unticked and never checks it by default', () => {
    // A push goes to every user. A box that arrived already ticked would make
    // the expensive choice the default one. Verified in the served HTML: no
    // `checked` attribute is present.
    // NAMED, not just `useState(false)`. The first version of this assertion
    // matched `confirming`'s initial state as well, so setting `broadcast` to
    // true by default left it passing — a mutation proved it.
    const form = readCode(FORM);
    expect(form).toContain('const [broadcast, setBroadcast] = useState(false)');
    expect(form).not.toContain('const [broadcast, setBroadcast] = useState(true)');
    expect(form).not.toContain('defaultChecked');
  });

  it('still offers to publish when no broadcasts remain', () => {
    // The cap is on the notification, not on the announcement. A screen that
    // blocked publishing would be enforcing a limit that does not exist.
    const copy = readProse(FORM);
    expect(copy).toContain('No broadcasts remain');
    expect(copy).toContain('You can still publish the announcement');

    const form = readCode(FORM);

    // ONLY THE CHECKBOX MAY BE DISABLED BY THE ALLOWANCE. The first version
    // asserted the CHECKBOX's own disabled expression, which a mutation adding
    // `|| !canBroadcast` to the publish button left untouched — so a spent
    // allowance blocked publishing entirely and the test passed. The rule is
    // about the button, so the assertion has to be.
    expect(form).toContain('disabled={!canBroadcast || confirming}');
    expect(form).toContain('onClick={() => setConfirming(true)} disabled={pending}>');
    expect(form).not.toContain('setConfirming(true)} disabled={pending || !canBroadcast}');
  });

  it('reads a 429 as a limit rather than a fault', () => {
    const failure = functionSource(ACTIONS, 'publishFailure');
    expect(failure).toContain('error.status === 429');
    expect(failure).toContain("status: 'BROADCAST_LIMIT'");

    // And tells the reader what to do about it, since the announcement itself
    // is still publishable.
    const copy = readProse(FORM);
    expect(copy).toContain('Untick the push notification and publish again');
  });
});

describe('the response is the server’s answer, not the form’s intention', () => {
  it('reports what the API says it did about the broadcast', () => {
    // A publication can succeed while its broadcast is refused. Telling an
    // administrator a push went out when it did not is how the same
    // announcement gets published twice.
    expect(Object.keys(announcementPublishedSchema.shape).sort()).toEqual(['broadcast', 'id']);

    // THE ORDER IS THE RULE. Asserting that both names appear passed even when
    // the branches were swapped so the FORM's intention decided the message —
    // a mutation proved it. What must be true is that the server's answer is
    // tested first.
    // THE ORDER IS THE RULE. Asserting that both names appear passed even when
    // the branches were swapped so the FORM's intention decided the message —
    // a mutation proved it. What must be true is that the branch tested first
    // is the server's answer, so the character after it must not begin
    // "Requested".
    const form = readCode(FORM);
    const marker = '{state.broadcast';
    const at = form.indexOf(marker);

    expect(at).toBeGreaterThan(-1);
    expect(form.slice(at + marker.length, at + marker.length + 9)).not.toBe('Requested');
    expect(form).toContain('state.broadcastRequested');
    expect(readProse(FORM)).toContain('the announcement was published without it');
  });

  it('does not invite a second attempt when the outcome is unknown', () => {
    // There is no route to withdraw an announcement, so a duplicate cannot be
    // undone. A shape error may follow a request that succeeded.
    const failure = functionSource(ACTIONS, 'publishFailure');
    const shape = failure.slice(failure.indexOf('AdminApiShapeError'));

    expect(shape).toContain('not certain whether the announcement was published');
    expect(shape).toContain('no way to withdraw a duplicate');
  });
});

describe('§9 — this is not a content management system', () => {
  it('has no edit, no withdraw and no delete', () => {
    // "DO NOT CREATE A GENERIC CMS." Satisfied by there being nothing to edit
    // with rather than by a missing button: the API has one publish route and
    // no others.
    const page = readCode(PAGE);
    const form = readCode(FORM);

    for (const forbidden of ["method: 'PUT'", "method: 'DELETE'", "method: 'PATCH'"]) {
      expect(readCode(ACTIONS), forbidden).not.toContain(forbidden);
    }
    for (const forbidden of ['Withdraw', 'Unpublish', 'Edit announcement', 'Delete announcement']) {
      expect(page + form, forbidden).not.toContain(forbidden);
    }
  });

  it('says the portal cannot list what has been published', () => {
    // There is no route that returns announcements, so an administrator cannot
    // check whether something similar has already gone out, and cannot confirm
    // after a failure whether it published. ADMIN-API-GAP-009 — stated, because
    // the absence of a list changes how carefully the form has to be used.
    const copy = readProse(PAGE);
    expect(copy).toContain('ADMIN-API-GAP-009');
    expect(copy).toContain('no route that lists announcements');
    expect(copy).toContain('no route to edit or withdraw one');
  });

  it('warns before publishing that a mistake cannot be taken back', () => {
    const copy = readProse(FORM);
    expect(copy).toContain('CANNOT EDIT OR WITHDRAW IT');
    expect(copy).toContain('stays visible until it expires');
  });
});

describe('the expiry', () => {
  it('reads a chosen day as the END of that day', () => {
    // A `date` input gives YYYY-MM-DD. Somebody picking today means "until
    // today is over", not "until midnight this morning" — which would already
    // be in the past and refused by the API.
    const endOfDay = functionSource(ACTIONS, 'endOfDay');
    expect(endOfDay).toContain('23, 59, 59, 999');
    // Parsed by parts: `new Date('2026-09-09')` is midnight UTC while
    // `new Date('2026/09/09')` is midnight local, and a one-day announcement
    // is exactly where that difference shows up as an expiry in the past.
    expect(endOfDay).toContain('/^(\\d{4})-(\\d{2})-(\\d{2})$/');
    expect(endOfDay).not.toContain('new Date(raw)');
  });

  it('refuses a past expiry with a message that says what to do', () => {
    const publish = functionSource(ACTIONS, 'publishAnnouncement');
    expect(publish).toContain('expiry.getTime() <= Date.now()');
    expect(publish).toContain('Choose today or a later date');
  });
});

describe('the field bounds match the API', () => {
  it('uses the API’s own maximums', () => {
    expect(LIMITS.title).toBe(200);
    expect(LIMITS.body).toBe(2000);

    const publish = functionSource(ACTIONS, 'publishAnnouncement');
    expect(publish).toContain("field.startsWith('title') ? LIMITS.title : LIMITS.body");
  });
});

describe('§34 — announcement text is never markup', () => {
  it('renders nothing through dangerouslySetInnerHTML', () => {
    for (const file of [PAGE, FORM, ACTIONS]) {
      expect(readCode(file), file).not.toContain('dangerouslySetInnerHTML');
    }
  });
});

describe('no form is drawn when the allowance cannot be read', () => {
  it('refuses to render a broadcast box whose cost is unknown', () => {
    // A broadcast is the one action on this screen that cannot be recalled.
    const failure = functionSource(PAGE, 'AllowanceUnavailable');

    expect(failure).toContain('role="alert"');
    expect(failure).toContain('the form is not shown');
    expect(failure).toContain('no notification has been sent');
    expect(failure).not.toContain('<AnnouncementForm');
  });
});
