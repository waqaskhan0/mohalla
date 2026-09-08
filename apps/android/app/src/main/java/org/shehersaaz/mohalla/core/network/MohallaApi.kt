package org.shehersaaz.mohalla.core.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.Serializable
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query

/**
 * The Retrofit surface, built against the GENERATED Stage 6 contract
 * (`docs/architecture/contracts/openapi-stage6-generated.json` — 88 paths, 104
 * operations, emitted from the running backend).
 *
 * NOT built against `openapi-v1.yaml`. That Stage 4 file describes 20
 * operations under different prefixes — `/auth/register`, `/m/me/username`,
 * `/a/moderation/queue` — and the implementation serves `/register`,
 * `/me/username` and `/admin/moderation/queue`. A client generated from it
 * would compile and talk to nothing. Recorded as a correction in
 * `docs/implementation/mobile/00-mobile-baseline.md` rather than followed
 * silently (§4 of the Stage 7 brief).
 *
 * Paths are relative, with no leading slash, so the base URL's own path segment
 * is preserved if one is ever added.
 */
interface MohallaApi {

    // ---------------------------------------------------------------- identity
    @POST("register")
    suspend fun register(@Body body: RegisterRequest): Response<AcceptedResponse>

    @POST("otp/verify")
    suspend fun verifyOtp(@Body body: VerifyOtpRequest): Response<SessionResponse>

    @POST("otp/resend")
    suspend fun resendOtp(@Body body: ResendOtpRequest): Response<AcceptedResponse>

    @POST("login")
    suspend fun login(@Body body: LoginRequest): Response<LoginResponse>

    @POST("logout")
    suspend fun logout(): Response<Unit>

    @POST("password/forgot")
    suspend fun forgotPassword(@Body body: ForgotPasswordRequest): Response<AcceptedResponse>

    @POST("password/reset")
    suspend fun resetPassword(@Body body: ResetPasswordRequest): Response<AcceptedResponse>

    @POST("password/change")
    suspend fun changePassword(@Body body: ChangePasswordRequest): Response<Unit>

    /** SET-FR-005 — reachable with the RESTORE_ONLY session login issues. */
    @POST("me/restore")
    suspend fun restoreAccount(): Response<RestoreResponse>

    // ------------------------------------------------------------------ profile
    @GET("me")
    suspend fun me(): Response<OwnProfileResponse>

    /**
     * ADVISORY ONLY (EDGE-007). The answer can be stale by the time the user
     * taps Continue; `claimUsername` is what decides.
     */
    @GET("username/available")
    suspend fun usernameAvailable(@Query("username") username: String): Response<AvailabilityResponse>

    @POST("me/username")
    suspend fun claimUsername(@Body body: ClaimUsernameRequest): Response<OwnProfileResponse>

    @POST("me/profile")
    suspend fun createProfile(@Body body: CreateProfileRequest): Response<OwnProfileResponse>

    /**
     * Edit own profile (PROFILE-FR-003).
     *
     * A `JsonObject`, NOT A DATA CLASS, and that is deliberate. The API's rule
     * is "send null to clear an optional field; omit it to leave it alone" -
     * three states - and `MohallaJson` sets `explicitNulls = false`, which OMITS
     * a null property when writing. A typed body therefore could not express a
     * clear at all: nobody could remove a bio, a city or a photo, because the
     * request said "leave it alone" every time. Built with `patch { }`; see
     * `PatchBody.kt`.
     */
    @PATCH("me/profile")
    suspend fun updateProfile(@Body body: JsonObject): Response<OwnProfileResponse>

    @GET("categories")
    suspend fun categories(): Response<CategoriesResponse>

    @GET("suggestions")
    suspend fun suggestions(@Query("limit") limit: Int): Response<SuggestionsResponse>

    /**
     * Somebody else's profile (PROFILE-FR-005).
     *
     * Returns the SAME neutral 404 for a missing, banned, deleted or blocked
     * profile (BR-025) - one state, and the client must not try to tell them
     * apart. A SUSPENDED profile is visible, because a suspension is temporary
     * and hiding it would break conversations already under way.
     */
    @GET("users/{id}")
    suspend fun user(@Path("id") userId: String): Response<PublicProfileResponse>

    /**
     * Follow (SOCIAL-FR-001).
     *
     * IDEMPOTENT, which is what makes the client's missing knowledge survivable:
     * no response body anywhere says whether the viewer already follows somebody
     * (GAP-M-011), so a Follow control can be offered in the wrong state - and a
     * repeat follow leaves exactly one relationship and does not change the
     * count. Refused with a neutral 404 across a block in either direction
     * (BR-023).
     */
    @PUT("users/{id}/follow")
    suspend fun follow(@Path("id") userId: String): Response<Unit>

    /** SOCIAL-FR-002 - idempotent, and SILENT: no notification is ever produced (BR-020). */
    @DELETE("users/{id}/follow")
    suspend fun unfollow(@Path("id") userId: String): Response<Unit>

    /**
     * Who follows this account (SOCIAL-FR-003), and who it follows
     * (SOCIAL-FR-004).
     *
     * PAGED BY A `before` TIMESTAMP, like the message inbox and unlike every
     * keyset list - the ordering is by when the relationship was created, and
     * one timestamp is enough to resume it.
     *
     * The server excludes anyone blocked in either direction RELATIVE TO THE
     * VIEWER, so two people looking at the same profile can legitimately see
     * different lists and different lengths. Suspended accounts are included,
     * because a suspension is temporary and hiding them would silently rewrite
     * the social graph.
     */
    @GET("users/{id}/followers")
    suspend fun followers(
        @Path("id") userId: String,
        @Query("limit") limit: Int? = null,
        @Query("before") before: String? = null,
    ): Response<UserListResponse>

    @GET("users/{id}/following")
    suspend fun following(
        @Path("id") userId: String,
        @Query("limit") limit: Int? = null,
        @Query("before") before: String? = null,
    ): Response<UserListResponse>

    /**
     * A profile's posts (PROFILE-FR-008).
     *
     * Newest first, keyset-paginated on `(createdAt, id)` like the feed.
     * BR-032: auto-hidden posts appear ONLY for their author and arrive marked
     * `underReview`, which is what PROFILE-FR-004's acceptance criterion needs -
     * "I see it labelled under review, and no other user sees it at all."
     */
    @GET("users/{id}/posts")
    suspend fun userPosts(
        @Path("id") userId: String,
        @Query("limit") limit: Int? = null,
        @Query("cursorCreatedAt") cursorCreatedAt: String? = null,
        @Query("cursorId") cursorId: String? = null,
    ): Response<AuthorPostsResponse>

