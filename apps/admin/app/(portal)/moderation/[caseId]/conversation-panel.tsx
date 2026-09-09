'use client';

import { useActionState } from 'react';
import { readReportedConversation } from './actions';
import { UNREAD_CONVERSATION } from './decision-state';
import { exactInstant, formatAge } from '../../../../lib/format-age';

/**
 * The reported conversation — MSG-FR-007, PRIV-009, §21.
 *
 * NOTHING IS FETCHED UNTIL SOMEBODY PRESSES THE BUTTON, and that is the whole
 * design of this component.
 *
 * §21 is the rule it serves: "Administrators must NOT have general access to
 * private conversations", with exactly one exception — a participant reported
 * the conversation. PRIV-009 adds the condition that makes the rule checkable:
 * the access is AUDIT-LOGGED. The API implements that by writing
 * `ADMIN_READ_REPORTED_CONVERSATION` — naming this administrator and this
 * conversation — BEFORE it reads a single message, in the same transaction, so
 * that a read which happened cannot fail to have a record.
 *
 * WHICH MEANS FETCHING IS NOT FREE. If this panel loaded the excerpt while the
 * page rendered, every visit to a conversation case — including opening one to
 * check its severity, or a mistaken click, or a bookmark, or a page refresh —
 * would write an audit entry saying an administrator read somebody's private
 * messages. The log would fill with accesses nobody made, and the entries that
 * mattered would be indistinguishable from the noise. §24 says it directly for
 * sensitive fields: "do not prefetch". The same reasoning applies here with
 * more force, because this is private correspondence rather than a phone
 * number.
 *
 * So the resting state is a closed panel that says plainly what pressing the
 * button will record. An administrator with a reason to look is not slowed down
 * by one press; an administrator without one never generates the entry.
 *
 * IT IS ALSO THE ONLY WAY IN. There is no conversation search in this portal,
 * no inbox view, no message browser, and no route that takes a conversation id.
 * This panel exists on a CASE, which means a report exists, which is the single
 * condition under which the API will answer at all.
 */
export function ConversationPanel({ caseId }: { caseId: string }) {
  const [state, submit, pending] = useActionState(readReportedConversation, UNREAD_CONVERSATION);

  return (
    <section className="panel" aria-labelledby="conversation-heading">
      <h2 id="conversation-heading">Reported conversation</h2>

      {state.status === 'NOT_REQUESTED' && (
        <form action={submit}>
          <input type="hidden" name="caseId" value={caseId} />
          <p>
            This case is a private conversation. It has not been loaded, and it will not be until
            you ask for it.
          </p>
          <p className="muted">
            Opening it records an entry in the audit log naming you, this conversation and the time.
            That record is permanent and cannot be edited or removed. Only the reported conversation
            can be opened, and only through this case.
          </p>
          <button type="submit" disabled={pending}>
            {pending ? 'Opening…' : 'Open the reported conversation'}
          </button>
        </form>
      )}

      {state.status === 'READ' && (
        <>
          <p className="muted small">
            Read recorded in the audit log. Up to the 20 most recent messages, oldest first. Read
            receipts are not included — they would show the participants something they never see.
          </p>

          {state.messages.length === 0 ? (
            <p className="not-built">
              The conversation carries no messages the API will return. This is not a claim that
              nothing was said: it may have been deleted, or the excerpt may be unavailable.
            </p>
          ) : (
            <ol className="message-list">
              {state.messages.map((message) => (
                <li key={message.id}>
                  <div className="message-meta">
                    {/*
                      A sender id, not a name. The excerpt carries `senderId`
                      and nothing else about who wrote it, and resolving each id
                      to a profile would be a query per message — and would put
                      a display name beside private correspondence, which is
                      more identification than the decision needs.
                    */}
                    <span className="mono">{message.senderId}</span>
                    <span className="muted small" title={exactInstant(message.createdAt)}>
                      {formatAge(message.createdAt)} ago
                    </span>
                  </div>
                  {/*
                    RENDERED AS TEXT. §34 forbids `dangerouslySetInnerHTML` for
                    message excerpts by name, and this is the surface it had in
                    mind: an attacker who controls a message body and can get it
                    reported chooses exactly who reads it next.
                  */}
                  {message.body === null ? (
                    <p className="muted">
                      <em>No text.</em>
                      {message.mediaId !== null && ' An attachment was sent.'}
                    </p>
                  ) : (
                    <p className="message-body">{message.body}</p>
                  )}
                  {message.body !== null && message.mediaId !== null && (
                    <p className="muted small">An attachment was sent with this message.</p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </>
      )}

      {state.status === 'FAILED' && (
        <div className="notice notice-error" role="alert">
          <p>{state.message}</p>
          <p className="muted small">
            Nothing was shown. Whether the audit log recorded an attempted read is the API&apos;s
            record to answer, not this page&apos;s.
          </p>
          {state.reference !== undefined && (
            <p className="mono muted small">Reference: {state.reference}</p>
          )}
        </div>
      )}
    </section>
  );
}
