package org.shehersaaz.mohalla.navigation

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.Lifecycle
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.navigation
import androidx.navigation.compose.rememberNavController
import kotlinx.coroutines.launch
import org.shehersaaz.mohalla.MainActivity
import org.shehersaaz.mohalla.core.config.BuildEnvironment
import org.shehersaaz.mohalla.core.di.AppContainer
import org.shehersaaz.mohalla.core.media.rememberImagePickerLauncher
import org.shehersaaz.mohalla.core.network.ApiFailure
import org.shehersaaz.mohalla.core.network.ApiResult
import org.shehersaaz.mohalla.core.ui.OfflineBanner
import org.shehersaaz.mohalla.core.ui.ContentUnavailable
import org.shehersaaz.mohalla.core.ui.LoadingState
import org.shehersaaz.mohalla.core.ui.MohallaDateTimePicker
import org.shehersaaz.mohalla.feature.auth.ForgotPasswordScreen
import org.shehersaaz.mohalla.feature.auth.LoginScreen
import org.shehersaaz.mohalla.feature.auth.LoginViewModel
import org.shehersaaz.mohalla.feature.auth.OtpPurpose
import org.shehersaaz.mohalla.feature.auth.OtpScreen
import org.shehersaaz.mohalla.feature.auth.OtpViewModel
import org.shehersaaz.mohalla.feature.auth.PasswordResetViewModel
import org.shehersaaz.mohalla.feature.auth.RegisterDateOfBirthScreen
import org.shehersaaz.mohalla.feature.auth.RegisterPasswordScreen
import org.shehersaaz.mohalla.feature.auth.RegisterPhoneScreen
import org.shehersaaz.mohalla.feature.auth.RegisterTermsScreen
import org.shehersaaz.mohalla.feature.auth.RegisterViewModel
import org.shehersaaz.mohalla.feature.auth.ResetPasswordScreen
import org.shehersaaz.mohalla.feature.auth.RestoreAccountScreen
import org.shehersaaz.mohalla.feature.auth.RestoreAccountViewModel
import org.shehersaaz.mohalla.feature.auth.WelcomeScreen
import org.shehersaaz.mohalla.feature.create.ComposerScreen
import org.shehersaaz.mohalla.feature.create.ComposerViewModel
import org.shehersaaz.mohalla.feature.events.EventComposerScreen
import org.shehersaaz.mohalla.feature.events.EventComposerViewModel
import org.shehersaaz.mohalla.feature.events.EventDetailScreen
import org.shehersaaz.mohalla.feature.events.EventDetailViewModel
import org.shehersaaz.mohalla.feature.events.EventsScreen
import org.shehersaaz.mohalla.feature.events.EventsViewModel
import org.shehersaaz.mohalla.feature.events.JoinOutcome
import org.shehersaaz.mohalla.feature.home.FeedViewModel
import org.shehersaaz.mohalla.feature.home.HomeScreen
import org.shehersaaz.mohalla.feature.messages.ConversationScreen
import org.shehersaaz.mohalla.feature.messages.ConversationViewModel
import org.shehersaaz.mohalla.feature.messages.InboxScreen
import org.shehersaaz.mohalla.feature.messages.InboxViewModel
import org.shehersaaz.mohalla.feature.messages.RequestState
import org.shehersaaz.mohalla.feature.notifications.NotificationDestination
import org.shehersaaz.mohalla.feature.notifications.NotificationPreferencesScreen
import org.shehersaaz.mohalla.feature.notifications.NotificationPreferencesViewModel
import org.shehersaaz.mohalla.feature.notifications.NotificationsScreen
import org.shehersaaz.mohalla.feature.notifications.NotificationsViewModel
import org.shehersaaz.mohalla.feature.profile.EditProfileScreen
import org.shehersaaz.mohalla.feature.profile.EditProfileViewModel
import org.shehersaaz.mohalla.feature.profile.ProfileScreen
import org.shehersaaz.mohalla.feature.profile.ProfileViewModel
import org.shehersaaz.mohalla.feature.profile.SavedPostsScreen
import org.shehersaaz.mohalla.feature.profile.SavedPostsViewModel
import org.shehersaaz.mohalla.feature.profile.UserListKind
import org.shehersaaz.mohalla.feature.profile.UserListScreen
import org.shehersaaz.mohalla.feature.profile.UserListViewModel
import org.shehersaaz.mohalla.feature.settings.AboutScreen
import org.shehersaaz.mohalla.feature.settings.BlockedUsersScreen
import org.shehersaaz.mohalla.feature.settings.BlockedUsersViewModel
import org.shehersaaz.mohalla.feature.settings.ChangePasswordScreen
import org.shehersaaz.mohalla.feature.settings.ChangePasswordViewModel
import org.shehersaaz.mohalla.feature.settings.DeleteAccountScreen
import org.shehersaaz.mohalla.feature.settings.DeleteAccountViewModel
import org.shehersaaz.mohalla.feature.settings.HelpScreen
import org.shehersaaz.mohalla.feature.settings.LanguageSettingsScreen
import org.shehersaaz.mohalla.feature.settings.LegalDocumentScreen
import org.shehersaaz.mohalla.feature.settings.SettingsScreen
import org.shehersaaz.mohalla.feature.settings.SettingsViewModel
import org.shehersaaz.mohalla.feature.post.ImageViewerScreen
import org.shehersaaz.mohalla.feature.post.PostDetailScreen
import org.shehersaaz.mohalla.feature.post.PostDetailViewModel
import org.shehersaaz.mohalla.feature.search.SearchScreen
import org.shehersaaz.mohalla.feature.search.SearchViewModel
import org.shehersaaz.mohalla.feature.safety.BlockConfirmSheet
import org.shehersaaz.mohalla.feature.safety.ReportSheet
import org.shehersaaz.mohalla.feature.safety.ReportTarget
import org.shehersaaz.mohalla.feature.safety.ReportViewModel
import org.shehersaaz.mohalla.feature.safety.SafetyMenuSheet
import org.shehersaaz.mohalla.feature.safety.SuspensionExplainerSheet
import org.shehersaaz.mohalla.feature.setup.ProfileSetupScreen
import org.shehersaaz.mohalla.feature.setup.ProfileSetupViewModel
import org.shehersaaz.mohalla.feature.setup.SuggestedAccountsScreen
import org.shehersaaz.mohalla.feature.setup.SuggestionsViewModel
import org.shehersaaz.mohalla.feature.setup.UsernameScreen
import org.shehersaaz.mohalla.feature.setup.UsernameViewModel
import org.shehersaaz.mohalla.feature.home.AnnouncementDetailScreen

/**
 * The navigation graph.
 *
 * TWO GRAPHS IN ONE, AND THE SEAM IS DELIBERATE. Everything before [Routes.SHELL]
 * is a linear flow with a back stack; the shell replaces it entirely. Arriving at
 * the shell pops the auth graph with `inclusive = true`, so pressing Back on Home
 * leaves the app rather than returning to a login screen for a session that is
 * now valid — the defect §12 calls out by name.
 *
 * THE START DESTINATION IS DECIDED BY [org.shehersaaz.mohalla.feature.startup]'s
 * pure resolver, not here. This file routes; it does not judge. Duplicating even
 * part of that decision would give the app two answers to "where does a
 * suspended account land", and the answer that ships would be whichever ran last.
 *
 * WHY STRING ROUTES. §42's deep links have to match on patterns, and
 * navigation-compose's type-safe routes would mean maintaining the pattern twice
 * — once as a class and once as the string the intent filter matches.
 */
