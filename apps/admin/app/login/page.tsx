import { redirect } from 'next/navigation';
import { readAdminToken } from '../../lib/admin-session';
import { LoginForm } from './login-form';

export const metadata = {
  title: 'Sign in · Mohalla Admin',
};

/**
 * UX-ADM-001 — administrator sign-in.
 *
 * NOTHING ON THIS PAGE OFFERS A WAY IN OTHER THAN A CREDENTIAL. No sign-up, no
 * "create an administrator", no invitation, no password reset, no role picker.
 * `05-admin-architecture.md` §1 is explicit that these are *absent rather than
 * hidden*: administrators are provisioned by the technical owner via CLI,
 * out-of-band, with the migration credential the runtime never holds, and a
 * public bootstrap route is the classic takeover vector.
 *
 * The copy says so, because a moderator who cannot sign in needs to know who to
 * ask rather than hunting for a self-service link that does not exist.
 *
 * ALREADY SIGNED IN? Straight to the dashboard. A login form presented to
 * somebody who has a live session invites them to re-enter a password for no
 * reason, and re-authenticating would discard a perfectly good session.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ expired?: string }>;
}) {
  // Set by `/session-expired` after an 8-hour session ran out or was revoked.
  // Said plainly, because "sign in again" with no reason reads as though the
  // first attempt failed — and a moderator interrupted mid-review deserves to
  // know it was the clock and not their password.
  const { expired } = await searchParams;

  // THE `expired` MARKER WINS OVER THE COOKIE, and this is not a nicety.
  //
  // Measured in the browser: without it, the expiry path bounced five times —
  // `/dashboard` 307 → `/session-expired` 303 → `/login?expired=1` 307 →
  // `/dashboard` 307 → ... — before settling. `/session-expired` deletes the
  // cookie, but the very next request can still carry it, and this page was
  // sending anybody holding a cookie straight back to the dashboard, which
  // 401s, which returns here. Five flashes of two screens, and in the case
  // where the deletion does not land at all, an unbreakable loop.
  //
  // The marker is authoritative because of where it comes from: only
  // `/session-expired` sets it, and it sets it immediately after clearing the
  // session. If it is present, the session is dead whatever the cookie says.
  if (expired !== '1' && (await readAdminToken()) !== null) {
    redirect('/dashboard');
  }

  return (
    <main className="login-page">
      <div className="login-card">
        <h1>Mohalla Admin</h1>
        <p className="muted">
          Shehersaaz Community Platform — moderation and administration console.
        </p>

        {expired === '1' && (
          <div role="status" className="notice">
            <p>Your session has ended. Sign in again to continue.</p>
          </div>
        )}

        <LoginForm />

        <p className="muted small login-note">
          Administrator accounts are created by the technical owner and cannot be requested here. If
          you need access, contact them directly.
        </p>
      </div>
    </main>
  );
}