    /**
     * Saved posts (FEED-FR-007).
     *
     * NEWEST-SAVED-FIRST, not newest-posted-first, and private to the caller:
     * "there is no route that reveals who saved a given post, and saving
     * generates no notification to its author."
     */
    @GET("me/saved")
    suspend fun savedPosts(
        @Query("limit") limit: Int? = null,
        @Query("cursorCreatedAt") cursorCreatedAt: String? = null,
        @Query("cursorId") cursorId: String? = null,
    ): Response<FeedResponse>

    /** Private, idempotent, and silent - the author is never told. */
    @PUT("posts/{id}/save")
    suspend fun savePost(@Path("id") postId: String): Response<Unit>

    @DELETE("posts/{id}/save")
    suspend fun unsavePost(@Path("id") postId: String): Response<Unit>

    // --------------------------------------------------------------------- feed
    //
    // FEED-FR-001: reverse chronological, no ranking. Pagination is KEYSET, not
    // offset - a cursor of (createdAt, id) - because a new post arriving
    // between pages shifts every offset and makes page two repeat or skip.
    @GET("feed/following")
    suspend fun feedFollowing(
        @Query("limit") limit: Int? = null,
        @Query("cursorCreatedAt") cursorCreatedAt: String? = null,
        @Query("cursorId") cursorId: String? = null,
        @Query("category") category: String? = null,
    ): Response<FeedResponse>

    @GET("feed/discover")
    suspend fun feedDiscover(
        @Query("limit") limit: Int? = null,
        @Query("cursorCreatedAt") cursorCreatedAt: String? = null,
        @Query("cursorId") cursorId: String? = null,
        @Query("category") category: String? = null,
    ): Response<FeedResponse>

    /**
     * FEED-FR-002 - its OWN endpoint, by requirement.
     *
     * Featured renders independently of the feeds, so a Following feed that is
     * empty or failing still leaves something on screen (RSK-001, REL-005).
     * Unauthenticated-safe and locale-parameterised.
     */
    @GET("feed/featured")
    suspend fun feedFeatured(@Query("locale") locale: String? = null): Response<FeaturedResponse>

    @GET("posts/{id}")
    suspend fun post(@Path("id") id: String): Response<PostResponse>

    /**
     * Publish a post (POST-FR-001).
     *
     * Body is 1-3,000 GRAPHEME CLUSTERS (BR-012), and is optional when an
     * attachment is present. Up to four media ids IN THE ORDER GIVEN (BR-013,
     * POST-FR-003), each of which must already be READY - the database refuses
     * a post referencing media still under inspection (ADR-013 step 7), which
     * arrives as a 409 `MEDIA_NOT_READY`.
     */
    @POST("posts")
    suspend fun createPost(@Body body: CreatePostBody): Response<PostResponse>

    /**
     * Edit own post (POST-FR-008).
     *
     * TEXT AND CATEGORY ONLY. [UpdatePostBody] has no `mediaIds` field because
     * BR-014 forbids changing a post's images after publishing, and the
     * server's schema is strict - sending it is REJECTED rather than ignored,
     * so an author who tries is told rather than left believing it worked.
     */
    @PATCH("posts/{id}")
    suspend fun updatePost(
        @Path("id") id: String,
        @Body body: UpdatePostBody,
    ): Response<PostResponse>

    @DELETE("posts/{id}")
    suspend fun deletePost(@Path("id") id: String): Response<Unit>

    /**
     * Like and unlike (ENGAGE-FR-001).
     *
     * `PUT`/`DELETE` because a like is a STATE, and both directions are
     * idempotent against the composite primary key. That is what satisfies the
     * acceptance criterion - "six rapid taps change the count by at most one" -
     * server-side, so the client does not have to serialise its taps to be
     * correct. It still guards a second tap while one is in flight, because two
     * requests racing would leave the VISIBLE state up to whichever landed last.
     *
     * NEITHER RETURNS A BODY. The count is not echoed back, so an optimistic
     * increment is the only way to show the change immediately - and it is
     * reverted on failure rather than left showing something untrue
     * (ENGAGE-FR-001: "the interface reverts to the true server state rather
     * than showing an optimistic value indefinitely").
     */
    @PUT("posts/{id}/like")
    suspend fun like(@Path("id") id: String): Response<Unit>

    @DELETE("posts/{id}/like")
    suspend fun unlike(@Path("id") id: String): Response<Unit>

    // --------------------------------------------------------------- comments
    /**
     * A post's comments (ENGAGE-FR-002/003).
     *
     * OLDEST FIRST, which is the opposite of every other list in the product
     * and is right: a thread is a conversation, and reading it newest-first
     * puts replies before what they reply to. Comments from blocked users are
     * excluded in BOTH directions (ENGAGE-FR-006), so two people who have
     * blocked each other legitimately see different totals.
     *
     * The list is FLAT, with `parentCommentId` on each row. The client nests it
     * one level (BR-033); the server does not send a tree, because a tree would
     * have to decide how to paginate and one level of nesting means the client
     * can do it from a single page.
     */
    @GET("posts/{id}/comments")
    suspend fun comments(
        @Path("id") id: String,
        @Query("limit") limit: Int? = null,
        @Query("cursorCreatedAt") cursorCreatedAt: String? = null,
        @Query("cursorId") cursorId: String? = null,
    ): Response<CommentsResponse>

    @POST("posts/{id}/comments")
    suspend fun addComment(
        @Path("id") id: String,
        @Body body: CommentBody,
    ): Response<CommentResponse>

    /**
     * Reply to a comment (ENGAGE-FR-003 · BR-033).
     *
     * EXACTLY ONE LEVEL OF NESTING. A reply aimed at a nested reply attaches to
     * the same parent THREAD rather than being refused - the intent is clear,
     * and the database refuses a third level regardless. This is the
     * requirement the SRS says "solves WhatsApp's lack of threading".
     */
    @POST("comments/{id}/replies")
    suspend fun addReply(
        @Path("id") commentId: String,
        @Body body: CommentBody,
    ): Response<CommentResponse>

    /**
     * Delete a comment (ENGAGE-FR-004/005).
     *
     * The comment's author OR THE POST'S AUTHOR may delete it (BR-020), which
     * "distributes moderation away from administrators". Replies are removed
     * with it. Anyone else gets the same neutral 404 as a missing comment, so a
     * third party cannot probe who wrote what.
     */
    @DELETE("comments/{id}")
    suspend fun deleteComment(@Path("id") commentId: String): Response<Unit>

