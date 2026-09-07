package org.shehersaaz.mohalla.navigation

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.navigation
import androidx.navigation.compose.rememberNavController
import kotlinx.coroutines.launch
import org.shehersaaz.mohalla.core.di.AppContainer
import org.shehersaaz.mohalla.core.media.rememberImagePickerLauncher
import org.shehersaaz.mohalla.core.ui.ContentUnavailable
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
import org.shehersaaz.mohalla.feature.post.ImageViewerScreen
import org.shehersaaz.mohalla.feature.post.PostDetailScreen
import org.shehersaaz.mohalla.feature.post.PostDetailViewModel
import org.shehersaaz.mohalla.feature.safety.SuspensionExplainerSheet
import org.shehersaaz.mohalla.feature.setup.ProfileSetupScreen
import org.shehersaaz.mohalla.feature.setup.ProfileSetupViewModel
import org.shehersaaz.mohalla.feature.setup.SuggestedAccountsScreen
import org.shehersaaz.mohalla.feature.setup.SuggestionsViewModel
import org.shehersaaz.mohalla.feature.setup.UsernameScreen
import org.shehersaaz.mohalla.feature.setup.UsernameViewModel

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

        // Deep-linkable content (§42). The screens themselves arrive with their
        // own groups; until then each route renders the neutral unavailable
        // state rather than a stub that would claim the content is missing —
        // UX-STATE-001 is the one state that is honest about "not available
        // here", and it says nothing about why.
        composable(Routes.PROFILE_PATTERN) { ContentUnavailable() }
        composable(Routes.CONVERSATION_PATTERN) { ContentUnavailable() }
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
            formatUntil = container.formatDate,
        ),
    )
    val state by shell.state.collectAsState()

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
            )

            MohallaTab.EVENTS -> EventsRoute(
                container = container,
                onOpenEvent = { navController.navigate(Routes.event(it)) },
                onCreateEvent = { navController.navigate(Routes.EVENT_CREATE) },
            )

            // Not yet built. The shell renders and mirrors correctly with any
            // tab selected, which is what lets §36's both-directions check run
            // on the chrome before these screens exist.
            MohallaTab.MESSAGES,
            MohallaTab.PROFILE,
            -> ContentUnavailable()

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

    HomeScreen(
        state = state,
        onSelectTab = feed::selectTab,
        onRefresh = feed::refresh,
        onLoadMore = feed::loadMore,
        onOpenPost = onOpenPost,
        onOpenAuthor = { navController.navigate(Routes.profile(it)) },
        onToggleLike = feed::toggleLike,
        onShare = { postId -> sharePost(context, postId) },
        // The announcement detail is UX-HOME-006, and search is group 11.
        onOpenAnnouncement = {},
        onFindPeople = {},
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
        // The report sheet is UX-SAFE-001, group 17.
        onReport = {},
        onLoadMoreComments = vm::loadMoreComments,
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
private fun sharePost(context: android.content.Context, postId: String) {
    val intent = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(android.content.Intent.EXTRA_TEXT, "$SHARE_BASE/${Routes.post(postId)}")
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
private const val SHARE_BASE = "https://mohalla.invalid"

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
        onReport = {},
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
            viewModel(factory = LoginViewModel.Factory(container.authRepository))
        val state by vm.state.collectAsState()

        LoginScreen(
            state = state,
            onPhoneChanged = vm::onPhoneChanged,
            onPasswordChanged = vm::onPasswordChanged,
            onSubmit = vm::submit,
            onForgotPassword = { navController.navigate(Routes.FORGOT_PASSWORD) },
            // The capability is reported but not acted on here: a suspended
            // account signs in and lands on Home with the banner (BR-034), so
            // there is nothing to branch on. The shell reads the capability
            // itself, which keeps one source of truth.
            onAuthenticated = { navController.toShell() },
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
            onContinue = { if (vm.phoneStepValid) navController.navigate(Routes.REGISTER_DOB) },
            onBack = { navController.popBackStack() },
        )
    }

    composable(Routes.REGISTER_DOB) { entry ->
        val vm = registerViewModel(navController, entry, container)
        val state by vm.state.collectAsState()

        RegisterDateOfBirthScreen(
            state = state,
            onDateChanged = vm::onDateOfBirthChanged,
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
            viewModel(factory = RestoreAccountViewModel.Factory(container.authRepository))
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