@Composable
fun MohallaNavHost(
    container: AppContainer,
    startRoute: String,
    onRequestLanguageChange: () -> Unit,
    navController: NavHostController = rememberNavController(),
) {
    // §43 — a hint, never a gate. It sits ABOVE the whole graph rather than
    // inside the shell, because the shell is five destinations out of forty:
    // somebody who followed a notification into a conversation, or opened a
    // profile from search, was seeing no banner at all while every request they
    // made failed. Nothing below is disabled by it; requests are still
    // attempted and their own failure is authoritative.
    val online by container.connectivity.isOnline()
        .collectAsState(initial = container.connectivity.isOnlineNow())

    // EDGE-010 — the session died while the app was open. The interceptor has
    // already cleared everything; this is the part that must happen on the main
    // thread, and it happens ONCE however many requests were in flight.
    val revoked by container.sessionRevocation.revoked.collectAsState()
    LaunchedEffect(revoked) {
        if (revoked) {
            container.sessionRevocation.acknowledge()
            navController.navigate(Routes.WELCOME) {
                // The whole graph goes. Back must not return to a screen
                // rendering cached content for a session that no longer exists.
                popUpTo(0) { inclusive = true }
            }
        }
    }

    // §42 — a link is honoured once, and only from a destination the reader is
    // entitled to be on. `startRoute` is the startup resolver's answer, so
    // checking it is checking whether authentication has already happened: a
    // link tapped while signed out waits through the whole login flow rather
    // than being dropped, and never renders before §9 allows it.
    LaunchedEffect(startRoute) {
        if (startRoute == Routes.SHELL) {
            container.pendingDeepLink.take()?.let { navController.navigate(it) }
        }
    }

    Column(modifier = Modifier.fillMaxSize()) {
        if (!online) {
            OfflineBanner(
                modifier = Modifier.windowInsetsPadding(WindowInsets.statusBars),
            )
        }

        NavHost(navController = navController, startDestination = startRoute) {
            authGraph(navController, container)
            setupGraph(navController, container)

            composable(Routes.SHELL) {
                ShellRoute(
                    container = container,
                    navController = navController,
                    onOpenSettings = onRequestLanguageChange,
                )
            }

            /**
         * UX-HOME-006 — an announcement, in full.
         *
         * IT READS FROM THE FEED'S OWN STATE rather than fetching. There is no
         * public `GET /announcements/{id}`: Stage 6 serves single-announcement
         * routes only under `/admin/`, which §49 excludes. The featured payload
         * already carries every field this screen shows, so a fetch would be a
         * request for data the device holds. See `AnnouncementDetailScreen`.
         */
        composable(Routes.ANNOUNCEMENT_PATTERN) { entry ->
            val id = entry.arguments?.getString("announcementId")
            val feed: FeedViewModel = viewModel(
                factory = FeedViewModel.Factory(
                    repository = container.feedRepository,
                    locale = { container.formattingLocale().toLanguageTag() },
                ),
            )
            val state by feed.state.collectAsState()

            AnnouncementDetailScreen(
                announcement = state.featured.firstOrNull { it.id == id },
                onBack = { navController.popBackStack() },
            )
        }

        // UX-EVENT-003. Deep-linkable (§42): reachable from the events list, a
            // feed card, search and a notification, so it takes its id from the
            // route rather than from a shared object.
            composable(Routes.EVENT_PATTERN) { entry ->
                val eventId = entry.arguments?.getString("eventId")

                // A route with no id cannot be a real event. The neutral state,
                // not a crash and not an error — a malformed deep link and a
                // deleted event are indistinguishable to the person who tapped it.
                if (eventId == null) {
                    ContentUnavailable()
                } else {
                    EventDetailRoute(
                        container = container,
                        eventId = eventId,
                        onBack = { navController.popBackStack() },
                        onEdit = { navController.navigate(Routes.eventEdit(eventId)) },
                        onOpenCreator = { navController.navigate(Routes.profile(it)) },
                    )
                }
            }

            // UX-CREATE-001. A destination rather than a tab, so returning from
            // it leaves the previously selected tab intact.
            composable(Routes.COMPOSER) {
                ComposerRoute(
                    container = container,
                    onDone = { navController.popBackStack() },
                )
            }

            // UX-EVENT-004 and UX-EVENT-005 — one screen, two entry points.
            composable(Routes.EVENT_CREATE) {
                EventComposerRoute(
                    container = container,
                    editingEventId = null,
                    onDone = { navController.popBackStack() },
                )
            }

            composable(Routes.EVENT_EDIT_PATTERN) { entry ->
                val eventId = entry.arguments?.getString("eventId")
                if (eventId == null) {
                    ContentUnavailable()
                } else {
                    EventComposerRoute(
                        container = container,
                        editingEventId = eventId,
                        // Cancelling or saving returns past the DETAIL screen too
                        // when the event was deleted, because a detail screen for a
                        // deleted event would then load the neutral unavailable
                        // state — technically correct and alarming after the
                        // creator just chose to remove it themselves.
                        onDone = { navController.popBackStack() },
                        onDeleted = {
                            navController.popBackStack(Routes.SHELL, inclusive = false)
                        },
                    )
                }
            }

            // UX-HOME-003. Deep-linkable (§42): reachable from a card, a
            // notification, search and a profile.
            composable(Routes.POST_PATTERN) { entry ->
                val postId = entry.arguments?.getString("postId")

                if (postId == null) {
                    ContentUnavailable()
                } else {
                    PostDetailRoute(
                        container = container,
                        postId = postId,
                        onBack = { navController.popBackStack() },
                        onOpenAuthor = { navController.navigate(Routes.profile(it)) },
                        onOpenMedia = { ids, index ->
                            navController.navigate(Routes.imageViewer(ids, index))
                        },
                    )
                }
            }

            // UX-SEARCH-001..003. Reached from the Home top bar, and from the
            // empty Following feed's "find people to follow" (RSK-001's screen).
            composable(Routes.SEARCH) {
                SearchRoute(
                    container = container,
                    onBack = { navController.popBackStack() },
                    onOpenPerson = { navController.navigate(Routes.profile(it)) },
                    onOpenPost = { navController.navigate(Routes.post(it)) },
                    onOpenEvent = { navController.navigate(Routes.event(it)) },
                )
            }

            // UX-HOME-004 — the full-screen viewer.
            composable(Routes.IMAGE_VIEWER_PATTERN) { entry ->
                val ids = entry.arguments?.getString("mediaIds")
                    ?.split(Routes.MEDIA_ID_SEPARATOR)
                    ?.filter { it.isNotBlank() }
                    .orEmpty()
                val index = entry.arguments?.getString("index")?.toIntOrNull() ?: 0

                ImageViewerScreen(
                    mediaIds = ids,
                    initialIndex = index,
                    onClose = { navController.popBackStack() },
                )
            }

            // UX-MSG-003. Deep-linkable (§42): reachable from the inbox and from a
            // notification.
            composable(Routes.CONVERSATION_PATTERN) { entry ->
                val conversationId = entry.arguments?.getString("conversationId")

                if (conversationId == null) {
                    ContentUnavailable()
                } else {
                    ConversationRoute(
                        container = container,
                        conversationId = conversationId,
                        onBack = { navController.popBackStack() },
                        onOpenProfile = { navController.navigate(Routes.profile(it)) },
                    )
                }
            }

            // MSG-FR-001 — opening a conversation from a PROFILE, where the caller
            // has a user id and no conversation id. BR-024 resolves the one thread
            // that exists for the pair, so this asks the server rather than
            // inventing an id.
            composable(Routes.CONVERSATION_WITH_PATTERN) { entry ->
                val userId = entry.arguments?.getString("userId")

                if (userId == null) {
                    ContentUnavailable()
                } else {
                    OpenConversationRoute(
                        container = container,
                        userId = userId,
                        onOpened = { conversationId ->
                            navController.navigate(Routes.conversation(conversationId)) {
                                // The resolving screen is not somewhere to come back
                                // to: pressing Back from the conversation should
                                // return to the profile, not to a spinner that would
                                // immediately resolve forward again.
                                popUpTo(Routes.CONVERSATION_WITH_PATTERN) { inclusive = true }
                            }
                        },
                        onFailed = { navController.popBackStack() },
                    )
                }
            }

            // UX-HOME-007 - the notification centre.
            composable(Routes.NOTIFICATIONS) {
                NotificationsRoute(
                    container = container,
                    onBack = { navController.popBackStack() },
                    navController = navController,
                )
            }

            // UX-SET-003. Reachable by route before the settings index that will
            // link to it (group 16) exists.
            composable(Routes.NOTIFICATION_PREFERENCES) {
                NotificationPreferencesRoute(
                    container = container,
                    onBack = { navController.popBackStack() },
                )
            }

            // Deep-linkable content (§42). The screen arrives with its own group;
            // until then the route renders the neutral unavailable state rather
            // than a stub that would claim the content is missing — UX-STATE-001 is
            // the one state that is honest about "not available here", and it says
            // nothing about why.
            // UX-PROFILE-002. Deep-linkable (§42), and reached from a post author
            // row, a search result, a follower list and a FOLLOW notification.
            composable(Routes.PROFILE_PATTERN) { entry ->
                val handle = entry.arguments?.getString("handle")

                if (handle == null) {
                    ContentUnavailable()
                } else {
                    ProfileRoute(
                        container = container,
                        navController = navController,
                        userId = handle,
                        onBack = { navController.popBackStack() },
                    )
                }
            }

            // UX-SET-001 — the index, and everything under it.
            composable(Routes.SETTINGS) {
                SettingsRoute(container = container, navController = navController)
            }

            composable(Routes.SETTINGS_LANGUAGE) {
                LanguageSettingsRoute(
                    container = container,
                    onBack = { navController.popBackStack() },
                )
            }

            composable(Routes.SETTINGS_PASSWORD) {
                ChangePasswordRoute(
                    container = container,
                    onBack = { navController.popBackStack() },
                )
            }

            composable(Routes.SETTINGS_BLOCKED) {
                BlockedUsersRoute(
                    container = container,
                    onBack = { navController.popBackStack() },
                )
            }

            composable(Routes.SETTINGS_HELP) {
                val context = LocalContext.current
                HelpScreen(
                    onBack = { navController.popBackStack() },
                    onEmail = { address -> sendSupportEmail(context, address) },
                )
            }

            composable(Routes.SETTINGS_ABOUT) {
                AboutScreen(onBack = { navController.popBackStack() })
            }

            // UX-SET-009.
            composable(Routes.DELETE_ACCOUNT) {
                DeleteAccountRoute(
                    container = container,
                    onBack = { navController.popBackStack() },
                    onDeleted = {
                        // Every session was revoked server-side, so this device is
                        // holding a token that no longer answers. The whole graph
                        // goes with it — Back must not return to a shell rendering
                        // cached content for an account that is gone.
                        navController.navigate(Routes.WELCOME) {
                            popUpTo(0) { inclusive = true }
                        }
                    },
                )
            }

            // UX-SET-006 — one screen, three documents, none of which exists.
            composable(Routes.LEGAL_PATTERN) { entry ->
                LegalDocumentScreen(
                    titleRes = when (entry.arguments?.getString("kind")) {
                        Routes.LEGAL_GUIDELINES ->
                            org.shehersaaz.mohalla.R.string.settings_guidelines
                        Routes.LEGAL_PRIVACY -> org.shehersaaz.mohalla.R.string.settings_privacy
                        else -> org.shehersaaz.mohalla.R.string.settings_terms
                    },
                    onBack = { navController.popBackStack() },
                )
            }

            // UX-PROFILE-003.
            composable(Routes.EDIT_PROFILE) {
                EditProfileRoute(
                    container = container,
                    onBack = { navController.popBackStack() },
                )
            }

            // UX-PROFILE-006.
            composable(Routes.SAVED_POSTS) {
                SavedPostsRoute(
                    container = container,
                    navController = navController,
                    onBack = { navController.popBackStack() },
                )
            }

            // UX-PROFILE-004 and UX-PROFILE-005.
            composable(Routes.FOLLOWERS_PATTERN) { entry ->
                UserListRoute(
                    container = container,
                    navController = navController,
                    userId = entry.arguments?.getString("userId"),
                    kind = UserListKind.FOLLOWERS,
                )
            }

            composable(Routes.FOLLOWING_PATTERN) { entry ->
                UserListRoute(
                    container = container,
                    navController = navController,
                    userId = entry.arguments?.getString("userId"),
                    kind = UserListKind.FOLLOWING,
                )
            }
        }
    }
}

