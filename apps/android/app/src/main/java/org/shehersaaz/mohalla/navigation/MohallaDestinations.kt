package org.shehersaaz.mohalla.navigation

import androidx.annotation.StringRes
import org.shehersaaz.mohalla.R

/**
 * The five-item bottom navigation (UI/UX §14).
 *
 * THE RTL RULE THE BRIEF SINGLES OUT. Under mirroring the row reverses, so
 * Profile sits at the visual start and Home at the visual end — but **Create
 * stays third of five**, because the middle of an odd-length row is the same
 * position from either end. That falls out of laying the row out with logical
 * direction and letting `LayoutDirection.Rtl` reverse it, and it does NOT fall
 * out of right-aligning the labels, which is the mistake §8 warns against.
 *
 * The list below is therefore in **logical order** and is never reversed in
 * code. Reversing it manually would double-mirror in Urdu and put Create back
 * off-centre in exactly the way the requirement forbids.
 */
enum class MohallaTab(
    val route: String,
    @StringRes val labelRes: Int,
    /** Rendered as an outline when unselected, filled when selected. */
    val icon: TabIcon,
) {
    HOME("home", R.string.nav_home, TabIcon.HOME),
    EVENTS("events", R.string.nav_events, TabIcon.EVENTS),

    /**
     * The centre item, and the only one that is not a destination in the
     * ordinary sense: it opens the composer, and for a SUSPENDED account it
     * opens the suspension explainer instead (BR-034, UX-SAFE-004). §14 is
     * explicit that it must not open a composer that will inevitably fail.
     */
    CREATE("create", R.string.nav_create, TabIcon.CREATE),

    MESSAGES("messages", R.string.nav_messages, TabIcon.MESSAGES),
    PROFILE("profile", R.string.nav_profile, TabIcon.PROFILE),
    ;

    companion object {
        /** Logical order. Never reversed — the layout direction does that. */
        val ordered: List<MohallaTab> = entries.toList()

        init {
            // The centre position is what makes the RTL rule work. Asserted at
            // class-load so adding a sixth tab fails immediately and loudly
            // rather than quietly moving Create off-centre.
            require(ordered.size == 5) { "Bottom navigation is specified as five items (UI/UX §14)" }
            require(ordered[2] == CREATE) { "Create must be the third of five items" }
        }
    }
}

/**
 * Which icons mirror and which do not.
 *
 * `04-mobile-architecture.md` §3 rule 3: directional assets mirror
 * automatically via `autoMirrored`; non-directional ones are explicitly
 * excluded. None of the five tab icons is directional — a house, a calendar, a
 * plus, an envelope and a person all mean the same thing in both directions —
 * so all five are marked non-mirroring. Back arrows and chevrons, which are
 * directional, are handled where they are used.
 */
enum class TabIcon(val mirrors: Boolean = false) {
    HOME,
    EVENTS,
    CREATE,
    MESSAGES,
    PROFILE,
}

/**
 * Routes that are not tabs.
 *
 * Strings rather than a type-safe graph because navigation-compose's string
 * routes are what the deep-link handling in §42 has to match against, and
 * keeping one representation avoids maintaining a mapping between two.
 */
object Routes {
    const val SPLASH = "splash"
    const val LANGUAGE = "language"
    const val WELCOME = "welcome"
    const val LOGIN = "login"

    /**
     * The nested graph the four registration steps and the OTP screen live in.
     *
     * It exists to give them a shared `ViewModelStoreOwner`: the phone number
     * entered on step one has to still be there on step four, and a ViewModel
     * scoped to a single destination is destroyed when that destination leaves
     * the back stack. Never navigated to as a screen — entering the graph lands
     * on its start destination.
     */
    const val REGISTER_GRAPH = "register"

    const val REGISTER_PHONE = "register/phone"
    const val REGISTER_DOB = "register/dob"
    const val REGISTER_PASSWORD = "register/password"
    const val TERMS = "terms"
    const val OTP = "otp"
    /**
     * The nested graph the two password-reset steps live in.
     *
     * It exists for the same reason [REGISTER_GRAPH] does, and it was added
     * because the reason was ignored the first time: the number accepted on
     * UX-AUTH-010 has to still be there on UX-AUTH-011, and two destination
     * scoped ViewModels are two different instances. Without this graph the
     * second screen showed no masked recipient and `submitReset` returned at
     * its first line — an enabled Save button that issued no request
     * (INTEGRATION-004). Never navigated to as a screen.
     */
    const val PASSWORD_RESET_GRAPH = "password"

    const val FORGOT_PASSWORD = "password/forgot"
    const val RESET_PASSWORD = "password/reset"
    const val RESTORE_ACCOUNT = "account/restore"

    const val USERNAME = "setup/username"
    const val PROFILE_SETUP = "setup/profile"
    const val SUGGESTED = "setup/suggested"

    /** UX-HOME-006. The id identifies which announcement, nothing more. */
    const val ANNOUNCEMENT_PATTERN = "announcement/{announcementId}"
    fun announcement(id: String) = "announcement/$id"

    const val SHELL = "shell"

    /**
     * Create an event (UX-EVENT-004), and edit one (UX-EVENT-005).
     *
     * TWO ROUTES FOR ONE SCREEN, because the screen needs to know which it is
     * before it composes: an edit loads the event first and offers Cancel, and a
     * create does neither. An optional argument on one route would mean every
     * caller passing `null` and the screen branching on it anyway.
     */
    /**
     * The composer (UX-CREATE-001).
     *
     * A DESTINATION, not a tab. SS14 calls Create "the one item that reads as a
     * button rather than a location", so tapping it pushes a full-screen modal
     * over the shell and returning leaves the previously selected tab intact.
     */
    const val COMPOSER = "post/create"

