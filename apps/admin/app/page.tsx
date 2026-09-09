import { redirect } from 'next/navigation';

/**
 * The portal's front door.
 *
 * IT REDIRECTS RATHER THAN RENDERING, and this replaced something that was
 * actively misleading. Until now `/` served the Stage 5 foundation landing
 * page — a build/health panel headed "Mohalla Admin - Foundation" whose own
 * copy read "No administration feature is implemented." Group 02 added
 * `/login` and `/dashboard` and left that page in place, so anybody opening
 * the portal at its root was told, in writing, that nothing had been built.
 *
 * `/dashboard` is the right target rather than `/login`, because it is where a
 * signed-in administrator wants to be and it already resolves the other case:
 * without a live session the route guard sends the reader to `/login`, and the
 * login screen sends an already-signed-in reader back here. One destination,
 * both states handled, and no duplicated session check at the entrance.
 *
 * The foundation page's build panel is not carried over. It was a Stage 5
 * development aid, it is not one of the nine approved screens, and §73 is
 * explicit about not inventing admin sections. `components/health-panel.tsx`
 * remains in the tree if the shell ever wants that information properly placed.
 */
export default function RootPage() {
  redirect('/dashboard');
}