/**
 * The shell and the tab contents it hosts.
 *
 * Split out of the graph so the shell's state survives tab switches without a
 * back-stack entry per tab: §12 requires that switching tabs is not a navigation
 * event, because a five-item bar with a back stack means Back walks a history of
 * tab taps the user does not remember making.
 */
@Composable
private fun ShellRoute(
    container: AppContainer,
    navController: NavHostController,
    onOpenSettings: () -> Unit,
) {
    val shell: ShellViewModel = viewModel(
        factory = ShellViewModel.Factory(
            sessions = container.sessionRepository,
            connectivity = container.connectivity,
            messaging = container.messagingRepository,
            notifications = container.notificationRepository,
            formatUntil = container.formatDate,
        ),
    )
    val state by shell.state.collectAsState()

    // The capability and both badges go stale while the app is away: a
    // suspension can be applied by a moderator, and messages and notifications
    // arrive whether or not anybody is looking. `ON_RESUME` rather than
    // `LaunchedEffect(Unit)`, because composition survives backgrounding and
    // would re-read neither.
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) shell.onResumed()
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    var explainerVisible by remember { mutableStateOf(false) }

    MohallaShell(
        state = state,
        onSelectTab = shell::selectTab,
        // A suspended account never gets here: the shell diverts the tap to the
        // explainer before any navigation happens (BR-034, §6.2).
        onCreate = { navController.navigate(Routes.COMPOSER) },
        onShowSuspensionExplainer = { explainerVisible = true },
    ) { tab ->
        when (tab) {
            MohallaTab.HOME -> HomeRoute(
                container = container,
                navController = navController,
                onOpenPost = { navController.navigate(Routes.post(it)) },
                // The bell's dot. Read by the shell rather than by Home, so it
                // survives switching tabs and is one number in one place.
                unreadNotifications = state.unreadNotifications,
            )

            MohallaTab.EVENTS -> EventsRoute(
                container = container,
                onOpenEvent = { navController.navigate(Routes.event(it)) },
                onCreateEvent = { navController.navigate(Routes.EVENT_CREATE) },
            )

            MohallaTab.MESSAGES -> InboxRoute(
                container = container,
                onOpenConversation = { conversationId ->
                    navController.navigate(Routes.conversation(conversationId))
                },
                onFindPeople = { navController.navigate(Routes.SEARCH) },
            )

            MohallaTab.PROFILE -> ProfileRoute(
                container = container,
                navController = navController,
                // The owner's own, so no id: `GET /me` returns a superset of
                // the public projection and the screen reads the same fields.
                userId = null,
                onBack = null,
            )

            // Unreachable: the shell diverts Create before selection, and
            // `selectTab` refuses it. Listed so adding a tab fails to compile.
            MohallaTab.CREATE -> Unit
        }
    }

    if (explainerVisible) {
        SuspensionExplainerSheet(
            untilLabel = state.suspendedUntilLabel,
            // The server's own wording, or nothing. See the sheet's doc comment.
            reason = null,
            onDismiss = { explainerVisible = false },
            onContactSupport = onOpenSettings,
        )
    }

}

@Composable
private fun HomeRoute(
    container: AppContainer,
    navController: NavHostController,
    onOpenPost: (String) -> Unit,
    unreadNotifications: Int,
) {
    val feed: FeedViewModel = viewModel(
        factory = FeedViewModel.Factory(
            repository = container.feedRepository,
            locale = { container.localeStore.stored()?.tag ?: "en" },
        ),
    )
    val state by feed.state.collectAsState()

    // §19's "renders from the feed's cached copy instantly" needs the feed to
    // put what it rendered somewhere the detail screen can read it.
    LaunchedEffect(state.following.items, state.discover.items) {
        container.postCache.put(state.following.items + state.discover.items)
    }

    val context = LocalContext.current

    // UX-HOME-005's options. Once per process — eleven rows that do not

    // change between launches (BR-017).

    LaunchedEffect(Unit) { feed.loadCategories() }


    HomeScreen(
        state = state,
        onSelectTab = feed::selectTab,
        onRefresh = feed::refresh,
        onLoadMore = feed::loadMore,
        onOpenPost = onOpenPost,
        onOpenAuthor = { navController.navigate(Routes.profile(it)) },
        onToggleLike = feed::toggleLike,
        onShare = { postId -> sharePost(context, postId) },
        // UX-HOME-006. This was `{}` — an empty lambda — so the Featured strip's
        // cards and every ANNOUNCEMENT notification were tappable and inert.
        onOpenAnnouncement = { navController.navigate(Routes.announcement(it)) },
        onFindPeople = { navController.navigate(Routes.SEARCH) },
        // UX-HOME-005. `selectCategory` has always reached the API; until now
        // nothing called it.
        onSelectCategory = feed::selectCategory,
        onSearch = { navController.navigate(Routes.SEARCH) },
        onOpenNotifications = { navController.navigate(Routes.NOTIFICATIONS) },
        unreadNotifications = unreadNotifications,
    )
}

/**
 * UX-CREATE-001 — the composer.
 *
 * THE PICKER LAUNCHER LIVES HERE, not in the ViewModel. An
 * `ActivityResultLauncher` has to be registered during composition against this
 * destination's own lifecycle; a ViewModel that held one would outlive the
 * registration and deliver its result to a dead callback. So the ViewModel owns
 * the attachment state machine and the screen owns the platform contract.
 */
@Composable
private fun ComposerRoute(
    container: AppContainer,
    onDone: () -> Unit,
) {
    val vm: ComposerViewModel = viewModel(
        factory = ComposerViewModel.Factory(
            posts = container.postRepository,
            images = container.imagePicker,
            drafts = container.draftStore,
        ),
    )
    val state by vm.state.collectAsState()

    // Capped at what remains of the four, so the picker never lets somebody
    // select images the app is about to discard (BR-013).
    val pickImages = rememberImagePickerLauncher(
        remaining = state.remainingImages,
        // `Uri` becomes a `String` here, at the boundary. The ViewModel holds
        // no Android types, which is what lets EDGE-013's sequencing be
        // asserted in a plain JVM test.
        onPicked = { uris -> vm.onImagesPicked(uris.map { it.toString() }) },
    )

    ComposerScreen(
        state = state,
        // The author block confirms whose name is about to be attached (§19
        // item 3). Resolved from the cached session profile rather than a
        // fresh request: the composer opens on a tap and must not wait.
        author = remember { container.sessionRepository.cachedIdentity()?.asProfile() },
        onBodyChanged = vm::onBodyChanged,
        onPickImages = pickImages,
        onRetryAttachment = vm::retryAttachment,
        onRemoveAttachment = vm::removeAttachment,
        onCategoryChanged = vm::onCategoryChanged,
        onPublish = vm::publish,
        onClose = onDone,
        onDiscard = vm::discard,
        onPublished = onDone,
        isUrdu = container.localeStore.stored()?.isRtl == true,
    )
}

/**
 * UX-HOME-003 — post detail, comments and the engagement controls.
 *
 * THE CACHED POST IS READ ONCE, at construction, and passed to the ViewModel
 * for its first frame only. Reading it on every recomposition would let a
 * background feed refresh replace what is on screen mid-scroll.
 */
