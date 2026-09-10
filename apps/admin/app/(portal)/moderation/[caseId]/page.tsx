import Link from 'next/link';
import { guardedRequest } from '../../../../lib/admin-api/guarded';
import { apiFailure } from '../../../../lib/admin-api/failure';
import { AdminApiError, AdminApiShapeError } from '../../../../lib/admin-api/client';
import { caseDetailSchema, type ModerationCaseDetail } from '../../../../lib/admin-api/schemas';
import { messageForCode } from '../../../../lib/admin-api/messages';
import { SeverityIndicator, VisibilityFlag } from '../../../../components/severity-indicator';
import { exactInstant, formatAge, formatExpiry } from '../../../../lib/format-age';
import {
  enforcementKindLabel,
  moderationStateLabel,
  targetTypeLabel,
} from '../../../../lib/wire-labels';
import { ConversationPanel } from './conversation-panel';
import { DecisionPanel } from './decision-panel';

export const metadata = {
  title: 'Queue item · Mohalla Admin',
};

/**
 * UX-ADM-004 — the queue item detail (ADMIN-FR-002).
 *
 * "The decision workspace." Everything an administrator needs to judge one
 * case, and the three peer outcomes.
 *
 * WHAT THIS SCREEN CANNOT SHOW, AND WHY IT SAYS SO. §7 describes UX-ADM-004 as
 * "full content, every report, author history". The API provides the third and
 * neither of the first two:
 *
 *   - THE REPORTED CONTENT ITSELF. `GET /admin/moderation/cases/:id` returns
 *     `targetType` and `targetId` and no body, and there is no admin route that
 *     fetches a post, comment or event as an administrator. Recorded as
 *     ADMIN-API-GAP-004.
 *   - THE INDIVIDUAL REPORTS. The case carries `distinctReportCount` and
 *     `maxSeverity`, which are aggregates. No route enumerates who reported it,
 *     under which category, or with what note. Recorded as ADMIN-API-GAP-005.
 *
 * Neither is invented here. Adding an endpoint would be a backend change that
 * materially alters approved behaviour, and reading the content out of the
 * public API as an administrator would bypass the audit trail that makes
 * administrator access reviewable. So the screen states the absence in the
 * place the content would have been. A blank panel would read as "there are no
 * reports", which is a different and false statement — the same class of lie as
 * ADMIN-RUNTIME-003 on the queue.
 *
 * THE CONVERSATION IS THE ONE EXCEPTION, and it is fetched only on an explicit
 * press, because fetching it writes an audit entry. See `ConversationPanel`.
 */