    // ----------------------------------------------------------------- messaging
    //
    // REST IS THE SOURCE OF TRUTH AND REALTIME IS AN ACCELERATOR, which the
    // API states plainly: every route here works with the socket switched off,
    // so a missed event costs latency and never data.
    //
    // THREE DIFFERENT PAGINATION SHAPES APPEAR IN THIS ONE MODULE. The inbox
    // pages by a `before` TIMESTAMP; history pages by a keyset pair, NEWEST
    // first, because a conversation is read from the bottom; `since` takes a
    // timestamp and returns OLDEST first, because the client is appending to
    // what it already holds. Using the wrong one pages away from the data
    // rather than through it.

    /**
     * Open the conversation with somebody (MSG-FR-001).
     *
     * 200 RATHER THAN 201, and that is BR-024: one conversation exists per pair
     * FOREVER, so this RESOLVES a thread rather than creating one. Calling it
     * twice returns the same conversation, which is the acceptance criterion.
     * Opening notifies nobody and raises no request - an empty thread appears
     * in neither inbox until something is actually sent.
     */
    @POST("conversations")
    suspend fun openConversation(@Body body: OpenConversationBody): Response<ConversationResponse>

    /**
     * The inbox, or the request list (MSG-FR-003 - BR-027).
     *
     * `section=REQUESTS` returns Message Requests, which are "a separate
     * section with its own count" and are NEVER mixed into the main list.
     * Conversations hidden by a block are absent while it stands and return
     * intact on unblock (MSG-FR-006).
     */
    @GET("conversations")
    suspend fun inbox(
        @Query("section") section: String? = null,
        @Query("limit") limit: Int? = null,
        @Query("before") before: String? = null,
    ): Response<InboxResponse>

    /**
     * Two numbers, because the inbox has two sections.
     *
     * Counts CONVERSATIONS with something unread rather than unread messages -
     * "2" on that screen means two threads, not two hundred messages across
     * two threads.
     */
    @GET("conversations/unread")
    suspend fun unreadCounts(): Response<UnreadCountsResponse>

    /** NEWEST first, keyset-paginated: a conversation is read from the bottom. */
    @GET("conversations/{id}/messages")
    suspend fun messages(
        @Path("id") conversationId: String,
        @Query("limit") limit: Int? = null,
        @Query("cursorCreatedAt") cursorCreatedAt: String? = null,
        @Query("cursorId") cursorId: String? = null,
    ): Response<MessagesResponse>

    /**
     * Everything after a server timestamp, OLDEST first (MSG-FR-004 E1).
     *
     * BOTH THE RECONNECT PATH AND THE POLLING FALLBACK. The API names it as
     * such: it returns the same messages carrying the same client ids, so a
     * client that switches transports cannot duplicate anything.
     */
    @GET("conversations/{id}/messages/since")
    suspend fun messagesSince(
        @Path("id") conversationId: String,
        @Query("since") since: String,
        @Query("limit") limit: Int? = null,
    ): Response<MessagesSinceResponse>

    /**
     * Send (MSG-FR-002/004).
     *
     * `clientMessageId` IS THE WHOLE IDEMPOTENCY MECHANISM. A repeat of the
     * same id returns the ORIGINAL message with 200 instead of creating a
     * second with 201 - so a retry after a timeout, a duplicate delivery, and a
     * switch from socket to polling all resolve to exactly one message
     * (EDGE-020, EDGE-021). MSG-FR-002's acceptance criterion is precisely
     * that: "a message that fails and is retried twice... exactly one message
     * is delivered."
     */
    @POST("conversations/{id}/messages")
    suspend fun sendMessage(
        @Path("id") conversationId: String,
        @Body body: SendMessageBody,
    ): Response<MessageResponse>

    /**
     * Mark read (MSG-FR-009).
     *
     * SAFE TO CALL ON A MESSAGE REQUEST. The read marker moves, and no receipt
     * is derived from it while the thread is a request - "reading a request
     * does not signal anything to a stranger".
     */
    @POST("conversations/{id}/read")
    suspend fun markRead(@Path("id") conversationId: String): Response<Unit>

    /** MSG-FR-005 - the thread moves to the main inbox. Idempotent. */
    @POST("conversations/{id}/accept")
    suspend fun acceptRequest(@Path("id") conversationId: String): Response<Unit>

    /**
     * Decline (MSG-FR-005 A1 - BR-028).
     *
     * THE SENDER IS TOLD NOTHING. No event, no notification, no observable
     * change: "a declined message request produces no signal to the sender,
     * because informing them invites retaliation." Later messages from that
     * sender go into the same suppressed thread rather than raising a new
     * request, so they stay available if the recipient reports or later
     * accepts.
     */
    @POST("conversations/{id}/decline")
    suspend fun declineRequest(@Path("id") conversationId: String): Response<Unit>

    // -------------------------------------------------------------------- search
    //
    // OFFSET PAGINATION, NOT KEYSET, AND THAT IS CORRECT HERE. Every other list
    // in this product pages by cursor, because a cursor names a position in a
    // stable ordering. Search results are ranked by RELEVANCE then recency, and
    // relevance is not a column - there is no (score, id) pair a later page can
    // resume from, and the ranking of page one can legitimately change between
    // requests as content is added. An offset is honest about being approximate
    // where a cursor would imply a stability the ordering does not have.
    //
    // The parameter is `q` by the frozen contract.
    //
    // THREE SEPARATE ENDPOINTS, one per tab, rather than one federated search.
    // The three surfaces are read at different times by different intents -
    // finding a person to message, finding what was said about a problem last
    // month, finding something to attend - and a combined response would make
    // every tab wait for the slowest of the three.
    @GET("search/people")
    suspend fun searchPeople(
        @Query("q") query: String,
        @Query("limit") limit: Int? = null,
        @Query("offset") offset: Int? = null,
    ): Response<PeopleSearchResponse>

    @GET("search/posts")
    suspend fun searchPosts(
        @Query("q") query: String,
        @Query("limit") limit: Int? = null,
        @Query("offset") offset: Int? = null,
    ): Response<PostSearchResponse>

    /**
     * Events (SEARCH-FR-004).
     *
     * UPCOMING EVENTS RANK ABOVE PAST ONES, ahead of relevance - a
     * perfectly-matching event that happened last year is less useful than a
     * near-matching one next week, because only one of them can still be
     * attended. Past events are ranked DOWN rather than excluded: the upcoming
     * list is a schedule, but search is a memory.
     */
    @GET("search/events")
    suspend fun searchEvents(
        @Query("q") query: String,
        @Query("limit") limit: Int? = null,
        @Query("offset") offset: Int? = null,
    ): Response<EventSearchResponse>