@Composable
private fun PostDetailRoute(
    container: AppContainer,
    postId: String,
    onBack: () -> Unit,
    onOpenAuthor: (String) -> Unit,
    onOpenMedia: (List<String>, Int) -> Unit,
) {
    val vm: PostDetailViewModel = viewModel(
        factory = PostDetailViewModel.Factory(
            source = container.postDetailRepository,
            relations = container.viewerRelations,
            postId = postId,
            cached = remember(postId) { container.postCache.get(postId) },
            viewerId = { container.sessionRepository.cachedUserId() },
            // Once the server says a post is gone, the cache must stop serving
            // it — otherwise "renders instantly" keeps showing a withdrawn post
            // for the life of the process.
            onUnavailable = { container.postCache.forget(it) },
        ),
    )
    val state by vm.state.collectAsState()
    val context = LocalContext.current
    var safety by remember { mutableStateOf<SafetyRequest?>(null) }

    PostDetailScreen(
        state = state,
        onBack = onBack,
        onRetry = vm::refreshPost,
        onToggleLike = vm::toggleLike,
        onDraftChanged = vm::onDraftChanged,
        onSubmitComment = vm::submitComment,
        onReplyTo = vm::replyTo,
        onDeleteComment = vm::deleteComment,
        canDeleteComment = vm::canDelete,
        onDeletePost = vm::deletePost,
        // A deleted post has nowhere to be, so the screen leaves rather than
        // rendering the neutral state over the thing the author just removed.
        onDeleted = onBack,
        onOpenAuthor = onOpenAuthor,
        onOpenMedia = { index -> onOpenMedia(state.post?.mediaIds.orEmpty(), index) },
        onShare = { sharePost(context, postId) },
        onToggleSave = vm::toggleSave,
        onReportPost = {
            state.post?.let { post ->
                safety = SafetyRequest(
                    target = ReportTarget.POST,
                    targetId = post.id,
                    subjectUserId = post.author.userId,
                    subjectName = post.author.displayName,
                )
            }
        },
        // SAFETY-FR-001 lists a COMMENT among the five reportable things, and
        // the thread is the only surface a comment has.
        onReportComment = { comment ->
            safety = SafetyRequest(
                target = ReportTarget.COMMENT,
                targetId = comment.id,
                subjectUserId = comment.author.userId,
                subjectName = comment.author.displayName,
            )
        },
        onLoadMoreComments = vm::loadMoreComments,
        isUrdu = container.localeStore.stored()?.isRtl == true,
    )

    SafetySheets(
        container = container,
        request = safety,
        onDismiss = { safety = null },
        onChange = { safety = it },
    )
}

/**
 * UX-PROFILE-001 and UX-PROFILE-002 — one route composable for both.
 *
 * `userId == null` is the owner's own profile, reached as a TAB and with no back
 * stack entry behind it; anything else was pushed. That is the only difference
 * the navigation layer knows about — the screen decides what the action row
 * says, and the ViewModel decides which endpoint answers.
 */
@Composable
private fun ProfileRoute(
    container: AppContainer,
    navController: NavHostController,
    userId: String?,
    onBack: (() -> Unit)?,
) {
    val vm: ProfileViewModel = viewModel(
        // KEYED BY THE USER ID. Without a key, opening one profile from another
        // reuses the first one's ViewModel — `viewModel()` scopes to the
        // destination, and both profiles are the same destination pattern.
        key = userId ?: "me",
        factory = ProfileViewModel.Factory(
            profiles = container.profileRepository,
            relations = container.viewerRelations,
            userId = userId,
            viewerId = { container.sessionRepository.cachedUserId() },
        ),
    )
    val state by vm.state.collectAsState()
    val context = LocalContext.current

    val id = state.profile?.userId
    var safety by remember { mutableStateOf<SafetyRequest?>(null) }

    ProfileScreen(
        state = state,
        onBack = onBack,
        onRetry = vm::load,
        onRetryPosts = vm::retryPosts,
        onLoadMorePosts = vm::loadMorePosts,
        onToggleFollow = vm::toggleFollow,
        // MSG-FR-001 — BR-024 resolves the one conversation that exists for the
        // pair, so this asks the server rather than inventing an id. The route
        // has existed since group 12 with nothing calling it; this is the
        // profile entry point it was built for.
        onMessage = { id?.let { navController.navigate(Routes.conversationWith(it)) } },
        onEdit = { navController.navigate(Routes.EDIT_PROFILE) },
        onSettings = { navController.navigate(Routes.SETTINGS) },
        onOpenSaved = { navController.navigate(Routes.SAVED_POSTS) },
        // §14's "⋯ Report · Block". SAFETY-FR-002 reports the ACCOUNT rather
        // than one of its items, which is what somebody does when the pattern
        // is the problem; SAFETY-FR-005 lists a profile among the four places a
        // block can start.
        onMore = {
            id?.let {
                safety = SafetyRequest(
                    target = ReportTarget.PROFILE,
                    targetId = it,
                    subjectUserId = it,
                    subjectName = state.profile?.displayName,
                    step = SafetyStep.MENU,
                )
            }
        },
        onOpenFollowers = { id?.let { navController.navigate(Routes.followers(it)) } },
        onOpenFollowing = { id?.let { navController.navigate(Routes.following(it)) } },
        onOpenPost = { navController.navigate(Routes.post(it)) },
        onToggleLike = vm::toggleLike,
        onShare = { postId -> sharePost(context, postId) },
        onOpenMedia = { mediaIds, index ->
            navController.navigate(Routes.imageViewer(mediaIds, index))
        },
    )

    SafetySheets(
        container = container,
        request = safety,
        onDismiss = { safety = null },
        onChange = { safety = it },
    )
}

/**
 * The safety sheets, hosted for one screen — UX-SAFE-001 · 002 · 003.
 *
 * ONE COMPOSABLE, FIVE ENTRY POINTS. SAFETY-FR-001 puts reporting on a post, a
 * comment, an event, a profile and a conversation; SAFETY-FR-005 puts blocking
 * on four of the same places. Five copies of this wiring would be five chances
 * to get the acknowledgement subtly different, on the one flow where a
 * difference between two outcomes IS a disclosure.
 *
 * THE VIEWMODEL IS KEYED BY WHAT IS BEING REPORTED. `viewModel()` scopes to the
 * destination, and a post detail screen whose comments can each be reported
 * would otherwise hand the second comment the first one's half-finished sheet,
 * with a reason already chosen.
 *
 * EVERY SHEET HERE IS DISMISSIBLE BY TAPPING OUTSIDE. "Reporting is never a
 * trap", and that includes having opened the menu by accident.
 */
@Composable
private fun SafetySheets(
    container: AppContainer,
    request: SafetyRequest?,
    onDismiss: () -> Unit,
    onChange: (SafetyRequest) -> Unit,
) {
    if (request == null) return

    // The ⋯ menu decides nothing on its own; it chooses which of the two real
    // sheets opens next.
    if (request.step == SafetyStep.MENU) {
        SafetyMenuSheet(
            onDismiss = onDismiss,
            onReport = { onChange(request.copy(step = SafetyStep.REPORT)) },
            onBlock = { onChange(request.copy(step = SafetyStep.BLOCK)) },
        )
        return
    }

    val vm: ReportViewModel = viewModel(
        key = "safety-${request.target}-${request.targetId}",
        factory = ReportViewModel.Factory(
            safety = container.safetyRepository,
            target = request.target,
            targetId = request.targetId,
            subjectUserId = request.subjectUserId,
        ),
    )
    val state by vm.state.collectAsState()

    if (request.step == SafetyStep.BLOCK) {
        BlockConfirmSheet(
            displayName = request.subjectName,
            blocking = state.blocking,
            failed = state.blockFailed,
            onDismiss = onDismiss,
            onConfirm = { vm.block(onBlocked = onDismiss) },
        )
    } else {
        ReportSheet(
            state = state,
            onDismiss = onDismiss,
            onChooseReason = vm::chooseReason,
            onClearReason = vm::clearReason,
            onNoteChanged = vm::onNoteChanged,
            onSubmit = vm::submit,
            // Offered from the acknowledgement, and it closes the sheet on
            // success: the report is already sent, and the block is the second
            // half of a decision the reporter has taken.
            onBlock = { vm.block(onBlocked = onDismiss) },
        )
    }
}

/**
 * What a screen is asking the safety sheets to act on.
 *
 * `subjectUserId` is null where the target has no single person behind it —
 * there is no such thing as blocking an event — and that is what decides whether
 * the block is offered at all.
 */
private data class SafetyRequest(
    val target: ReportTarget,
    val targetId: String,
    val subjectUserId: String? = null,
    val subjectName: String? = null,
    val step: SafetyStep = SafetyStep.REPORT,
)

private enum class SafetyStep {
    /** §14's "⋯ Report · Block", where the person rather than an item is the subject. */
    MENU,
    REPORT,
    BLOCK,
}

/**
 * UX-SET-001 · UX-SET-002 — the settings index and the language switch.
 *
 * THE LANGUAGE CHANGE GOES THROUGH THE ACTIVITY, not through this graph.
 * `applyLanguage` writes the device's copy and calls `recreate()`, which
 * re-resolves every layout direction, string and configuration-dependent
 * resource in one step — and destroys this back stack along with everything
 * else, which is why the choice cannot be a destination that expects to be
 * popped.
 */
