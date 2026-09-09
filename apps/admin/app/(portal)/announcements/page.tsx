import { guardedRequest } from '../../../lib/admin-api/guarded';
import { AdminApiError, AdminApiShapeError } from '../../../lib/admin-api/client';
import { broadcastAllowanceSchema } from '../../../lib/admin-api/schemas';
import { messageForCode } from '../../../lib/admin-api/messages';
import { AnnouncementForm } from './announcement-form';

export const metadata = {
  title: 'Announcements · Mohalla Admin',
};

/**
 * UX-ADM-007 — announcements (ADMIN-FR-009).
 *
 * THE ALLOWANCE IS FETCHED BEFORE THE FORM IS DRAWN, which is the reason the
 * API has an allowance route at all — its own description says so: "so the
 * portal can say so before an administrator writes one, rather than refusing
 * after they have." Somebody who has written a bilingual announcement and
 * ticked the push box should not learn about the weekly cap at the moment they
 * press publish.
 *
 * THIS SCREEN CANNOT LIST WHAT HAS BEEN PUBLISHED. There is no route that
 * returns announcements — only the allowance and the publish endpoint. So an
 * administrator cannot see the fifty announcements already in the database,
 * cannot check whether the thing they are about to write has already gone out,
 * and cannot confirm after a failure whether it published. Recorded as
 * ADMIN-API-GAP-009, and stated on the screen, because the absence of a list
 * changes how carefully the form has to be used.
 *
 * AND THERE IS NO EDIT AND NO WITHDRAW. That is not an omission to be fixed
 * here: §9 says "DO NOT CREATE A GENERIC CMS", and an announcement editor with
 * a delete button is exactly the thing it names. The consequence — that a
 * published mistake stays visible until it expires — is said before the publish
 * button rather than discovered after it.
 */
export default async function AnnouncementsPage() {
  let allowance;
  try {
    allowance = await guardedRequest({
      path: '/admin/announcements/allowance',
      schema: broadcastAllowanceSchema,
    });
  } catch (error) {
    return <AllowanceUnavailable error={error} />;
  }

  // Floored rather than trusted: `used` could exceed `limit` if the limit were
  // ever lowered, and "−1 broadcasts remain" is not a sentence.
  const remaining = Math.max(allowance.limit - allowance.used, 0);

  return (
    <>
      <h1>Announcements</h1>
      <p className="page-lead">
        A platform-wide announcement, in English and Urdu. It appears in the app until the date you
        set and can optionally be sent as a push notification.
      </p>

      {/* ADMIN-API-GAP-009 — see the note at the top of this file. */}
      <p className="not-built">
        The admin API has no route that lists announcements, so this screen cannot show what has
        already been published or check whether something similar has recently gone out
        (ADMIN-API-GAP-009). There is also no route to edit or withdraw one — a published
        announcement stops showing when it expires and not before.
      </p>

      <AnnouncementForm remaining={remaining} limit={allowance.limit} />
    </>
  );
}

/**
 * The allowance, when it could not be read.
 *
 * NO FORM IS DRAWN. The alternative would be to render the form with the
 * broadcast box available and the allowance unknown, which invites somebody to
 * write an announcement and tick a box whose cost cannot be checked — and a
 * broadcast is the one action on this screen that cannot be recalled.
 * Publishing without the push would be safe, but a form that quietly dropped
 * the option would be a different screen from the one this is meant to be.
 */
function AllowanceUnavailable({ error }: { error: unknown }) {
  const isShape = error instanceof AdminApiShapeError;
  const apiError = error instanceof AdminApiError ? error : null;
  const reference = apiError?.correlationId ?? (isShape ? error.correlationId : undefined);

  return (
    <>
      <h1>Announcements</h1>

      <div role="alert" className="notice notice-error">
        <p>
          {isShape
            ? 'The API answered, but not in a shape this portal understands.'
            : messageForCode(apiError?.code ?? 'UNKNOWN')}
        </p>
        <p className="muted small">
          The weekly broadcast allowance could not be read, so the form is not shown. Nothing has
          been published, and no notification has been sent.
        </p>
        {reference !== undefined && <p className="mono muted small">Reference: {reference}</p>}
      </div>
    </>
  );
}