export default async function QueueItemPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;

  let detail: ModerationCaseDetail;
  try {
    detail = await guardedRequest({
      path: `/admin/moderation/cases/${encodeURIComponent(caseId)}`,
      schema: caseDetailSchema,
    });
  } catch (error) {
    return <CaseUnavailable caseId={caseId} error={apiFailure(error)} />;
  }

  const isOpen = detail.state === 'OPEN';
  const authorKnown = detail.targetOwnerId !== null;

  return (
    <>
      <p className="crumb">
        <Link href="/moderation">← Moderation queue</Link>
      </p>

      {/*
        "Reported post", not "POST case". The first browser render of this
        screen put the API's enum straight into the heading, which told the
        reader they were looking at a database table rather than at a decision
        about somebody's content.
      */}
      <h1>
        Reported {targetTypeLabel(detail.targetType)}{' '}
        <SeverityIndicator severity={detail.maxSeverity} />
      </h1>

      <dl className="fact-list fact-grid">
        <div>
          <dt>Reported by</dt>
          <dd className="numeric">
            {detail.distinctReportCount.toLocaleString('en')} distinct{' '}
            {detail.distinctReportCount === 1 ? 'reporter' : 'reporters'}
          </dd>
        </div>
        <div>
          <dt>Opened</dt>
          <dd title={exactInstant(detail.createdAt)}>{formatAge(detail.createdAt)} ago</dd>
        </div>
        <div>
          <dt>Currently</dt>
          <dd>
            <VisibilityFlag autoHidden={detail.autoHidden} />
          </dd>
        </div>
        <div>
          <dt>Case state</dt>
          <dd>{moderationStateLabel(detail.state)}</dd>
        </div>
        <div>
          <dt>Target</dt>
          <dd className="mono">{detail.targetId}</dd>
        </div>
        <div>
          <dt>Author</dt>
          <dd className="mono">
            {detail.targetOwnerId ?? (
              <span className="muted">Not recorded — a conversation has no single author.</span>
            )}
          </dd>
        </div>
      </dl>

      {detail.autoHidden && (
        <p className="notice notice-info">
          This content is already hidden from readers. It was hidden automatically when reports
          crossed a threshold, before any administrator looked at it — so a deletion here changes
          nothing a reader can see, and a restoration is what puts it back.
        </p>
      )}

      {/* ADMIN-API-GAP-004 and -005, in the place the content would have been. */}
      <section className="panel" aria-labelledby="content-heading">
        <h2 id="content-heading">The reported content</h2>
        <p className="not-built">
          The admin API does not return the content of a reported post, comment or event — only its
          type and id (ADMIN-API-GAP-004). Nothing is shown here rather than something fetched by a
          route that would not be audited as administrator access.
        </p>
        <p className="not-built">
          The individual reports are not available either: the case carries the number of distinct
          reporters and the highest severity, and no route lists who reported it, under which
          category, or with what note (ADMIN-API-GAP-005). The counts above are aggregates, not a
          summary of an empty list.
        </p>
      </section>

      {detail.targetType === 'CONVERSATION' && <ConversationPanel caseId={detail.id} />}

      {/*
        THE AUTHOR'S HISTORY, and the API's own reason for putting it on this
        screen: "so proportionality can be judged without navigating away. An
        administrator deciding whether a first offence warrants 30 days should
        not have to open another screen to find out it is the fourth."
      */}
      <section className="panel" aria-labelledby="history-heading">
        <h2 id="history-heading">The author&apos;s enforcement history</h2>

        {detail.repeatOffenderFlag && (
          <p className="notice notice-warn">
            This account is flagged: three or more of its items have been deleted by an
            administrator in the last 30 days. This is a fact to weigh, not a recommendation — no
            account is ever suspended automatically.
          </p>
        )}

        {!authorKnown ? (
          <p className="muted">
            {/*
              THE EMPTY LIST MEANS TWO DIFFERENT THINGS, and only one of them is
              "this author has a clean record". The API skips both the history
              and the repeat-offender lookup when `targetOwnerId` is null, which
              is the conversation case — so an empty list there is an absence of
              information, not a finding. Saying "no prior actions" here would
              invite a leniency nothing supports.
            */}
            Not available for this case. A conversation has no single author, so the API does not
            look up a history — this is missing information, not a clean record.
          </p>
        ) : detail.enforcementHistory.length === 0 ? (
          <p className="muted">
            No prior enforcement action against this account. The history was looked up and came
            back empty.
          </p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <caption className="table-caption">
                Every prior enforcement action against this account, oldest first.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Action</th>
                  <th scope="col">When</th>
                  <th scope="col">Expired or expires</th>
                  <th scope="col">Reason given</th>
                </tr>
              </thead>
              <tbody>
                {detail.enforcementHistory.map((entry) => (
                  <tr key={entry.id}>
                    <td>{enforcementKindLabel(entry.kind)}</td>
                    <td title={exactInstant(entry.createdAt)}>{formatAge(entry.createdAt)} ago</td>
                    <td>
                      {entry.expiresAt === null ? (
                        <span className="muted">Does not expire</span>
                      ) : (
                        <span title={exactInstant(entry.expiresAt)}>
                          {formatExpiry(entry.expiresAt)}
                        </span>
                      )}
                    </td>
                    {/*
                      Another administrator's free text, rendered as text. §34
                      names report notes and reasons as things never to pass
                      through `dangerouslySetInnerHTML`.
                    */}
                    <td>{entry.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {isOpen ? (
        <DecisionPanel caseId={detail.id} version={detail.version} />
      ) : (
        <Resolution detail={detail} />
      )}
    </>
  );
}

/**
 * A case that has already been decided.
 *
 * NO DECISION CONTROLS AT ALL, because the outcome is recorded and a second
 * decision is not a thing the API will accept — it would come back a 409. But
 * hiding the controls is not the security boundary (§28): the server refuses a
 * decision on a resolved case whether or not this page draws a button.
 */
function Resolution({ detail }: { detail: ModerationCaseDetail }) {
  return (
    <section className="panel" aria-labelledby="resolution-heading">
      <h2 id="resolution-heading">This case is resolved</h2>

      <dl className="fact-list">
        <div>
          <dt>Outcome</dt>
          <dd>{moderationStateLabel(detail.state)}</dd>
        </div>
        <div>
          <dt>Resolved</dt>
          <dd>
            {detail.resolvedAt === null ? (
              <span className="muted">Not recorded</span>
            ) : (
              <span title={exactInstant(detail.resolvedAt)}>
                {formatAge(detail.resolvedAt)} ago
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>Resolved by</dt>
          <dd className="mono">
            {detail.resolvedByAdminId ?? <span className="muted">Not recorded</span>}
          </dd>
        </div>
        <div>
          <dt>Reason given</dt>
          {/* Free text from another administrator. Text, never markup (§34). */}
          <dd>{detail.resolutionReason ?? <span className="muted">Not recorded</span>}</dd>
        </div>
      </dl>

      <p className="muted small">
        The audit log holds the permanent record of this decision. It cannot be edited or removed
        here or anywhere else in the portal.
      </p>
    </section>
  );
}

/**
 * The case, when it could not be read.
 *
 * A MISSING CASE IS NOT AN ERROR TO APOLOGISE FOR. `RESOURCE_UNAVAILABLE` is
 * what the API returns for a case that never existed AND for one whose target
 * has since gone — so the copy covers both without guessing which, and offers
 * the queue, which is where the reader was going anyway.
 */
function CaseUnavailable({ caseId, error }: { caseId: string; error: unknown }) {
  const apiError = error instanceof AdminApiError ? error : null;
  const isShape = error instanceof AdminApiShapeError;
  const missing = apiError?.status === 404;
  const reference = apiError?.correlationId ?? (isShape ? error.correlationId : undefined);

  return (
    <>
      <p className="crumb">
        <Link href="/moderation">← Moderation queue</Link>
      </p>
      <h1>Queue item</h1>

      <div role="alert" className="notice notice-error">
        <p>
          {missing
            ? 'This case is not available. It may never have existed, or its target may have been removed since the report.'
            : isShape
              ? 'The API answered, but not in a shape this portal understands. The case is not shown rather than shown wrongly.'
              : messageForCode(apiError?.code ?? 'UNKNOWN')}
        </p>
        <p className="muted small">
          No decision can be made from this page, and nothing has been changed.
        </p>
        <p className="mono muted small">Case {caseId}</p>
        {reference !== undefined && <p className="mono muted small">Reference: {reference}</p>}
      </div>
    </>
  );
}