@Composable
private fun SettingsRoute(
    container: AppContainer,
    navController: NavHostController,
) {
    val vm: SettingsViewModel = viewModel(
        factory = SettingsViewModel.Factory(
            settings = container.settingsRepository,
            storedLocale = { container.localeStore.stored() },
            storeLocale = { container.localeStore.store(it) },
            // SET-FR-006's criterion is about what THIS device shows afterwards,
            // so the local clear is what satisfies it — see the ViewModel.
            signOutLocally = {
                container.clearSession()
            },
            signOutRemotely = { container.authRepository.logout() },
        ),
    )
    val state by vm.state.collectAsState()

    SettingsScreen(
        state = state,
        onBack = { navController.popBackStack() },
        onLanguage = { navController.navigate(Routes.SETTINGS_LANGUAGE) },
        onNotifications = { navController.navigate(Routes.NOTIFICATION_PREFERENCES) },
        onChangePassword = { navController.navigate(Routes.SETTINGS_PASSWORD) },
        onBlockedUsers = { navController.navigate(Routes.SETTINGS_BLOCKED) },
        onGuidelines = { navController.navigate(Routes.legal(Routes.LEGAL_GUIDELINES)) },
        onTerms = { navController.navigate(Routes.legal(Routes.LEGAL_TERMS)) },
        onHelp = { navController.navigate(Routes.SETTINGS_HELP) },
        onAbout = { navController.navigate(Routes.SETTINGS_ABOUT) },
        onDeleteAccount = { navController.navigate(Routes.DELETE_ACCOUNT) },
        onSignOut = {
            vm.signOut {
                // The whole graph goes, so Back cannot return to a signed-in
                // screen rendering cached content (SET-FR-006).
                navController.navigate(Routes.WELCOME) {
                    popUpTo(0) { inclusive = true }
                }
            }
        },
    )
}

/** UX-SET-002. */
@Composable
private fun LanguageSettingsRoute(
    container: AppContainer,
    onBack: () -> Unit,
) {
    val vm: SettingsViewModel = viewModel(
        factory = SettingsViewModel.Factory(
            settings = container.settingsRepository,
            storedLocale = { container.localeStore.stored() },
            storeLocale = { container.localeStore.store(it) },
            signOutLocally = {},
            signOutRemotely = { ApiResult.Ok(Unit) },
        ),
    )
    val state by vm.state.collectAsState()
    // Unwrapped from the context rather than taken from `LocalActivity`, which
    // arrives in a later activity-compose than the one pinned here.
    val activity = LocalContext.current.findMainActivity()

    LanguageSettingsScreen(
        current = state.effectiveLanguage,
        onBack = onBack,
        onChoose = { locale ->
            vm.chooseLanguage(locale)
            // One path for a language change, shared with first launch: the
            // activity stores it and recreates itself.
            activity?.applyLanguage(locale)
        },
    )
}

/**
 * UX-SET-009 — delete account.
 *
 * THE LOCAL CLEAR HAPPENS HERE AND NOT IN THE VIEWMODEL, because it is the same
 * clear the sign-out path performs and there should be one of it: the session
 * store and the session-scoped relationship cache both belong to an account, and
 * the account has just stopped existing.
 */
@Composable
private fun DeleteAccountRoute(
    container: AppContainer,
    onBack: () -> Unit,
    onDeleted: () -> Unit,
) {
    val vm: DeleteAccountViewModel = viewModel(
        factory = DeleteAccountViewModel.Factory(container.settingsRepository),
    )
    val state by vm.state.collectAsState()

    DeleteAccountScreen(
        state = state,
        onBack = onBack,
        onPasswordChanged = vm::onPasswordChanged,
        onDelete = {
            vm.submit {
                container.clearSession()
                onDeleted()
            }
        },
        onRetryLoad = vm::loadConsequences,
    )
}

/** UX-SET-004. */
@Composable
private fun ChangePasswordRoute(
    container: AppContainer,
    onBack: () -> Unit,
) {
    val vm: ChangePasswordViewModel = viewModel(
        factory = ChangePasswordViewModel.Factory(container.settingsRepository),
    )
    val state by vm.state.collectAsState()

    ChangePasswordScreen(
        state = state,
        onBack = onBack,
        onCurrentChanged = vm::onCurrentChanged,
        onNewChanged = vm::onNewChanged,
        onConfirmChanged = vm::onConfirmChanged,
        // The other sessions are already gone by the time this returns; there is
        // nothing further to show, so the screen leaves.
        onSubmit = { vm.submit(onChanged = onBack) },
    )
}

/** UX-SET-005. */
@Composable
private fun BlockedUsersRoute(
    container: AppContainer,
    onBack: () -> Unit,
) {
    val vm: BlockedUsersViewModel = viewModel(
        factory = BlockedUsersViewModel.Factory(container.settingsRepository),
    )
    val state by vm.state.collectAsState()

    BlockedUsersScreen(
        state = state,
        onBack = onBack,
        onUnblock = vm::unblock,
        onRetry = vm::refresh,
        onLoadMore = vm::loadMore,
        // The reader's own locale and zone, from the container as everywhere
        // else that formats a date — the app's CHOSEN language rather than the
        // device configuration, because those differ the moment somebody picks
        // Urdu on an English phone.
        locale = container.formattingLocale(),
        zone = container.displayZone(),
    )
}

/** UX-PROFILE-003 — edit own profile. */
@Composable
private fun EditProfileRoute(
    container: AppContainer,
    onBack: () -> Unit,
) {
    val vm: EditProfileViewModel = viewModel(
        factory = EditProfileViewModel.Factory(
            profiles = container.profileRepository,
            uploader = container.imageUploader,
        ),
    )
    val state by vm.state.collectAsState()
    val scope = rememberCoroutineScope()

    // The picker launcher must be registered against THIS destination's
    // lifecycle, which is why it lives here and not in the ViewModel — the same
    // split the composer uses.
    val pickPhoto = rememberImagePickerLauncher(remaining = 1) { uris ->
        val uri = uris.firstOrNull() ?: return@rememberImagePickerLauncher
        scope.launch {
            val picked = container.imagePicker.read(uri)
            if (picked != null) {
                vm.onPhotoSelected(picked.bytes)
            } else {
                // Unreadable, or no quality step reached the 500KB ceiling.
                // Reported as a rejection rather than a failure: retrying the
                // same file cannot help, so the screen asks for another.
                vm.onPhotoUnusable()
            }
        }
    }

    EditProfileScreen(
        state = state,
        onBack = onBack,
        onDisplayNameChanged = vm::onDisplayNameChanged,
        onCityChanged = vm::onCityChanged,
        onBioChanged = vm::onBioChanged,
        onPickPhoto = pickPhoto,
        onRetryPhoto = vm::retryPhotoUpload,
        onRemovePhoto = vm::removePhoto,
        onSave = { vm.save(onSaved = onBack) },
        onRetryLoad = vm::load,
    )
}

/** UX-PROFILE-004 · UX-PROFILE-005 — followers and following. */
@Composable
private fun UserListRoute(
    container: AppContainer,
    navController: NavHostController,
    userId: String?,
    kind: UserListKind,
) {
    if (userId == null) {
        ContentUnavailable()
        return
    }

    val vm: UserListViewModel = viewModel(
        key = "$kind-$userId",
        factory = UserListViewModel.Factory(
            profiles = container.profileRepository,
            relations = container.viewerRelations,
            userId = userId,
            kind = kind,
            viewerId = { container.sessionRepository.cachedUserId() },
        ),
    )
    val state by vm.state.collectAsState()

    UserListScreen(
        state = state,
        onBack = { navController.popBackStack() },
        onOpenUser = { navController.navigate(Routes.profile(it)) },
        onRetry = vm::refresh,
        onLoadMore = vm::loadMore,
    )
}

/** UX-PROFILE-006 — the private saved collection. */
@Composable
private fun SavedPostsRoute(
    container: AppContainer,
    navController: NavHostController,
    onBack: () -> Unit,
) {
    val vm: SavedPostsViewModel = viewModel(
        factory = SavedPostsViewModel.Factory(
            profiles = container.profileRepository,
            relations = container.viewerRelations,
        ),
    )
    val state by vm.state.collectAsState()
    val context = LocalContext.current

    SavedPostsScreen(
        state = state,
        onBack = onBack,
        onOpenPost = { navController.navigate(Routes.post(it)) },
        onOpenAuthor = { navController.navigate(Routes.profile(it)) },
        onToggleLike = vm::toggleLike,
        onShare = { postId -> sharePost(context, postId) },
        onOpenMedia = { mediaIds, index ->
            navController.navigate(Routes.imageViewer(mediaIds, index))
        },
        onUnsave = vm::unsave,
        onRetry = vm::refresh,
        onLoadMore = vm::loadMore,
    )
}

/**
 * UX-HOME-007 — the notification centre.
 *
 * THE DESTINATION MAPPING LIVES HERE and nowhere else. The feature returns a
 * [NotificationDestination] rather than a route string, so this `when` is
 * exhaustive: a destination added to that sealed type is a compile error in the
 * one file that knows what routes exist, instead of a string that silently
 * matches nothing.
 *
 * LEAVING MARKS WHAT WAS SEEN. `DisposableEffect` rather than a back callback,
 * because there are three ways off this screen — the header, the system back
 * gesture, and tapping a row — and only disposal catches all three.
 */
@Composable
private fun NotificationsRoute(
    container: AppContainer,
    navController: NavHostController,
    onBack: () -> Unit,
) {
    val vm: NotificationsViewModel = viewModel(
        factory = NotificationsViewModel.Factory(
            notifications = container.notificationRepository,
            locale = { container.localeStore.stored()?.tag ?: "en" },
            profiles = container.publicProfile,
        ),
    )
    val state by vm.state.collectAsState()

    DisposableEffect(Unit) {
        onDispose { vm.onLeave() }
    }

    NotificationsScreen(
        state = state,
        sections = vm.sections(),
        onBack = onBack,
        onOpen = { notification ->
            when (val destination = vm.open(notification)) {
                is NotificationDestination.Post ->
                    navController.navigate(Routes.post(destination.postId))

                is NotificationDestination.Event ->
                    navController.navigate(Routes.event(destination.eventId))

                is NotificationDestination.Conversation ->
                    navController.navigate(Routes.conversation(destination.conversationId))

                is NotificationDestination.Profile ->
                    navController.navigate(Routes.profile(destination.userId))

                // The row is not clickable in this case, so this is
                // unreachable — listed so that adding a destination fails to
                // compile here rather than falling through to nothing.
                NotificationDestination.None -> Unit
            }
        },
        onRetry = vm::refresh,
        onLoadMore = vm::loadMore,
        onFindPeople = { navController.navigate(Routes.SEARCH) },
    )
}

