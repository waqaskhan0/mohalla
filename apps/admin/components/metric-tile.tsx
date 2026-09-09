import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Metric tile — one of the six admin components the UI/UX spec names.
 *
 * THE SPEC IS SPECIFIC ABOUT HIERARCHY: "Four tiles: Open reports first and
 * largest — it is the only figure that demands action. Then new users today,
 * posts today, upcoming events."
 *
 * So `emphasis` is not a styling knob. Exactly one tile on the dashboard is
 * `primary`, and it is the one an administrator can act on. Making the others
 * compete would flatten the single signal that tells one moderator whether
 * today is an ordinary day.
 *
 * AGGREGATE FIGURES ONLY. A tile takes a number and a label. There is no
 * drill-down, no per-user breakdown and no export, because ADMIN-FR-011 says
 * aggregate only and the API returns no identifier to build one from.
 */

interface MetricTileProps {
  label: string;
  value: number;
  /** Rendered under the value — what the figure means, not a repeat of it. */
  note?: string;
  emphasis?: 'primary' | 'default';
  /**
   * Where this figure leads, if it leads anywhere.
   *
   * Only the actionable figure has one. §15 asks that the open-report count be
   * "actionable into the moderation queue" — a number that tells somebody
   * there is work and then makes them find it themselves is half a feature.
   */
  href?: string;
  /** Shown instead of `note` when the value is zero and that is good news. */
  zeroNote?: string;
}

export function MetricTile({
  label,
  value,
  note,
  emphasis = 'default',
  href,
  zeroNote,
}: MetricTileProps) {
  const isPrimary = emphasis === 'primary';

  // ZERO IS NOT AN EMPTY STATE HERE, it is an answer — and for open reports it
  // is the good one. §16 treats an empty queue as "a positive operational
  // state, not an error", and the dashboard figure that leads there has to
  // agree, or the two screens tell a moderator different things.
  const caption = value === 0 && zeroNote !== undefined ? zeroNote : note;

  const body: ReactNode = (
    <>
      <span className="tile-label">{label}</span>
      {/* `tabular-nums` so a figure changing from 9 to 10 does not shift the
          layout, and so a column of tiles lines up. */}
      <span className="tile-value">{value.toLocaleString('en')}</span>
      {caption !== undefined && <span className="tile-note">{caption}</span>}
    </>
  );

  const className = isPrimary ? 'metric-tile metric-tile-primary' : 'metric-tile';

  if (href === undefined) {
    return <div className={className}>{body}</div>;
  }

  return (
    <Link href={href} className={`${className} metric-tile-link`}>
      {body}
      {/* The affordance is stated, not implied by a hover colour — the tile is
          a link and a keyboard user needs to know that before focusing it. */}
      <span className="tile-action">Open the queue →</span>
    </Link>
  );
}