    // -------------------------------------------------------------------- events
    //
    // EVENT-FR-005: SOONEST FIRST - the only ASCENDING list in the product.
    // Everything else is reverse chronological; an events list is read by what
    // is about to happen rather than by what was just added. The cursor is
    // (startsAt, id) and it walks FORWARD in time, which is why the feed's
    // cursor type cannot be reused for it.
    @GET("events")
    suspend fun eventsUpcoming(
        @Query("limit") limit: Int? = null,
        @Query("cursorStartsAt") cursorStartsAt: String? = null,
        @Query("cursorId") cursorId: String? = null,
    ): Response<EventListResponse>

    /**
     * A creator's own events (EVENT-FR-001 step 8).
     *
     * NEWEST START FIRST, because this is a history as much as a schedule.
     *
     * THIS IS THE ONLY LIST BEHIND "MY EVENTS", AND IT IS NOT THE WHOLE
     * REQUIREMENT. UX-EVENT-002 asks for events the user "created OR responded
     * to"; the API offers created-by only, and `GET /events` takes a strict
     * query with no `mine` parameter, so the responded-to half cannot be
     * requested at all. The screen therefore ships the half that exists and
     * says so, rather than filtering a page of twenty upcoming events on the
     * device and presenting the result as the user's events - which would be
     * wrong for anyone who responded to an event that is not on page one.
     */
    @GET("users/{userId}/events")
    suspend fun eventsByCreator(
        @Path("userId") userId: String,
        @Query("limit") limit: Int? = null,
        @Query("cursorStartsAt") cursorStartsAt: String? = null,
        @Query("cursorId") cursorId: String? = null,
    ): Response<EventListResponse>

    @GET("events/{id}")
    suspend fun event(@Path("id") id: String): Response<EventResponse>

    @POST("events")
    suspend fun createEvent(@Body body: CreateEventBody): Response<EventResponse>

    /**
     * Edit an event (EVENT-FR-007).
     *
     * A `JsonObject` for the same reason as the profile patch, and here the
     * consequence was worse than a field that would not clear. The backend's own
     * comment predicts it: "a caller switching a PHYSICAL event to ONLINE - who
     * must send a link AND null the location - would have the old location
     * merged back in and be told they supplied both. The type change would be
     * impossible, and the error message would blame a field they had just
     * cleared." Built with `patch { }`.
     */
    @PATCH("events/{id}")
    suspend fun updateEvent(
        @Path("id") id: String,
        @Body body: JsonObject,
    ): Response<EventResponse>

    /**
     * Cancel, or delete when nobody has responded (EVENT-FR-007).
     *
     * ONE INTENTION - "this is not happening" - and the OUTCOME IS NOT THE
     * CREATOR'S CHOICE. The server decides: with no RSVPs the event is deleted,
     * and once anybody has committed it stays visible and marked cancelled
     * until its original date passes, so somebody who never opened the
     * notification still finds out. So this returns which of the two happened
     * and the screen reports it, rather than offering the user a choice the
     * requirement does not give them.
     */
    @DELETE("events/{id}")
    suspend fun cancelEvent(@Path("id") id: String): Response<CancelEventResponse>

    @PUT("events/{id}/rsvp")
    suspend fun rsvp(@Path("id") id: String, @Body body: RsvpBody): Response<EventResponse>

    @DELETE("events/{id}/rsvp")
    suspend fun withdrawRsvp(@Path("id") id: String): Response<EventResponse>

    /**
     * The meeting link (EVENT-FR-003 · BR-045).
     *
     * THE ONLY ROUTE IN THE PRODUCT THAT RETURNS A `meetingUrl`, and it is a
     * POST rather than a GET for that reason: this is a request for a
     * credential, not a read of a field. No list or detail body carries the
     * URL, because a room link is a credential anybody holding it can walk in
     * with, and the response body is what gets cached and logged.
     *
     * Refusals are DISTINCT here, unlike everywhere else: 403 RSVP_REQUIRED,
     * 403 JOIN_LINK_NOT_YET_AVAILABLE (with `availableFrom` in the details),
     * 400 NOT_AN_ONLINE_EVENT, 400 EVENT_CANCELLED. The event is already
     * public, so a refusal discloses nothing - and the requirement's acceptance
     * criterion demands the availability time be stated.
     */
    @POST("events/{id}/join")
    suspend fun joinEvent(@Path("id") id: String): Response<JoinEventResponse>

    // -------------------------------------------------------------------- media
    //
    // ADR-013's three steps: ask for a slot, put the bytes into quarantine,
    // then ask the server to inspect and promote. The client cannot shortcut
    // it - `complete` is what makes the object usable, and it is the server's
    // inspection that decides (SEC-012).
    @POST("media/upload-slot")
    suspend fun requestUploadSlot(@Body body: UploadSlotRequest): Response<UploadSlotResponse>

    @POST("media/{id}/complete")
    suspend fun completeUpload(@Path("id") mediaId: String): Response<MediaResponse>

    // ------------------------------------------------------------- notifications
    //
    // THE CENTRE ALWAYS HAS EVERYTHING, and that is the point of the module
    // rather than a detail of it. NOTIF-FR-001's acceptance criterion is that a
    // user who DENIED the push permission still finds the notification here;
    // NOTIF-FR-007's is that disabling a category stops the push and leaves the
    // entry. So nothing on this route filters by preference or by whether a
    // push was actually delivered - a declined permission or a disabled switch
    // costs the buzz, never the record.
    //
    // TEXT IS RENDERED BY THE SERVER AT READ TIME, in the language this request
    // names. LOCALE-FR-002 requires switching language to update "the entire
    // interface without reinstall", and a centre of pre-rendered Urdu would
    // still be Urdu after somebody switched to English. That is why `locale`
    // rides every request instead of being read from the stored preference: the
    // client knows what it is displaying RIGHT NOW, and the server's copy of the
    // preference may be one sync behind.
    //
    // Which means the client never assembles a notification sentence, and there
    // are no notification strings in `strings.xml`. Every row's text arrives
    // ready to display.

    /**
     * The notification centre (NOTIF-FR-002).
     *
     * Newest first, keyset-paginated. Notifications whose target was deleted are
     * already ABSENT - the requirement's acceptance criterion is exactly that,
     * and the server removes them "rather than left to navigate nowhere", so the
     * client needs no dead-link handling and must not invent any.
     */
    @GET("notifications")
    suspend fun notifications(
        @Query("limit") limit: Int? = null,
        @Query("cursorCreatedAt") cursorCreatedAt: String? = null,
        @Query("cursorId") cursorId: String? = null,
        @Query("locale") locale: String? = null,
    ): Response<NotificationListResponse>

    /** One number, read on nearly every screen (NOTIF-FR-002). */
    @GET("notifications/unread-count")
    suspend fun notificationUnreadCount(): Response<UnreadNotificationsResponse>