/** UX-SET-003 — push preferences. */
@Composable
private fun NotificationPreferencesRoute(
    container: AppContainer,
    onBack: () -> Unit,
) {
    val vm: NotificationPreferencesViewModel = viewModel(
        factory = NotificationPreferencesViewModel.Factory(container.notificationRepository),
    )
    val state by vm.state.collectAsState()

    NotificationPreferencesScreen(
        state = state,
        onBack = onBack,
        onToggle = vm::toggle,
        onRetry = vm::load,
    )
}

/**
 * UX-MSG-001 · UX-MSG-002 — the inbox and the request list.
 *
 * The shell's Messages badge is fed from ACCEPTED conversations only. BR-027 and
 * §14: requests "are counted separately inside the screen and never contribute
 * to this badge — a stranger must not be able to make the user's navigation
 * demand attention."
 */
@Composable
private fun InboxRoute(
    container: AppContainer,
    onOpenConversation: (String) -> Unit,
    onFindPeople: () -> Unit,
) {
    val vm: InboxViewModel = viewModel(
        factory = InboxViewModel.Factory(
            messaging = container.messagingRepository,
            profiles = container.publicProfile,
        ),
    )
    val state by vm.state.collectAsState()

    InboxScreen(
        state = state,
        // The real viewer, the same source every other screen uses.
        viewerId = container.sessionRepository.cachedUserId(),
        onSelectTab = vm::selectTab,
        onOpenConversation = { onOpenConversation(it.conversationId) },
        onAccept = vm::accept,
        onDecline = vm::decline,
        onRefresh = vm::refresh,
        onLoadMore = vm::loadMore,
        onFindPeople = onFindPeople,
    )
}

/** UX-MSG-003 — one conversation. */
@Composable
private fun ConversationRoute(
    container: AppContainer,
    conversationId: String,
    onBack: () -> Unit,
    onOpenProfile: (String) -> Unit,
) {
    val vm: ConversationViewModel = viewModel(
        factory = ConversationViewModel.Factory(
            messaging = container.messagingRepository,
            conversationId = conversationId,
            viewerId = { container.sessionRepository.cachedUserId() },
            profiles = container.publicProfile,
            // Arriving by deep link, none of these is known yet. The history
            // call is what fills them in, and until then the header carries no
            // name and the thread renders as an ordinary conversation — which
            // is the permissive direction, and the safe one: treating an
            // unknown thread as a request would hide a conversation the reader
            // is actually having.
            otherUserId = null,
            requestState = RequestState.NONE,
            readOnly = false,
        ),
    )
    val state by vm.state.collectAsState()
    var safety by remember { mutableStateOf<SafetyRequest?>(null) }

    ConversationScreen(
        state = state,
        onBack = onBack,
        onRetryLoad = vm::loadHistory,
        onDraftChanged = vm::onDraftChanged,
        onSend = vm::send,
        onRetryMessage = vm::retry,
        onLoadOlder = vm::loadOlder,
        onAccept = vm::accept,
        onDecline = { vm.decline(onDeclined = onBack) },
        onOpenProfile = onOpenProfile,
        // §14's "⋯ Report · Block" again. MSG-FR-007 makes a conversation
        // reportable as a whole, and a conversation ALWAYS has a person behind
        // it — so unlike an event, both options are real here.
        onReport = {
            state.otherUserId?.let { userId ->
                safety = SafetyRequest(
                    target = ReportTarget.CONVERSATION,
                    targetId = conversationId,
                    subjectUserId = userId,
                    subjectName = state.otherUser?.displayName,
                    step = SafetyStep.MENU,
                )
            }
        },
        onStartPolling = vm::startPolling,
        onStopPolling = vm::stopPolling,
        isUrdu = container.localeStore.stored()?.isRtl == true,
    )

    SafetySheets(
        container = container,
        request = safety,
        onDismiss = { safety = null },
        onChange = { safety = it },
    )
}

/**
 * MSG-FR-001 — resolve the conversation for a pair, then go to it.
 *
 * BR-024 says one conversation exists per pair FOREVER, so `POST /conversations`
 * RESOLVES rather than creates and calling it twice returns the same thread.
 * This screen exists only for the moment that call is in flight; it is popped
 * from the back stack as soon as it succeeds, so Back from the conversation
 * returns to the profile rather than to a spinner that resolves forward again.
 */
@Composable
private fun OpenConversationRoute(
    container: AppContainer,
    userId: String,
    onOpened: (String) -> Unit,
    onFailed: () -> Unit,
) {
    var failure by remember { mutableStateOf<ApiFailure?>(null) }

    LaunchedEffect(userId) {
        when (val result = container.messagingRepository.open(userId)) {
            is ApiResult.Ok -> onOpened(result.value.conversationId)
            // Blocked either way, self, banned, deleted, or no such person —
            // one neutral answer (BR-025), and the screen goes back rather than
            // explaining which.
            is ApiResult.Err -> failure = result.failure
        }
    }

    if (failure == null) {
        LoadingState()
    } else {
        ContentUnavailable()
        LaunchedEffect(failure) { onFailed() }
    }
}

/** UX-SEARCH-001 · UX-SEARCH-002 · UX-SEARCH-003 — one screen, three surfaces. */
@Composable
private fun SearchRoute(
    container: AppContainer,
    onBack: () -> Unit,
    onOpenPerson: (String) -> Unit,
    onOpenPost: (String) -> Unit,
    onOpenEvent: (String) -> Unit,
) {
    val vm: SearchViewModel = viewModel(
        factory = SearchViewModel.Factory(
            source = container.searchRepository,
            // PRIV-011 — on the device only. There is no endpoint for this and
            // there must not be one.
            recents = container.recentSearches,
        ),
    )
    val state by vm.state.collectAsState()

    SearchScreen(
        state = state,
        locale = container.formattingLocale(),
        zone = container.displayZone(),
        onQueryChanged = vm::onQueryChanged,
        onSubmit = { vm.submit() },
        onSelectTab = vm::selectTab,
        onLoadMore = vm::loadMore,
        onRetry = vm::retry,
        onPickRecent = { vm.submit(it) },
        onRemoveRecent = vm::removeRecent,
        onClearRecents = vm::clearRecents,
        onOpenPerson = onOpenPerson,
        onOpenPost = onOpenPost,
        onOpenEvent = onOpenEvent,
        onBack = onBack,
        isUrdu = container.localeStore.stored()?.isRtl == true,
    )
}

/**
 * ENGAGE-FR-007 — share a post through the device share sheet.
 *
 * "Producing a link to the post plus a short excerpt", and the SRS calls this
 * "the platform's primary growth channel, because WhatsApp is how Pakistan
 * shares".
 *
 * THE LINK REQUIRES LOGIN TO OPEN, which is the requirement's own rule and
 * follows from the no-guest-browsing decision: "GIVEN a shared link opened by
 * someone not logged in, WHEN it loads, THEN they are prompted to log in or
 * install rather than shown the content." That is a property of the receiving
 * end — the deep link lands on the post route, which sits behind the startup
 * resolver, so an unauthenticated arrival is routed to Welcome by the same rule
 * that governs every other cold start. Nothing extra is needed here.
 *
 * NO EXCERPT IS ATTACHED YET, and that is deliberate rather than forgotten. An
 * excerpt means quoting somebody's words into a WhatsApp message, and the
 * canonical share URL is the one the deep-link work in group 22 defines — a
 * placeholder host here would put a broken link into a chat somebody cannot
 * edit. So the sheet shares the app's own post URL and nothing else until then;
 * recorded in `20-mobile-open-issues.md`.
 */
/**
 * SET-FR-009 — hand the support address to a mail app.
 *
 * `ACTION_SENDTO` with a `mailto:` URI rather than `ACTION_SEND`, so the chooser
 * offers MAIL clients only. `ACTION_SEND` with `text/plain` would also offer
 * every messaging app on the device, and somebody trying to appeal a suspension
 * does not need their support request going to WhatsApp.
 *
 * A device with no mail client does NOTHING rather than crashing. The address is
 * on screen and can be copied, which is the honest fallback.
 */
/**
 * The hosting activity, unwrapped.
 *
 * A language change is the activity's to perform — it stores the choice and
 * calls `recreate()`, which is the platform's own mechanism for re-resolving
 * every direction-dependent resource at once. Compose hands out a context, and
 * under a themed wrapper that context is not the activity, so this walks the
 * chain rather than casting once and hoping.
 */
private tailrec fun android.content.Context.findMainActivity(): MainActivity? = when (this) {
    is MainActivity -> this
    is android.content.ContextWrapper -> baseContext.findMainActivity()
    else -> null
}

private fun sendSupportEmail(context: android.content.Context, address: String) {
    val intent = android.content.Intent(
        android.content.Intent.ACTION_SENDTO,
        android.net.Uri.parse("mailto:$address"),
    ).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)

    runCatching { context.startActivity(intent) }
}

