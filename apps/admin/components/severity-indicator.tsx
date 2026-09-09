/**
 * Severity indicator — one of the six admin components.
 *
 * THE SPEC IS UNAMBIGUOUS: "severity is a coloured dot plus a text label,
 * never colour alone." NFR-ACC-005 says the same as a requirement, and §44
 * repeats it. So the label is always rendered; the dot is the scanning aid, not
 * the information.
 *
 * That matters more here than almost anywhere else in the product. A moderator
 * reads down this column to decide what to open first, and roughly one in
 * twelve men has some form of colour vision deficiency — a queue that encoded
 * urgency in hue alone would be unreadable to them at exactly the moment it
 * matters.
 *
 * AN UNKNOWN SEVERITY RENDERS AS ITSELF. The API's enum is LOW, MEDIUM, HIGH,
 * CRITICAL, but the portal is a separate deployable: if Stage 6 adds a fifth
 * level, the honest thing is to show the value rather than fall back to
 * something that looks deliberate. A case shown as "LOW" because the portal
 * did not recognise "SEVERE" is worse than one shown as "SEVERE" with a plain
 * dot.
 */

const KNOWN = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

/** Title case for display; the wire value is upper snake. */
function label(severity: string): string {
  return severity.charAt(0) + severity.slice(1).toLowerCase();
}

export function SeverityIndicator({ severity }: { severity: string }) {
  const known = KNOWN.has(severity);
  const modifier = known ? severity.toLowerCase() : 'unknown';

  return (
    <span className="severity">
      <span className={`severity-dot severity-dot-${modifier}`} aria-hidden="true" />
      <span className="severity-label">{known ? label(severity) : severity}</span>
    </span>
  );
}

/**
 * Whether content is currently hidden from readers, said in words.
 *
 * `autoHidden` is the state BR-025 produces when reports cross a threshold: the
 * content is already invisible to everyone before any administrator has looked
 * at it. A moderator needs to know that before deciding, because it changes
 * what the decision does — restoring puts something back, and confirming a
 * removal on already-hidden content changes nothing a reader can see.
 *
 * Rendered as text rather than an icon, for the same reason as severity.
 */
export function VisibilityFlag({ autoHidden }: { autoHidden: boolean }) {
  if (!autoHidden) {
    return <span className="muted">Visible</span>;
  }

  return <span className="flag flag-hidden">Auto-hidden</span>;
}