    /**
     * Mark some read.
     *
     * Scoped to the caller's own notifications in the server's WHERE clause, so
     * passing somebody else's id changes nothing rather than marking their mail
     * read. At most 200 ids.
     */
    @POST("notifications/read")
    suspend fun markNotificationsRead(
        @Body body: MarkNotificationsReadBody,
    ): Response<MarkedResponse>

    @POST("notifications/read-all")
    suspend fun markAllNotificationsRead(): Response<MarkedResponse>

    /**
     * The seven switches (NOTIF-FR-007 - SET-FR-007).
     *
     * ALL SEVEN ARE ALWAYS RETURNED, with ENABLED as the default for any the
     * user has never touched - so the settings screen shows the truth rather
     * than an empty map that would read as everything being off.
     */
    @GET("notifications/preferences")
    suspend fun notificationPreferences(): Response<NotificationPreferencesResponse>

    /**
     * Enable or disable one push category (NOTIF-FR-007).
     *
     * GATES PUSH ONLY. "The in-app centre always records everything, so
     * disabling push never loses information" - which is the acceptance
     * criterion verbatim, and the reason this screen's copy says so out loud
     * rather than leaving the reader to wonder what a switch turns off.
     */
    @PUT("notifications/preferences/{key}")
    suspend fun setNotificationPreference(
        @Path("key") key: String,
        @Body body: PushPreferenceBody,
    ): Response<Unit>

    // ----------------------------------------------------------------- settings

    /**
     * The settings screen, in one request (SET-API-002).
     *
     * Language, notification preferences and the blocked count, "assembled here
     * so the screen is one request rather than four, and so a client cannot
     * render a partial screen when one of them is slow."
     */
    @GET("me/settings")
    suspend fun settings(): Response<SettingsScreenResponse>

    /**
     * The interface language (SET-FR-001 - LOCALE-FR-002).
     *
     * STORED ON THE ACCOUNT, NOT THE DEVICE, which is what makes the acceptance
     * criterion true: "GIVEN Urdu is selected on one device, WHEN the user logs
     * in on another device, THEN Urdu is applied there too." The DEVICE also
     * keeps its own copy, because the direction of the very first frame has to
     * be known before any request could answer.
     */
    @PUT("me/language")
    suspend fun setLanguage(@Body body: LanguageRequest): Response<Unit>

    // ------------------------------------------------------------------- blocks
    //
    // BLOCKING IS UNILATERAL, SILENT AND MUTUAL IN EFFECT (BR-024/025). Neither
    // route ever tells the blocked party anything, and neither reveals whether
    // the target exists - probing account existence through the block endpoint
    // would defeat the point of the neutral 404 everywhere else.

    /** SAFETY-FR-005 - idempotent, and removes follows in BOTH directions. */
    @PUT("users/{id}/block")
    suspend fun block(@Path("id") userId: String): Response<Unit>

    /**
     * SAFETY-FR-006 - idempotent, and does NOT restore the follows the block
     * removed: re-creating a relationship the user severed would put somebody
     * back in their feed unasked.
     */
    @DELETE("users/{id}/block")
    suspend fun unblock(@Path("id") userId: String): Response<Unit>

    /**
     * The accounts this caller has blocked (SAFETY-FR-007 - SET-FR-003).
     *
     * ONLY EVER THE CALLER'S OWN LIST: "there is deliberately no route for who
     * has blocked a given user - that question has no legitimate non-admin
     * caller."
     *
     * IT RETURNS IDS AND DATES AND NOTHING ELSE, which is GAP-M-013: the only
     * route that turns an id into a name refuses precisely the people on this
     * list, because a block hides the profile in both directions.
     */
    @GET("me/blocks")
    suspend fun blocks(
        @Query("limit") limit: Int? = null,
        @Query("before") before: String? = null,
    ): Response<BlockListResponse>
}

// ============================================================ request bodies
//
// Field names mirror the backend's Zod schemas exactly. `@SerialName` is used
// wherever Kotlin convention and the wire format differ, so a rename on either
// side is a compile-time change rather than a silent null at runtime.

@Serializable
data class RegisterRequest(
    val phone: String,
    val password: String,
    val dateOfBirth: String,
    val termsVersion: String,
    val accountType: String? = null,
)

@Serializable
data class VerifyOtpRequest(
    val phone: String,
    val code: String,
    val purpose: String,
)

@Serializable
data class ResendOtpRequest(
    val phone: String,
    val purpose: String,
)

@Serializable
data class ForgotPasswordRequest(
    val phone: String,
)

@Serializable
data class ResetPasswordRequest(
    val phone: String,
    val code: String,
    val newPassword: String,
)

@Serializable
data class ChangePasswordRequest(
    val currentPassword: String,
    val newPassword: String,
)

@Serializable
data class ClaimUsernameRequest(
    val username: String,
)

/**
 * PROFILE-FR-002. `null` is meaningful for the optional fields and is NOT the
 * same as an empty string - see `SetupRepository.createProfile`.
 */
@Serializable
data class CreateProfileRequest(
    val displayName: String,
    val city: String? = null,
    val bio: String? = null,
    val photoMediaId: String? = null,
)

@Serializable
data class UploadSlotRequest(
    val kind: String,
    /** Advisory. The stored object is re-measured server-side (SEC-012). */
    val declaredBytes: Long,
    val visibility: String? = null,
)

@Serializable
data class LoginRequest(
    val phone: String,
    val password: String,
    val deviceLabel: String? = null,
)

// =========================================================== response bodies

/**
 * The uniform acknowledgement (SEC-006).
 *
 * `/register` and the password-reset endpoints return this whether the number
 * was free, already held, pending deletion or banned. There is deliberately
 * nothing in it to branch on, and the client must not try — the distinction is
 * delivered by the OTP, which only reaches the number's actual holder.
 */
@Serializable
data class AcceptedResponse(
    val status: String? = null,
)

@Serializable
data class SessionResponse(
    val token: String? = null,
    val expiresAt: String? = null,
    val userId: String? = null,
    val capability: String? = null,
)

@Serializable
data class LoginResponse(
    val status: String? = null,
    val token: String? = null,
    val expiresAt: String? = null,
    /** `FULL`, `READ_ONLY` (BR-034) or `RESTORE_ONLY` (SET-FR-005). */
    val capability: String? = null,
    val suspendedUntil: String? = null,
)

@Serializable
data class AvailabilityResponse(
    val available: Boolean? = null,
)

@Serializable
data class CategoriesResponse(
    val categories: List<CategoryResponse> = emptyList(),
)

