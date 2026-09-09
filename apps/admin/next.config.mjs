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
};

export default nextConfig;