private fun sharePost(context: android.content.Context, postId: String) {
    val intent = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(android.content.Intent.EXTRA_TEXT, shareUrl(postId))
        putExtra(
            android.content.Intent.EXTRA_SUBJECT,
            context.getString(org.shehersaaz.mohalla.R.string.share_post_subject),
        )
    }

    // `createChooser` rather than the bare intent: without it, Android may
    // remember a default target and send the next share straight there, which
    // is wrong for a control whose whole purpose is choosing where to send.
    val chooser = android.content.Intent.createChooser(
        intent,
        context.getString(org.shehersaaz.mohalla.R.string.share_post_title),
    ).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)

    // A device with nothing that handles text/plain. Caught rather than allowed
    // to crash a share — the failure is that nothing happens, which is the
    // truth of the situation.
    runCatching { context.startActivity(chooser) }
}

/**
 * The host a shared link points at.
 *
 * A PLACEHOLDER, and it must not become a real host by accident. §42's deep
 * links and the canonical public URL are group 22's work; until then this is a
 * value that will fail visibly rather than a domain somebody might register.
 */
/**
 * The public URL for a post (ENGAGE-FR-007 · §42).
 *
 * ONE SOURCE FOR THE HOST, shared with the manifest's intent filter through the
 * build config — a share pointing at a host the filter does not claim is a link
 * that opens the browser instead of the app, and the two drifting apart is the
 * ordinary way that happens.
 *
 * `mohalla.invalid` UNTIL DEP-007 PROVISIONS A DOMAIN. RFC 2606 reserves
 * `.invalid` so it can never resolve, which is the point: a link that fails
 * visibly is better than one pointing at a plausible name somebody else
 * registered. GAP-M-007 tracks the excerpt this link still does not carry.
 */
private fun shareUrl(postId: String): String {
    val host = BuildEnvironment.appHost.takeIf { it.isNotBlank() } ?: SHARE_FALLBACK_HOST
    // `DeepLinks.postUrl`, NOT `Routes.post`. The internal route is `post/{id}`
    // and the public path is `/posts/{id}`; building the share link from the
    // route produced a URL that matched no intent filter and no server link, so
    // every shared post opened a browser instead of the app.
    return DeepLinks.postUrl(host, postId)
}

/** Reserved by RFC 2606, so it cannot resolve. See [shareUrl]. */
private const val SHARE_FALLBACK_HOST = "mohalla.invalid"

/** UX-EVENT-001 · UX-EVENT-002 — the Events tab. */
@Composable
private fun EventsRoute(
    container: AppContainer,
    onOpenEvent: (String) -> Unit,
    onCreateEvent: () -> Unit,
) {
    val vm: EventsViewModel = viewModel(
        factory = EventsViewModel.Factory(
            events = container.eventRepository,
            viewerId = { container.sessionRepository.cachedUserId() },
        ),
    )
    val state by vm.state.collectAsState()

    EventsScreen(
        state = state,
        locale = container.formattingLocale(),
        zone = container.displayZone(),
        onSelectTab = vm::selectTab,
        onRefresh = vm::refresh,
        onLoadMore = vm::loadMore,
        onOpenEvent = onOpenEvent,
        onRespond = vm::respond,
        onCreateEvent = onCreateEvent,
    )
}

/**
 * UX-EVENT-003 — the detail screen, and the one place a meeting link is handled.
 *
 * BR-045: the platform hosts no video, so a join hands the URL to the system and
 * lets another app open it. The URL is consumed here and immediately cleared
 * from state — see `EventDetailViewModel.onJoinHandled`.
 */
@Composable
private fun EventDetailRoute(
    container: AppContainer,
    eventId: String,
    onBack: () -> Unit,
    onEdit: () -> Unit,
    onOpenCreator: (String) -> Unit,
) {
    val vm: EventDetailViewModel = viewModel(
        factory = EventDetailViewModel.Factory(
            events = container.eventRepository,
            eventId = eventId,
            viewerId = { container.sessionRepository.cachedUserId() },
        ),
    )
    val state by vm.state.collectAsState()
    var safety by remember { mutableStateOf<SafetyRequest?>(null) }
    val context = LocalContext.current

    // The join outcome is a one-shot, so it is handled in an effect and cleared.
    // Leaving it in state would relaunch the browser on the next recomposition.
    LaunchedEffect(state.joinOutcome) {
        val outcome = state.joinOutcome
        if (outcome is JoinOutcome.Open) {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(outcome.meetingUrl))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try {
                context.startActivity(intent)
                vm.onJoinHandled()
            } catch (e: ActivityNotFoundException) {
                // EVENT-FR-003's stated error case: "no browser or meeting app
                // installed". Caught rather than allowed to crash, and reported
                // so the screen can offer the link to copy instead.
                vm.onNoAppToOpenLink(outcome.meetingUrl)
            }
        }
    }

    EventDetailScreen(
        state = state,
        locale = container.formattingLocale(),
        zone = container.displayZone(),
        onBack = onBack,
        onRetry = vm::load,
        onRespond = vm::respond,
        onJoin = vm::join,
        onOpenCreator = onOpenCreator,
        onEdit = onEdit,
        // The report sheet is UX-SAFE-001, which arrives with group 17.
        onReport = {
            state.event?.let { event ->
                safety = SafetyRequest(
                    target = ReportTarget.EVENT,
                    targetId = event.id,
                    // An event is not a person: SAFETY-FR-005 offers no block
                    // here, and the sheet omits the offer when there is nobody
                    // behind the target.
                    subjectUserId = null,
                )
            }
        },
    )

    SafetySheets(
        container = container,
        request = safety,
        onDismiss = { safety = null },
        onChange = { safety = it },
    )
}

/** UX-EVENT-004 (create) and UX-EVENT-005 (edit). */
@Composable
private fun EventComposerRoute(
    container: AppContainer,
    editingEventId: String?,
    onDone: () -> Unit,
    onDeleted: () -> Unit = onDone,
) {
    val vm: EventComposerViewModel = viewModel(
        factory = EventComposerViewModel.Factory(
            events = container.eventRepository,
            editingEventId = editingEventId,
        ),
    )
    val state by vm.state.collectAsState()

    var pickingDateTime by remember { mutableStateOf(false) }

    if (pickingDateTime) {
        MohallaDateTimePicker(
            initialEpochMillis = state.startsAtMillis,
            zone = container.displayZone(),
            onDismiss = { pickingDateTime = false },
            onPicked = { millis ->
                pickingDateTime = false
                vm.onStartsAtChanged(millis)
            },
        )
    }

    EventComposerScreen(
        state = state,
        locale = container.formattingLocale(),
        zone = container.displayZone(),
        onTitleChanged = vm::onTitleChanged,
        onDescriptionChanged = vm::onDescriptionChanged,
        onPickStartsAt = { pickingDateTime = true },
        onTypeChanged = vm::onTypeChanged,
        onMeetingUrlChanged = vm::onMeetingUrlChanged,
        onLocationChanged = vm::onLocationChanged,
        onSubmit = vm::submit,
        onCancelEvent = vm::cancel,
        onBack = onDone,
        onSaved = onDone,
        onCancelled = { outcome -> if (outcome.deleted) onDeleted() else onDone() },
    )
}