@Serializable
data class CategoryResponse(
    val id: String,
    val slug: String,
    val nameEn: String? = null,
    val nameUr: String? = null,
)

/**
 * A page of people (SOCIAL-FR-003/004).
 *
 * EVERY ROW IS THE SAME `PublicProfileResponse` every other surface renders -
 * §162's "one definition of what a person looks like", so a revoked badge or a
 * new block takes effect here at the same moment it does in search and in the
 * inbox, rather than in the six places somebody remembered.
 *
 * `nextBefore` is a TIMESTAMP. `null` means the end, which is not the same as
 * an empty page.
 */
@Serializable
data class UserListResponse(
    val users: List<PublicProfileResponse> = emptyList(),
    val nextBefore: String? = null,
)

/** A profile's own posts (PROFILE-FR-008). */
@Serializable
data class AuthorPostsResponse(
    val posts: List<FeedItemResponse> = emptyList(),
    val nextCursor: FeedCursorResponse? = null,
)

@Serializable
data class SuggestionsResponse(
    val users: List<SuggestedUser> = emptyList(),
)

/**
 * A suggested account (SOCIAL-FR-004).
 *
 * Carries NO phone number, email or date of birth - PRIV-003 - and the client
 * has no field here that could render one even if a future response added it.
 */
@Serializable
data class SuggestedUser(
    val userId: String,
    val username: String? = null,
    val displayName: String? = null,
    val city: String? = null,
    val photoMediaId: String? = null,
    val verifiedBadge: Boolean = false,
    val accountType: String? = null,
    val followerCount: Int = 0,
)

@Serializable
data class UploadSlotResponse(
    val mediaId: String,
    val upload: UploadTarget,
)

@Serializable
data class UploadTarget(
    val url: String,
    val method: String,
    val headers: Map<String, String> = emptyMap(),
    val expiresAt: String? = null,
)

@Serializable
data class MediaResponse(
    val id: String? = null,
    val status: String? = null,
    val width: Int? = null,
    val height: Int? = null,
)

/**
 * One post as a feed renders it.
 *
 * `author` is a `PublicProfileResponse` whose `displayName` may be the
 * `profile.deletedUser` KEY rather than a name - BR-009 keeps a departed
 * account's posts and attributes them to "Deleted User", and the server sends a
 * localisation key so both languages say it. The card resolves that key; it
 * does not print it.
 */
@Serializable
data class FeedItemResponse(
    val id: String,
    val author: PublicProfileResponse,
    val body: String,
    val categorySlug: String? = null,
    val mediaIds: List<String> = emptyList(),
    val likeCount: Int = 0,
    val commentCount: Int = 0,
    /** So the like control renders in the right state without a second call. */
    val viewerHasLiked: Boolean = false,
    val editedAt: String? = null,
    val createdAt: String,
    /** BR-032 - the AUTHOR's own view of an auto-hidden post. */
    val underReview: Boolean = false,
)

@Serializable
data class PublicProfileResponse(
    val userId: String,
    val username: String? = null,
    val displayName: String? = null,
    val city: String? = null,
    val bio: String? = null,
    val photoMediaId: String? = null,
    val verifiedBadge: Boolean = false,
    val accountType: String? = null,
    val followerCount: Int = 0,
    val followingCount: Int = 0,
    val postCount: Int = 0,
)

@Serializable
data class FeedCursorResponse(
    val createdAt: String,
    val id: String,
)

@Serializable
data class FeedResponse(
    val items: List<FeedItemResponse> = emptyList(),
    /** `null` means the end. NOT the same as an empty page. */
    val nextCursor: FeedCursorResponse? = null,
)

@Serializable
data class FeaturedResponse(
    val announcements: List<FeaturedItemResponse> = emptyList(),
)

@Serializable
data class FeaturedItemResponse(
    val id: String,
    val title: String,
    val body: String,
    val expiresAt: String? = null,
)

@Serializable
data class PostResponse(
    val id: String,
    val author: PublicProfileResponse,
    val body: String,
    val categorySlug: String? = null,
    val mediaIds: List<String> = emptyList(),
    val likeCount: Int = 0,
    val commentCount: Int = 0,
    val viewerHasLiked: Boolean = false,
    val editedAt: String? = null,
    val createdAt: String,
    val underReview: Boolean = false,
)

/**
 * One event, exactly as the server publishes it.
 *
 * THREE ABSENCES ARE THE DESIGN, not omissions to be filled in later.
 *
 * NO `meetingUrl`. It arrives only from `POST /events/{id}/join`
 * (EVENT-FR-003). What this body carries instead is [joinLinkAvailable] - the
 * server's answer to "may this caller have it yet" - and
 * [joinLinkAvailableFrom] so the screen can state when. The gate is not the
 * client's to apply.
 *
 * NO ATTENDEE IDENTITIES, and no attendees array. EVENT-FR-004 permits a public
 * COUNT and states the attendee list is not shown in V1
 * (ARCH-CONFLICT-006 / D-17). The prototype's avatar stack is a privacy defect
 * carried over from a mock-up: who attends which gathering is exactly the
 * inference a civic platform must not publish. There is nothing here to build
 * one from, and the backend has no route that would serve one.
 *
 * NO CREATOR PROFILE - only [creatorId]. EVENT-FR-006 asks for "creator with
 * badge", so the detail screen resolves the name and badge with one extra
 * `GET /users/{id}`. Deliberately NOT done per row in a list: twenty extra
 * round trips on a 3G connection to render twenty names would cost more than
 * the list itself (NFR-PERF-001). Posts embed their author; events do not, and
 * that asymmetry is the API's, not the client's.
 */
@Serializable
data class EventResponse(
    val id: String,
    val creatorId: String,
    val title: String,
    val description: String,
    /** ISO-8601 UTC. Formatted in the reader's locale and zone at the edge. */
    val startsAt: String,
    /** `ONLINE` or `PHYSICAL`. Exactly one, and V1 models no hybrid. */
    val eventType: String,
    /** Present for a PHYSICAL event; free text, never geocoded. */
    val locationText: String? = null,
    val categorySlug: String? = null,
    /** `SCHEDULED` or `CANCELLED`. A cancelled event stays visible, marked. */
    val status: String,
    val goingCount: Int = 0,
    val interestedCount: Int = 0,
    /** The server's decision, never recomputed on the device. */
    val joinLinkAvailable: Boolean = false,
    /** When the 30-minute window opens; stated to the reader (EVENT-FR-003). */
    val joinLinkAvailableFrom: String? = null,
    /** `GOING`, `INTERESTED`, or null. One response per person. */
    val myResponse: String? = null,
    /** BR-032 - the CREATOR's own view of an auto-hidden event. */
    val underReview: Boolean = false,
    val editedAt: String? = null,
    val createdAt: String,
)

