'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * The admin sidebar — one of the six admin components the UI/UX spec names
 * (§18: Sidebar · Data table · Metric tile · Severity indicator · Filter bar ·
 * Decision panel).
 *
 * SIX DESTINATIONS AND NO MORE. §14 lists them and says not to invent dozens of
 * admin sections; the nine approved screens reach each other from here, from a
 * dashboard figure, or from a table row. Queue item detail and user detail have
 * no sidebar entry on purpose — they are reached from the row they belong to,
 * which is what the spec's "Entry:" column says for each.
 *
 * A CLIENT COMPONENT ONLY FOR `usePathname`. It receives no data and holds no
 * state; the active item is derived from the URL, so a link opened in a new tab
 * or restored from history highlights correctly without anything being stored.
 *
 * ACTIVE STATE IS `aria-current="page"`, NOT JUST A COLOUR. §44 and NFR-ACC-005
 * both require that meaning never rests on colour alone: the accent bar is the
 * visual signal, `aria-current` is the announced one, and the two are set from
 * the same condition so they cannot disagree.
 */

interface Destination {
  href: string;
  label: string;
  /** Announced at the 64px rail, where the label is not rendered. */
  icon: ReactNode;
}

/**
 * Inline SVG rather than an icon package.
 *
 * Six glyphs do not justify a dependency, and an icon font would be a second
 * network request on the one screen an administrator opens during an incident.
 * `aria-hidden` on each, because the adjacent text — or the `aria-label` on the
 * link at the rail — is what carries the meaning.
 */
const icon = (path: string) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d={path} />
  </svg>
);

const DESTINATIONS: Destination[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: icon('M3 13h8V3H3v10Zm10 8h8v-6h-8v6ZM3 21h8v-6H3v6Zm10-10h8V3h-8v8Z'),
  },
  {
    href: '/moderation',
    label: 'Moderation',
    icon: icon('M12 3l7 4v5c0 4.5-3 8-7 9-4-1-7-4.5-7-9V7l7-4Z'),
  },
  {
    href: '/users',
    label: 'Users',
    icon: icon('M16 20v-2a4 4 0 0 0-8 0v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z'),
  },
  {
    href: '/announcements',
    label: 'Announcements',
    icon: icon('M4 10v4h3l5 4V6l-5 4H4Zm12-1a4 4 0 0 1 0 6'),
  },
  {
    href: '/verification',
    label: 'Verification',
    icon: icon('M9 12l2 2 4-4m-3-7 7 4v5c0 4.5-3 8-7 9-4-1-7-4.5-7-9V7l7-4Z'),
  },
  {
    href: '/audit-log',
    label: 'Audit log',
    icon: icon('M8 4h9l3 3v13H8V4Zm3 6h6M11 14h6M11 18h4'),
  },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <nav className="admin-sidebar" aria-label="Admin sections">
      <ul>
        {DESTINATIONS.map((destination) => {
          // A prefix match, so `/moderation/cases/abc` keeps Moderation lit.
          // Exact matching would leave the sidebar with nothing highlighted the
          // moment an administrator opened a case, which reads as being lost.
          const active =
            pathname === destination.href || pathname.startsWith(`${destination.href}/`);

          return (
            <li key={destination.href}>
              <Link
                href={destination.href}
                aria-current={active ? 'page' : undefined}
                // The label is hidden at the 64px rail, so the link carries it
                // for a screen reader either way.
                aria-label={destination.label}
                className={active ? 'nav-item nav-item-active' : 'nav-item'}
              >
                {destination.icon}
                <span className="nav-label">{destination.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