    const val EVENT_CREATE = "event/create"
    fun eventEdit(id: String) = "event/$id/edit"
    const val EVENT_EDIT_PATTERN = "event/{eventId}/edit"

    /**
     * Search (UX-SEARCH-001..003).
     *
     * A DESTINATION REACHED FROM THE HOME TOP BAR, not a tab. §14 is explicit
     * about why: "search is an action performed against feed content, not a
     * place. Putting it in the top bar keeps it available from both Home tabs
     * without consuming a slot."
     */
    const val SEARCH = "search"

    /**
     * The notification centre (UX-HOME-007).
     *
     * A DESTINATION REACHED FROM THE HOME TOP BAR, for the same reason as
     * Search and a different one besides. §14: notifications are "an interrupt,
     * not a place - users go there because something happened, not because they
     * chose to". A bottom-bar slot would spend one of five on a screen visited
     * reactively, and would sit a red badge in the navigation permanently.
     */
    const val NOTIFICATIONS = "notifications"

    /**
     * Push preferences (UX-SET-003).
     *
     * Its own route rather than a section of the settings index, because
     * SET-FR-007 gives it seven controls and a paragraph - and because the
     * settings index itself is group 16, so this screen exists and is reachable
     * before its parent does.
     */
    const val NOTIFICATION_PREFERENCES = "settings/notifications"

    /**
     * Settings (UX-SET-001..008).
     *
     * REACHED FROM MY PROFILE, per §14's navigation tree, and not a tab: these
     * are screens a user visits deliberately and rarely, and one of five slots
     * is not what "rarely" earns.
     */
    const val SETTINGS = "settings"
    const val SETTINGS_LANGUAGE = "settings/language"
    const val SETTINGS_PASSWORD = "settings/password"
    const val SETTINGS_BLOCKED = "settings/blocked"
    const val SETTINGS_HELP = "settings/help"
    const val SETTINGS_ABOUT = "settings/about"

    /**
     * UX-SET-009 (SET-FR-004).
     *
     * A SCREEN, NOT A DIALOG. "Not a bottom sheet. A screen, a password, and an
     * enumerated list" - PRIV-006 requires the consequences to be READ before
     * anybody confirms, and a dialog is the wrong shape for six paragraphs.
     */
    const val DELETE_ACCOUNT = "settings/delete"

    /**
     * The legal documents (UX-SET-006).
     *
     * ONE ROUTE WITH A KIND rather than three, because they are one screen: none
     * of the three exists (OD-015) and all three say so. When they do exist this
     * becomes a reader and the argument selects the document.
     */
    fun legal(kind: String) = "legal/$kind"

    const val LEGAL_PATTERN = "legal/{kind}"
    const val LEGAL_TERMS = "terms"
    const val LEGAL_PRIVACY = "privacy"
    const val LEGAL_GUIDELINES = "guidelines"

    /** UX-PROFILE-003. The owner's own, so no id travels in the route. */
    const val EDIT_PROFILE = "me/edit"

    /** UX-PROFILE-006 - private to the caller, so likewise. */
    const val SAVED_POSTS = "me/saved"

    /**
     * UX-PROFILE-004 and UX-PROFILE-005.
     *
     * TWO ROUTES RATHER THAN ONE WITH A FLAG, because a back stack entry is a
     * place: going from a profile to Followers and then to Following should
     * leave two entries, and a single route with a query argument would make
     * navigating between them replace rather than push.
     */
    fun followers(userId: String) = "user/$userId/followers"
    fun following(userId: String) = "user/$userId/following"

    const val FOLLOWERS_PATTERN = "user/{userId}/followers"
    const val FOLLOWING_PATTERN = "user/{userId}/following"

    /**
     * The image viewer (UX-HOME-004).
     *
     * The media ids travel in the route rather than through a shared object,
     * because the viewer is reached from the post card and from the detail
     * screen and both already hold the list. They are joined by a character
     * that cannot appear in a UUID, so no encoding is needed.
     */
    fun imageViewer(mediaIds: List<String>, index: Int) =
        "media/${mediaIds.joinToString(MEDIA_ID_SEPARATOR)}/$index"

    const val IMAGE_VIEWER_PATTERN = "media/{mediaIds}/{index}"

    /** A comma cannot appear in a UUID, so the join is unambiguous. */
    const val MEDIA_ID_SEPARATOR = ","

    /** Deep-linkable content (§42). */
    fun post(id: String) = "post/$id"
    fun event(id: String) = "event/$id"
    fun profile(handle: String) = "user/$handle"
    fun conversation(id: String) = "conversation/$id"

    const val POST_PATTERN = "post/{postId}"
    const val EVENT_PATTERN = "event/{eventId}"
    const val PROFILE_PATTERN = "user/{handle}"
    const val CONVERSATION_PATTERN = "conversation/{conversationId}"

    /**
     * A conversation opened from a PROFILE rather than from the inbox.
     *
     * BR-024 resolves one thread per pair forever, so this route asks the
     * server which conversation that is before navigating - the caller has a
     * user id and no conversation id, and inventing one on the device would
     * mean two threads for one pair the first time both people wrote at once.
     */
    fun conversationWith(userId: String) = "conversation/with/$userId"

    const val CONVERSATION_WITH_PATTERN = "conversation/with/{userId}"
}