@Serializable
data class EventCursorResponse(
    val cursorStartsAt: String,
    val cursorId: String,
)

@Serializable
data class EventListResponse(
    val events: List<EventResponse> = emptyList(),
    /** `null` means the end. Not the same as an empty page. */
    val nextCursor: EventCursorResponse? = null,
)

/**
 * Create an event (EVENT-FR-001).
 *
 * `meetingUrl` and `locationText` are both nullable and exactly one is
 * expected: an ONLINE event needs the link, a PHYSICAL one the location, and
 * supplying both is refused because V1 does not model a hybrid. EVENT-FR-001 A1
 * says what to do instead - choose Physical and put the link in the description
 * - and the composer says so rather than silently dropping one.
 */
@Serializable
data class CreateEventBody(
    val title: String,
    val description: String,
    val startsAt: String,
    val eventType: String,
    val meetingUrl: String? = null,
    val locationText: String? = null,
    val categorySlug: String? = null,
)

/**
 * Edit an event (EVENT-FR-007).
 *
 * Every field is optional and only what changed is sent, because the server
 * notifies attendees for a TIME, LOCATION or LINK change and for nothing else -
 * "fixing a typo at midnight must not wake fifty neighbours". Sending the whole
 * object back on every save would make every edit look like a reschedule.
 */
@Serializable
data class RsvpBody(
    /** `GOING` or `INTERESTED`. */
    val response: String,
)

@Serializable
data class CancelEventResponse(
    /** `CANCELLED` or `DELETED` - the server's decision, not the creator's. */
    val outcome: String,
    /** How many people were told. Reported back so the creator knows. */
    val notifiedAttendees: Int = 0,
)

@Serializable
data class JoinEventResponse(
    val meetingUrl: String,
)

/**
 * A new post (POST-FR-001).
 *
 * `mediaIds` is nullable rather than defaulted to an empty list: the server's
 * schema makes it optional, and sending `[]` is a claim about attachments where
 * omitting the key is the absence of one. With `explicitNulls = false` a null
 * is dropped from the JSON entirely, which is what is wanted.
 */
@Serializable
data class CreatePostBody(
    val body: String,
    val categorySlug: String? = null,
    /** Up to four, IN THE CHOSEN ORDER (BR-013 · POST-FR-003). */
    val mediaIds: List<String>? = null,
)

/**
 * An edit (POST-FR-008).
 *
 * NO `mediaIds`, and that absence is BR-014 rather than an oversight - a post's
 * images cannot change after publishing, and the server rejects the field
 * outright rather than ignoring it.
 */
@Serializable
data class UpdatePostBody(
    val body: String? = null,
    val categorySlug: String? = null,
)

/**
 * One comment (ENGAGE-FR-002/003).
 *
 * `parentCommentId` is null for a top-level comment and set for a reply. The
 * list arrives FLAT and the client nests it exactly one level (BR-033).
 *
 * NO COUNTS AND NO LIKE STATE. A comment cannot be liked in V1 - ENGAGE-FR-001
 * is about posts - so there is nothing here to render an engagement row from,
 * and adding one would invent an interaction the product does not have.
 */
@Serializable
data class CommentResponse(
    val id: String,
    val postId: String,
    val author: PublicProfileResponse,
    /** Null for a top-level comment; the thread parent for a reply. */
    val parentCommentId: String? = null,
    val body: String,
    val createdAt: String,
)

@Serializable
data class CommentsResponse(
    val comments: List<CommentResponse> = emptyList(),
    /** `null` means the end. Not the same as an empty page. */
    val nextCursor: FeedCursorResponse? = null,
)

@Serializable
data class CommentBody(
    val body: String,
)

/**
 * A page of search results.
 *
 * `nextOffset` is null at the end. Three response types rather than one generic
 * wrapper because kotlinx-serialization needs a concrete type argument at each
 * call site anyway, and naming them makes the endpoint each belongs to obvious
 * at a glance.
 */
@Serializable
data class PeopleSearchResponse(
    val results: List<PublicProfileResponse> = emptyList(),
    /** `null` means the end. Not the same as an empty page. */
    val nextOffset: Int? = null,
)

@Serializable
data class PostSearchResponse(
    val results: List<FeedItemResponse> = emptyList(),
    val nextOffset: Int? = null,
)

@Serializable
data class EventSearchResponse(
    val results: List<EventResponse> = emptyList(),
    val nextOffset: Int? = null,
)

@Serializable
data class OpenConversationBody(
    val userId: String,
)

/**
 * One conversation, as the inbox lists it (MSG-FR-003).
 *
 * `requestState` is `NONE`, `PENDING`, `ACCEPTED` or `DECLINED`. The inbox and
 * the request list are separate QUERIES rather than one list filtered on the
 * device - BR-027 makes them separate sections with separate counts, and a
 * client-side filter would mean a request briefly appearing in the main inbox
 * while a page loaded.
 *
 * `readOnly` is EDGE-022: the other account is banned or deleted, so the thread
 * is readable and MARKED rather than gone. History is retained either way.
 */
@Serializable
data class ConversationResponse(
    val conversationId: String,
    val otherUserId: String,
    val requestState: String? = null,
    val unreadCount: Int = 0,
    val lastMessageAt: String? = null,
    val preview: ConversationPreview? = null,
    val readOnly: Boolean = false,
    val createdAt: String? = null,
)

/**
 * The last message, as a row shows it.
 *
 * `body` is null and `hasMedia` true for an image-only message, so the row can
 * say "sent a photo" without the image itself - which it could not fetch here
 * anyway, because message media is served only through the conversation route.
 */
@Serializable
data class ConversationPreview(
    val body: String? = null,
    val hasMedia: Boolean = false,
    val senderId: String? = null,
)

@Serializable
data class InboxResponse(
    val conversations: List<ConversationResponse> = emptyList(),
    /** A TIMESTAMP, not a cursor pair. `null` means the end. */
    val nextBefore: String? = null,
)

@Serializable
data class UnreadCountsResponse(
    val conversations: Int = 0,
    /** BR-027 - counted separately, and never contributing to the tab badge. */
    val requests: Int = 0,
)

/**
 * One message (MSG-FR-002/009).
 *
 * `clientMessageId` COMES BACK, which is what lets an optimistic bubble be
 * reconciled with the server's copy rather than rendered twice.
 *
 * `readAt` is present only on the viewer's OWN messages, and never at all in a
 * Message Request - the server withholds it, so there is nothing here for a
 * client to accidentally turn into a receipt a stranger could read.
 */
