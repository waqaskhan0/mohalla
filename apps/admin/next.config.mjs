/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The admin console is an internal tool served over HTTPS by the platform.
  poweredByHeader: false,

  // Next 16 writes AGENTS.md and CLAUDE.md into the app directory on `dev`
  // unless this is off. Turned off because the repository is PUBLIC and those
  // are generated files: they appeared untracked, they would have been swept
  // into the next `git add -A`, and in a repository that already used CLAUDE.md
  // for its own instructions the generator would be overwriting it. A
  // framework should not be authoring committed documentation as a side effect
  // of starting a dev server.
  agentRules: false,

  /**
   * The headers that are the same on every response.
   *
   * The Content-Security-Policy is NOT here — it carries a per-request nonce,
   * so it is set in `middleware.ts`. Everything below is constant, and a
   * constant header belongs in the place that cannot forget to send it.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          /**
           * DENY, and `frame-ancestors 'none'` in the CSP says the same thing.
           * Both, because the CSP directive is the modern rule and this is the
           * one older browsers obey — and an administration console that could
           * be framed is a console whose Delete button can be positioned under
           * somebody else's cursor.
           */
          { key: 'X-Frame-Options', value: 'DENY' },

          /**
           * NO REFERRER AT ALL, which is a privacy decision rather than a
           * default. Admin URLs carry case ids and account ids —
           * `/moderation/<caseId>`, `/users/<userId>` — and any weaker policy
           * hands those to whatever origin the browser visits next.
           */
          { key: 'Referrer-Policy', value: 'no-referrer' },

          /**
           * The portal renders user-generated text. Content sniffing is how a
           * response the server called text becomes a script the browser runs.
           */
          { key: 'X-Content-Type-Options', value: 'nosniff' },

          /**
           * Nothing here needs a camera, a microphone, a location or a
           * payment handler, so nothing here gets one. This is the header
           * that keeps a future dependency from quietly asking.
           */
          {
            key: 'Permissions-Policy',
            value:
              'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
          },

          /**
           * Isolates the browsing context, so a window this portal opens — or
           * one that opened it — cannot reach into it. Cheap, and it closes
           * the cross-window half of the same problem `frame-ancestors`
           * closes for frames.
           */
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },

          /**
           * Two years, subdomains included. SEC-024 keeps the session in a
           * `__Host-`-prefixed cookie, and that prefix REQUIRES Secure, so a
           * downgrade to HTTP does not merely weaken the session — it breaks
           * it. Browsers ignore this header over plain HTTP, so it is inert in
           * local development and correct in the only place the portal is
           * really served.
           */
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