/** Welcome → phone → date of birth → password → terms → OTP. */
private fun NavGraphBuilder.authGraph(
    navController: NavHostController,
    container: AppContainer,
) {
    composable(Routes.WELCOME) {
        WelcomeScreen(
            onCreateAccount = { navController.navigate(Routes.REGISTER_GRAPH) },
            onLogIn = { navController.navigate(Routes.LOGIN) },
        )
    }

    composable(Routes.LOGIN) {
        val vm: LoginViewModel =
            viewModel(
                factory = LoginViewModel.Factory(
                    auth = container.authRepository,
                    sessions = container.sessionRepository,
                ),
            )
        val state by vm.state.collectAsState()

        LoginScreen(
            state = state,
            onPhoneChanged = vm::onPhoneChanged,
            onPasswordChanged = vm::onPasswordChanged,
            onSubmit = vm::submit,
            onForgotPassword = { navController.navigate(Routes.FORGOT_PASSWORD) },
            // ONBOARDING IS CHECKED, NOT ASSUMED (RUNTIME-007).
            //
            // This was `toShell()`, unconditionally, so an account that was
            // ACTIVE but still owed a username or a profile logged in and
            // landed on Home with no handle and no display name. The
            // ViewModel now resolves the destination through the same
            // `destinationForSession` the splash uses, and this sends the
            // reader wherever that says.
            //
            // The capability is still not branched on here: a suspended
            // account signs in and lands on Home with the banner (BR-034), and
            // the shell reads the capability itself, which keeps one source of
            // truth.
            onAuthenticated = {
                val route = state.destination?.startRoute() ?: Routes.SHELL
                if (route == Routes.SHELL) {
                    navController.toShell()
                } else {
                    navController.navigate(route) {
                        // The auth graph must not stay under an onboarding
                        // step: Back from the username screen belongs nowhere
                        // near a password field.
                        popUpTo(Routes.WELCOME) { inclusive = true }
                    }
                }
            },
            onVerificationRequired = { navController.navigate(Routes.OTP) },
        )
    }

    // ONE ViewModel across five screens, scoped to the register GRAPH rather
    // than to each destination. `viewModel()` called inside a `composable`
    // block is scoped to that destination's back-stack entry, so four calls
    // would build four ViewModels and the phone number entered on step one
    // would be gone by step four. `registerViewModel` resolves the graph's
    // entry instead, which is the only owner all five steps share.
    navigation(startDestination = Routes.REGISTER_PHONE, route = Routes.REGISTER_GRAPH) {
        composable(Routes.REGISTER_PHONE) { entry ->
            val vm = registerViewModel(navController, entry, container)
        val state by vm.state.collectAsState()

        RegisterPhoneScreen(
            state = state,
            onPhoneChanged = vm::onPhoneChanged,
            onAccountTypeChanged = vm::onAccountTypeChanged,
            onContinue = { if (vm.phoneStepValid) navController.navigate(Routes.REGISTER_DOB) },
            onBack = { navController.popBackStack() },
        )
    }

    composable(Routes.REGISTER_DOB) { entry ->
        val vm = registerViewModel(navController, entry, container)
        val state by vm.state.collectAsState()

        RegisterDateOfBirthScreen(
            state = state,
            onDateTyped = vm::onDateOfBirthTyped,
            onContinue = { navController.navigate(Routes.REGISTER_PASSWORD) },
            onBack = { navController.popBackStack() },
        )
    }

    composable(Routes.REGISTER_PASSWORD) { entry ->
        val vm = registerViewModel(navController, entry, container)
        val state by vm.state.collectAsState()

        RegisterPasswordScreen(
            state = state,
            onPasswordChanged = vm::onPasswordChanged,
            onContinue = { if (vm.passwordStepValid) navController.navigate(Routes.TERMS) },
            onBack = { navController.popBackStack() },
        )
    }

    composable(Routes.TERMS) { entry ->
        val vm = registerViewModel(navController, entry, container)
        val state by vm.state.collectAsState()

        RegisterTermsScreen(
            state = state,
            onAcceptedChanged = vm::onTermsAcceptedChanged,
            // OD-015: the documents do not exist yet. Nothing opens a browser
            // at a URL that would 404, and nothing ships placeholder legal
            // text — accepting terms that are not written is worse than a
            // control that does nothing yet.
            onOpenTerms = {},
            onOpenGuidelines = {},
            onSubmit = vm::submit,
            onRegistered = { navController.navigate(Routes.OTP) },
            onBack = { navController.popBackStack() },
        )
    }

    composable(Routes.OTP) { entry ->
        // The number comes from the graph-scoped register ViewModel, so this
        // screen shows the same masked number the user typed rather than
        // asking for it again.
        val register = registerViewModel(navController, entry, container)
        val vm: OtpViewModel = viewModel(
            factory = OtpViewModel.Factory(
                auth = container.authRepository,
                e164Phone = register.normalisedPhone().orEmpty(),
                purpose = OtpPurpose.REGISTRATION,
            ),
        )
        val state by vm.state.collectAsState()

        OtpScreen(
            state = state,
            onCodeChanged = vm::onCodeChanged,
            onResend = vm::resend,
            // Verified, so onboarding continues at the username step.
            onVerified = { navController.navigate(Routes.USERNAME) },
        )
    }
    }

    composable(Routes.FORGOT_PASSWORD) {
        val vm: PasswordResetViewModel =
            viewModel(factory = PasswordResetViewModel.Factory(container.authRepository))
        val state by vm.state.collectAsState()

        ForgotPasswordScreen(
            state = state,
            onPhoneChanged = vm::onPhoneChanged,
            onSubmit = vm::requestCode,
            onBack = { navController.popBackStack() },
            onCodeRequested = { navController.navigate(Routes.RESET_PASSWORD) },
        )
    }

    composable(Routes.RESET_PASSWORD) {
        val vm: PasswordResetViewModel =
            viewModel(factory = PasswordResetViewModel.Factory(container.authRepository))
        val state by vm.state.collectAsState()

        ResetPasswordScreen(
            state = state,
            onCodeChanged = vm::onCodeChanged,
            onNewPasswordChanged = vm::onNewPasswordChanged,
            onSubmit = vm::submitReset,
            onBack = { navController.popBackStack() },
            // Straight to Login, and the whole reset flow is popped: returning
            // Back into a reset form whose code has been spent would offer a
            // retry that cannot succeed.
            onComplete = {
                navController.navigate(Routes.LOGIN) {
                    popUpTo(Routes.FORGOT_PASSWORD) { inclusive = true }
                }
            },
        )
    }

    composable(Routes.RESTORE_ACCOUNT) {
        val vm: RestoreAccountViewModel =
            viewModel(factory = RestoreAccountViewModel.Factory(
                    auth = container.authRepository,
                    deletion = container.settingsRepository,
                    formatDate = container.formatDate,
                ))
        val state by vm.state.collectAsState()

        RestoreAccountScreen(
            state = state,
            onRestore = vm::restore,
            onSignOut = {
                vm.signOut()
                navController.navigate(Routes.WELCOME) {
                    popUpTo(Routes.RESTORE_ACCOUNT) { inclusive = true }
                }
            },
            onRestored = { navController.toShell() },
        )
    }
}

/** Username → profile → suggested accounts. */
private fun NavGraphBuilder.setupGraph(
    navController: NavHostController,
    container: AppContainer,
) {
    composable(Routes.USERNAME) {
        val vm: UsernameViewModel =
            viewModel(factory = UsernameViewModel.Factory(container.setupRepository))
        val state by vm.state.collectAsState()

        UsernameScreen(
            state = state,
            onUsernameChanged = vm::onUsernameChanged,
            onSubmit = vm::claim,
            onClaimed = { navController.navigate(Routes.PROFILE_SETUP) },
        )
    }

    composable(Routes.PROFILE_SETUP) {
        val vm: ProfileSetupViewModel = viewModel(
            factory = ProfileSetupViewModel.Factory(
                setup = container.setupRepository,
                uploader = container.imageUploader,
            ),
        )
        val state by vm.state.collectAsState()
        val scope = rememberCoroutineScope()

        // PROFILE-FR-002's optional photo, now real. One image, so the single
        // picker contract — and the bytes are read and compressed off the main
        // thread before the ViewModel sees them, which is why this needs a
        // scope rather than calling straight through.
        val pickPhoto = rememberImagePickerLauncher(remaining = 1) { uris ->
            val uri = uris.firstOrNull() ?: return@rememberImagePickerLauncher
            scope.launch {
                val picked = container.imagePicker.read(uri)
                if (picked != null) {
                    vm.onPhotoSelected(picked.bytes)
                } else {
                    // Unreadable, or no quality step reached the 500KB ceiling.
                    // Reported as a rejection rather than a failure: retrying
                    // the same file cannot help, so the screen asks for another.
                    vm.onPhotoUnusable()
                }
            }
        }

        ProfileSetupScreen(
            state = state,
            onDisplayNameChanged = vm::onDisplayNameChanged,
            onCityChanged = vm::onCityChanged,
            onBioChanged = vm::onBioChanged,
            onPickPhoto = pickPhoto,
            onRetryPhoto = vm::retryPhotoUpload,
            onRemovePhoto = vm::removePhoto,
            onSubmit = vm::submit,
            onCreated = { navController.navigate(Routes.SUGGESTED) },
        )
    }

    composable(Routes.SUGGESTED) {
        val vm: SuggestionsViewModel =
            viewModel(factory = SuggestionsViewModel.Factory(container.setupRepository))
        val state by vm.state.collectAsState()

        SuggestedAccountsScreen(
            state = state,
            onToggleFollow = vm::toggleFollow,
            onContinue = { navController.toShell() },
            // SOCIAL-FR-005 — skipping is free and lands in the same place.
            onSkip = { navController.toShell() },
        )
    }
}

/**
 * The register ViewModel, owned by the register graph.
 *
 * `getBackStackEntry(REGISTER_GRAPH)` is the shared owner: every step inside
 * the graph resolves the same entry, so they get the same instance and the
 * same `SavedStateHandle` — which is what makes the phone number survive both
 * a language change and process death.
 */
@Composable
private fun registerViewModel(
    navController: NavHostController,
    entry: NavBackStackEntry,
    container: AppContainer,
): RegisterViewModel {
    // Keyed on the DESTINATION'S OWN entry, not on the controller. The
    // controller is stable for the whole app, so remembering against it would
    // cache the graph entry from whichever step composed first and hand a stale
    // ViewModelStoreOwner to the rest — a destroyed store after the graph is
    // popped and re-entered. The destination's entry changes whenever the stack
    // does, which is exactly when the lookup must run again. (This is what
    // lint's UnrememberedGetBackStackEntry check is for.)
    val owner = remember(entry) {
        navController.getBackStackEntry(Routes.REGISTER_GRAPH)
    }
    return viewModel(
        viewModelStoreOwner = owner,
        factory = RegisterViewModel.Factory(
            auth = container.authRepository,
            termsVersion = container.termsVersion,
        ),
    )
}

/**
 * Enter the shell and discard everything behind it.
 *
 * `popUpTo(0)` clears the whole stack rather than popping to a named route,
 * because the caller can be any of five screens — login, terms, OTP, suggested
 * accounts or restore — and naming one would leave the others behind. §12: Back
 * on Home leaves the app.
 */
private fun NavHostController.toShell() {
    navigate(Routes.SHELL) {
        popUpTo(0) { inclusive = true }
        launchSingleTop = true
    }
}