@Serializable
data class MessageResponse(
    val id: String,
    val clientMessageId: String? = null,
    val conversationId: String,
    val senderId: String,
    val body: String? = null,
    /** Fetched from `conversations/media/{id}`, NEVER from `media/{id}`. */
    val mediaId: String? = null,
    val createdAt: String,
    val readAt: String? = null,
)

/**
 * A `{cursorCreatedAt, cursorId}` keyset cursor.
 *
 * NAMED FOR HOW THE SERVER SPELLS IT, NOT FOR THE ROUTE THAT RETURNS IT, because
 * THE KEYSET ROUTES SPELL ONE IDEA THREE DIFFERENT WAYS ON THE WIRE. The feed
 * and the comment thread return `{createdAt, id}` ([FeedCursorResponse]); the
 * events list returns `{cursorStartsAt, cursorId}` ([EventCursorResponse]); and
 * message history and the notification centre both return this. Naming the type
 * after one of its two routes would invite the next route to borrow whichever
 * name looked closest rather than the one that matches.
 *
 * Borrowing the wrong one is not a compile error and not a visible one either:
 * the field simply never deserialises, so the FIRST read past the first page
 * fails — on long threads and busy accounts only, which is exactly where paging
 * matters.
 */
@Serializable
data class CursorCreatedAtResponse(
    val cursorCreatedAt: String,
    val cursorId: String,
)

@Serializable
data class MessagesResponse(
    val messages: List<MessageResponse> = emptyList(),
    /** `null` means the end of the thread. NOT the same as an empty page. */
    val nextCursor: CursorCreatedAtResponse? = null,
)

@Serializable
data class MessagesSinceResponse(
    val messages: List<MessageResponse> = emptyList(),
)

@Serializable
data class SendMessageBody(
    /**
     * Generated ON THE DEVICE before sending (ADR-009).
     *
     * Required rather than optional-with-a-server-fallback: a server-generated
     * id would be different on every retry, which is exactly the duplicate this
     * field prevents.
     */
    val clientMessageId: String,
    val body: String? = null,
    val mediaId: String? = null,
)

// ------------------------------------------------------------- notifications

/**
 * One notification, as the centre renders it.
 *
 * `text` IS ALREADY A SENTENCE, rendered by the server in the language the
 * request named - "Sana Bashir commented on your post". The client does not
 * assemble it, does not resolve the actor's NAME for it, and has no template of
 * its own; a client-side template would be a second copy of thirteen strings
 * that would drift from the server's the first time one was reworded.
 *
 * WHAT IS NOT HERE IS AS DELIBERATE. There is no `pushed` flag and no
 * `deliveredAt`: NOTIF-FR-001 and NOTIF-FR-007 both turn on the centre being
 * identical whether or not a buzz happened, and a field saying which would
 * invite a client to draw a distinction the requirements exist to erase.
 */
@Serializable
data class NotificationResponse(
    val id: String,
    /** One of eight (NOTIF-FR-003). Unknown values are tolerated - see the model. */
    val category: String,
    /** Null for an event change and for an announcement: nobody acted on the reader. */
    val actorId: String? = null,
    val targetType: String,
    val targetId: String? = null,
    /** Rendered server-side, in the requested language. */
    val text: String,
    /** NOTIF-FR-003 - how many likes one summary row stands for. 1 when not batched. */
    val batchCount: Int = 1,
    val readAt: String? = null,
    val createdAt: String,
)

@Serializable
data class NotificationListResponse(
    val notifications: List<NotificationResponse> = emptyList(),
    /** `null` means the end. NOT the same as an empty page. */
    val nextCursor: CursorCreatedAtResponse? = null,
)

@Serializable
data class UnreadNotificationsResponse(val unread: Int = 0)

@Serializable
data class MarkNotificationsReadBody(val ids: List<String>)

@Serializable
data class MarkedResponse(val marked: Int = 0)

/**
 * The seven switches, keyed by category.
 *
 * A MAP RATHER THAN SEVEN FIELDS. The server's own type is
 * `Record<PreferenceKey, boolean>` and the client enumerates the keys it knows
 * about, so a switch added server-side arrives without a client change and one
 * removed does not leave a dangling field. The screen renders the seven it has
 * copy for and ignores the rest, because a toggle with no label is worse than a
 * toggle that is not shown.
 */
@Serializable
data class NotificationPreferencesResponse(
    val preferences: Map<String, Boolean> = emptyMap(),
)

@Serializable
data class PushPreferenceBody(val pushEnabled: Boolean)

// ------------------------------------------------------------------ settings

/**
 * Everything the settings index needs, in one body (SET-API-002).
 *
 * `language` is NULLABLE and null is a real answer. BR-040 pre-selects no
 * default, so an account that has never chosen has no stored language - and the
 * client shows its own first-launch choice as current rather than inventing one.
 */
@Serializable
data class SettingsScreenResponse(
    val language: String? = null,
    val notifications: Map<String, Boolean> = emptyMap(),
    val blockedCount: Int = 0,
)

@Serializable
data class LanguageRequest(val language: String)

/**
 * One blocked account.
 *
 * AN ID AND A DATE. There is no name here and no photo, and no way to get one:
 * `GET /users/{id}` returns the neutral 404 for anybody blocked in either
 * direction, which is every row in this list. See GAP-M-013.
 */
@Serializable
data class BlockEntryResponse(
    val blockedUserId: String,
    val createdAt: String,
)

@Serializable
data class BlockListResponse(
    val blocks: List<BlockEntryResponse> = emptyList(),
    /**
     * A TIMESTAMP, and NOT a reliable end marker.
     *
     * The server sets it to the last row's `createdAt` whenever the page has
     * rows, so it is non-null on the final page too. A client that paged until
     * it went null would re-fetch that page forever; the repository stops on a
     * SHORT page instead.
     */
    val nextBefore: String? = null,
)

@Serializable
data class RestoreResponse(
    val status: String? = null,
)

/**
 * `GET /me` — the owner's own projection.
 *
 * PRIV-003: carries no phone number and no date of birth, and the client must
 * never display either even if a future field appeared. A superset of the
 * public projection, adding account state and suspension expiry.
 */
@Serializable
data class OwnProfileResponse(
    val userId: String,
    val username: String? = null,
    val displayName: String? = null,
    val city: String? = null,
    val bio: String? = null,
    val photoMediaId: String? = null,
    val verifiedBadge: Boolean = false,
    val accountType: String? = null,
    val state: String? = null,
    val suspendedUntil: String? = null,
    val followerCount: Int = 0,
    val followingCount: Int = 0,
    val postCount: Int = 0,
    @SerialName("interests") val interests: List<String> = emptyList(),
)
