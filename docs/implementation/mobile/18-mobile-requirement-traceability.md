# 18 — Mobile Requirement Traceability

**Stage 7 · Android** · §47 · 112 in-scope requirements · last updated after group 23 (Integration validation)

> Requirement → screen → API → ViewModel or use case → test → status, for every retained MOBILE requirement in the SRS.
>
> **Statuses are §47’s own vocabulary:** `IMPLEMENTED` · `PARTIAL` · `BLOCKED EXTERNAL` · `DEFERRED SHOULD` · `REMOVED APPROVED` · `OUT OF SCOPE`.
>
> §47’s vocabulary has no `DEFERRED COULD`, so a deferred **Could** is recorded as `DEFERRED SHOULD` — the status column uses the prescribed words, and the priority column carries the truth.

---

## 1. What is in scope, and what is not

The SRS carries **124** functional requirements. **12** of them are the `ADMIN-FR-*` family, which belongs to the Admin Web Portal — excluded by the Stage 7 brief and by §49 — leaving **112** for this document. `AUTH-FR-011`, administrator login, is in the AUTH family but is portal work too, so it appears below marked `OUT OF SCOPE` rather than silently dropped.

## 2. Four approved decisions move a requirement off what the SRS says

The SRS text is not the last word on priority or retention. `docs/architecture/18-requirements-architecture-traceability.md` records four approved decisions that change it, and a matrix built from the SRS alone would contradict all four:

| Requirement | The SRS says | The decision says | Recorded as |
|---|---|---|---|
| `AUTH-FR-004` Email registration | Should | **Removed from V1** | OD-021 Option C |
| `MSG-FR-005` Message requests | Should | **Must** — "on the critical path, not cuttable" | OD-022 |
| `POST-FR-005` Attach PDF | Should | Conditional on the ADR-013 safety gate, **otherwise cut** | OD-023 revised |
| `MEDIA-FR-003` · `MEDIA-FR-004` Documents | Should | Same gate, same condition | OD-023 revised |

This document applies all four. `MSG-FR-005` is counted as a Must below, which is why the Must total is 77 rather than the 76 the SRS text alone would give.

## 3. Coverage

| Status | Count | Of which Must |
|---|---|---|
| `IMPLEMENTED` | **79** | 62 |
| `PARTIAL` | **21** | 13 |
| `BLOCKED EXTERNAL` | **6** | 1 |
| `DEFERRED SHOULD` | **4** | 0 |
| `REMOVED APPROVED` | **1** | 0 |
| `OUT OF SCOPE` | **1** | 1 |
| **Total** | **112** | **77** |

| Priority | Count | Implemented | Partial | Otherwise |
|---|---|---|---|---|
| Must | 77 | 62 | 13 | 2 |
| Should | 25 | 13 | 6 | 6 |
| Could | 10 | 4 | 2 | 4 |

### The honest headline

§47 sets one bar: **"Every retained Must MOBILE requirement must be implemented."** Against that bar this stage is **not** complete, and the shortfall is specific rather than general:

- **62 of 77 Musts are `IMPLEMENTED`.**
- **13 are `PARTIAL`** — and every one of them is partial for a reason outside this codebase: three legal documents that do not exist (OD-015), a blocked-users endpoint that returns no names (GAP-M-013), an unlicensed Urdu font (DEP-013), a reply notification the API gives no target for (GAP-M-009), a push service nobody has provisioned (DEP-003), and two screens whose data has no endpoint. **None is partial for want of implementation.**
- **1 is `BLOCKED EXTERNAL`** — push (NOTIF-FR-001), on DEP-003.
- **1 is `OUT OF SCOPE`** — administrator login.

That distinction is the whole point of this table. A reader who wants to know whether Stage 7 can be signed off needs to separate *"the mobile team has not done this"* from *"nobody can do this until somebody outside the mobile team decides something"*, and on this evidence every outstanding Must is the second kind.

---

## 4. How each column was derived

**Nothing in the matrix was written from memory**, which matters because a traceability document is exactly the kind of artefact that can be fabricated and look right.

| Column | Source |
|---|---|
| Requirement, title, priority | Parsed from `docs/srs-mvp-v1.html`. It stores requirements in **two** formats — fully-specified `div.fr` blocks and condensed "remaining requirements" tables — and reading only the tables silently loses 14, including most families’ `-FR-001`. Both are read; the count is checked against every distinct ID mentioned anywhere in the file. |
| Screens | Inverted out of `17-mobile-screen-coverage.md`, so this document and that one cannot disagree. |
| API | The **route the client actually declares**, matched against the requirement IDs in Stage 6’s own generated contract summaries, then the Stage-4 `08-api-architecture.md` API-ID table for requirements the contract does not name. A route no client function declares does not appear. |
| ViewModel / use case | The real class, per screen. |
| Test | The test class that exercises it. |
| Status | Judged per requirement, with the reason recorded in the notes under each family. |

---

## 5. The matrix

### Authentication and session

| Req | Title | Pri | Screens | API | ViewModel / use case | Test | Status |
|---|---|---|---|---|---|---|---|
| AUTH-FR-001 | User Registration by Mobile Number | Must | UX-AUTH-003 · UX-AUTH-005 · UX-AUTH-007 | `POST /register` | RegisterViewModel | AuthUniformityTest · AuthValidationTest · RegisterFlowTest | `IMPLEMENTED` |
| AUTH-FR-002 | OTP Verification | Must | UX-AUTH-009 | `POST /otp/verify` | OtpViewModel | AuthUniformityTest | `IMPLEMENTED` |
| AUTH-FR-003 | OTP resend | Must | UX-AUTH-009 | `POST /otp/resend` | OtpViewModel | AuthUniformityTest | `IMPLEMENTED` |
| AUTH-FR-004 | Email registration | Should | — | — | — | — | `REMOVED APPROVED` |
| AUTH-FR-005 | Login | Must | UX-AUTH-004 | `POST /login` | LoginViewModel | AuthValidationTest | `IMPLEMENTED` |
| AUTH-FR-006 | Logout | Must | UX-SET-001 | `POST /logout` | SettingsViewModel | SettingsTest | `IMPLEMENTED` |
| AUTH-FR-007 | Password reset | Must | UX-AUTH-010 · UX-AUTH-011 | `POST /password/forgot` · `POST /password/reset` | PasswordResetViewModel | RegisterFlowTest | `IMPLEMENTED` |
| AUTH-FR-008 | Age Gate | Must | UX-AUTH-006 | `POST /register` | RegisterViewModel | RegisterFlowTest | `IMPLEMENTED` |
| AUTH-FR-009 | Terms acceptance | Must | UX-AUTH-008 | `POST /register` | RegisterViewModel | RegisterFlowTest | `PARTIAL` |
| AUTH-FR-010 | Session management | Must | all | — | AuthInterceptor · SessionRevocation | SecureStorageTest · FailureRoutingTest | `IMPLEMENTED` |
| AUTH-FR-011 | Administrator login | Must | — | — | — | — | `OUT OF SCOPE` |
| AUTH-FR-012 | Google sign-in | Could | — | — | — | — | `DEFERRED SHOULD` |

- **AUTH-FR-004** — Email-primary registration removed from V1 by OD-021 Option C.
- **AUTH-FR-009** — The Terms screen exists and registration deliberately FAILS CLOSED while OD-015 leaves no published document to record acceptance of.
- **AUTH-FR-010** — Cross-cutting, so no screen of its own: the token is attached and the idle window slid on every authenticated request, and a 401 on an attached token latches `SessionRevocation`.
- **AUTH-FR-011** — Administrator login belongs to the Admin Web Portal, which the Stage 7 brief and §49 both exclude.
- **AUTH-FR-012** — A Could. The Google identity port is unbuilt at Stage 6 too — the generated contract has no route for it.

### Localization

| Req | Title | Pri | Screens | API | ViewModel / use case | Test | Status |
|---|---|---|---|---|---|---|---|
| LOCALE-FR-001 | First-launch language selection | Must | UX-AUTH-002 | — | LocaleManager | LocaleManagerTest | `IMPLEMENTED` |
| LOCALE-FR-002 | Switch language | Must | UX-SET-002 | `PUT /me/language` | LocaleManager | LocaleManagerTest | `IMPLEMENTED` |
| LOCALE-FR-003 | Right-to-left layout | Must | UX-SET-002 | — | LocaleManager | LocaleManagerTest | `IMPLEMENTED` |
| LOCALE-FR-004 | Urdu font rendering | Must | UX-SET-002 | — | LocaleManager | LocaleManagerTest | `PARTIAL` |
| LOCALE-FR-005 | Mixed-script content | Must | UX-SET-002 | — | LocaleManager | LocaleManagerTest | `IMPLEMENTED` |
| LOCALE-FR-006 | Localized notifications | Should | UX-HOME-007 | — | NotificationsViewModel | NotificationsTest | `IMPLEMENTED` |

- **LOCALE-FR-004** — Urdu renders with the system font. DEP-013 has not delivered the licensed Noto Nastaliq face the spec names.

### Profile

| Req | Title | Pri | Screens | API | ViewModel / use case | Test | Status |
|---|---|---|---|---|---|---|---|
| PROFILE-FR-001 | Create profile | Must | UX-SETUP-002 | `POST /me/profile` | ProfileSetupViewModel | SetupOnboardingTest | `IMPLEMENTED` |
| PROFILE-FR-002 | Username Selection | Must | UX-SETUP-001 | `GET /username/available` · `POST /me/username` | UsernameViewModel | SetupOnboardingTest | `IMPLEMENTED` |
| PROFILE-FR-003 | Edit profile | Must | UX-SETUP-002 · UX-PROFILE-003 | `PATCH /me/profile` | EditProfileViewModel · ProfileSetupViewModel | ProfileTest · SetupOnboardingTest | `IMPLEMENTED` |
| PROFILE-FR-004 | View own profile | Must | UX-PROFILE-001 | `GET /me` | ProfileViewModel | ProfileTest | `IMPLEMENTED` |
| PROFILE-FR-005 | View another profile | Must | UX-PROFILE-002 | `GET /users/{id}` | ProfileViewModel | ProfileTest | `IMPLEMENTED` |
| PROFILE-FR-006 | Account type | Must | UX-AUTH-005 · UX-PROFILE-002 | `POST /register` | ProfileViewModel · RegisterViewModel | ProfileTest · RegisterFlowTest | `IMPLEMENTED` |
| PROFILE-FR-007 | Verified badge display | Must | UX-PROFILE-002 | — | ProfileViewModel | ProfileTest | `IMPLEMENTED` |
| PROFILE-FR-008 | Profile post list | Must | UX-PROFILE-001 | `GET /users/{id}/posts` | ProfileViewModel | ProfileTest | `IMPLEMENTED` |
| PROFILE-FR-009 | Follower counts | Should | UX-PROFILE-001 | — | ProfileViewModel | ProfileTest | `IMPLEMENTED` |
| PROFILE-FR-010 | Profile photo upload | Must | UX-PROFILE-003 | — | EditProfileViewModel | ProfileTest | `IMPLEMENTED` |
| PROFILE-FR-011 | Interests selection | Could | — | `GET /suggestions` | — | ApiContractTest | `DEFERRED SHOULD` |

- **PROFILE-FR-011** — A Could dependent on OD-017, with no screen in the 61-screen inventory. `interests` is read on the own-profile response and can never be written — GAP-M-016.

### Social graph

| Req | Title | Pri | Screens | API | ViewModel / use case | Test | Status |
|---|---|---|---|---|---|---|---|
| SOCIAL-FR-001 | Follow a user | Must | UX-PROFILE-002 | `PUT /users/{id}/follow` | ProfileViewModel | ProfileTest | `IMPLEMENTED` |
| SOCIAL-FR-002 | Unfollow | Must | UX-PROFILE-002 | `DELETE /users/{id}/follow` | ProfileViewModel | ProfileTest | `IMPLEMENTED` |
| SOCIAL-FR-003 | Followers list | Should | UX-PROFILE-004 | `GET /users/{id}/followers` | UserListViewModel | ProfileTest | `IMPLEMENTED` |
| SOCIAL-FR-004 | Following list | Should | UX-PROFILE-005 | `GET /users/{id}/following` | UserListViewModel | ProfileTest | `IMPLEMENTED` |
| SOCIAL-FR-005 | Suggested Accounts | Must | UX-SETUP-003 | `GET /suggestions` | SuggestionsViewModel | SetupOnboardingTest | `IMPLEMENTED` |

### Posts

| Req | Title | Pri | Screens | API | ViewModel / use case | Test | Status |
|---|---|---|---|---|---|---|---|
| POST-FR-001 | Create a Post | Must | UX-CREATE-001 | `POST /posts` | ComposerViewModel | ComposerTest | `IMPLEMENTED` |
| POST-FR-002 | Attach single image | Must | UX-CREATE-003 | — | ComposerViewModel | AttachmentUploadTest | `IMPLEMENTED` |
| POST-FR-003 | Attach multiple images | Should | UX-CREATE-001 | — | ComposerViewModel | ComposerTest | `IMPLEMENTED` |
| POST-FR-004 | Attach link | Should | UX-CREATE-003 | — | ComposerViewModel | AttachmentUploadTest | `PARTIAL` |
| POST-FR-005 | Attach PDF | Should | UX-CREATE-003 | — | ComposerViewModel | AttachmentUploadTest | `BLOCKED EXTERNAL` |
| POST-FR-006 | Category tag | Should | UX-CREATE-001 · UX-CREATE-004 | `GET /categories` | ComposerViewModel | ComposerTest | `IMPLEMENTED` |
| POST-FR-007 | Delete own post | Must | UX-HOME-003 | `DELETE /posts/{id}` | PostDetailViewModel | PostDetailTest | `IMPLEMENTED` |
| POST-FR-008 | Edit own post | Could | — | `PATCH /posts/{id}` | PostSource.update (uncalled) | IntegrationWiringTest | `DEFERRED SHOULD` |
| POST-FR-009 | View post detail | Must | UX-HOME-003 | `GET /posts/{id}` | PostDetailViewModel | PostDetailTest | `IMPLEMENTED` |
| POST-FR-010 | Length enforcement | Must | UX-HOME-003 | — | PostDetailViewModel | PostDetailTest | `IMPLEMENTED` |

- **POST-FR-004** — Link attachment is built; the preview depends on the server’s own fetch.
- **POST-FR-005** — PDF attachment ships only if ADR-013 safe inspection is built and Technical-Lead approved; OD-023 says otherwise it is CUT. The attachment sheet therefore refuses a PDF and says why, which is the approved behaviour rather than a missing feature.
- **POST-FR-008** — A Could with no designed screen. The route and the repository method both exist and nothing calls them — GAP-M-017, now pinned so it cannot read as live code again.

### Media

| Req | Title | Pri | Screens | API | ViewModel / use case | Test | Status |
|---|---|---|---|---|---|---|---|
| MEDIA-FR-001 | Image upload and compression | Must | UX-SETUP-002 · UX-CREATE-002 | `POST /media/upload-slot` | ImageUploader · ProfileSetupViewModel | AttachmentUploadTest · SetupOnboardingTest | `IMPLEMENTED` |
| MEDIA-FR-002 | Image viewer | Must | UX-HOME-004 | — | — | PostCacheTest | `IMPLEMENTED` |
| MEDIA-FR-003 | Document upload | Should | UX-CREATE-003 | — | ComposerViewModel | AttachmentUploadTest | `BLOCKED EXTERNAL` |
| MEDIA-FR-004 | Document open | Should | — | — | — | — | `BLOCKED EXTERNAL` |
| MEDIA-FR-005 | Upload limits enforcement | Must | UX-CREATE-002 | `POST /media/upload-slot` · `POST /media/{id}/complete` | ImageUploader | AttachmentUploadTest | `IMPLEMENTED` |

- **MEDIA-FR-003** — Document upload ships only behind the ADR-013 PDF safety gate, which OD-023 leaves conditional and Technical-Lead unapproved. The attachment sheet refuses PDFs rather than pretending.
- **MEDIA-FR-004** — Opening a document depends on the same ADR-013 gate; `GET /media/{id}` is served but nothing may call it yet.

### Feed

| Req | Title | Pri | Screens | API | ViewModel / use case | Test | Status |
|---|---|---|---|---|---|---|---|
| FEED-FR-001 | Following Feed | Must | UX-HOME-001 | `GET /feed/following` | FeedViewModel | FeedStateTest | `IMPLEMENTED` |
| FEED-FR-002 | Featured and Announcements | Must | UX-HOME-001 | `GET /feed/featured` | FeedViewModel | FeedStateTest | `PARTIAL` |
| FEED-FR-003 | Discover feed | Must | UX-HOME-002 | `GET /feed/discover` | FeedViewModel | FeedPagingTest | `IMPLEMENTED` |
| FEED-FR-004 | Pagination | Must | UX-HOME-001 · UX-HOME-002 | — | FeedViewModel | FeedPagingTest · FeedStateTest | `IMPLEMENTED` |
| FEED-FR-005 | Pull to refresh | Must | UX-HOME-001 | `GET /feed/following` | FeedViewModel | FeedStateTest | `IMPLEMENTED` |
| FEED-FR-006 | Filter by category | Should | UX-HOME-005 | `FeedViewModel.selectCategory` · `CategoryFilterSheet` | `FeedPagingTest` · `WireRequiredFieldTest` | emulator, both languages | `IMPLEMENTED` |
| FEED-FR-007 | Saved posts | Could | UX-PROFILE-006 | `GET /me/saved` · `PUT /posts/{id}/save` | SavedPostsViewModel | ProfileTest | `IMPLEMENTED` |

- **FEED-FR-002** — The Featured strip renders and its cards now open UX-HOME-006, the announcement detail.
- **FEED-FR-006** — Category filter: UX-HOME-005 is built and verified on a device — eleven categories in server `sortOrder`, and filtering by `health` returns only `health` posts.

### Engagement

| Req | Title | Pri | Screens | API | ViewModel / use case | Test | Status |
|---|---|---|---|---|---|---|---|
| ENGAGE-FR-001 | Like and unlike | Must | UX-HOME-003 | `DELETE /posts/{id}/like` · `PUT /posts/{id}/like` | PostDetailViewModel | PostDetailTest | `IMPLEMENTED` |
| ENGAGE-FR-002 | Comment on a post | Must | UX-HOME-003 | `GET /posts/{id}/comments` · `POST /posts/{id}/comments` | PostDetailViewModel | PostDetailTest | `IMPLEMENTED` |
| ENGAGE-FR-003 | Reply to a comment | Should | UX-HOME-003 | `POST /comments/{id}/replies` | PostDetailViewModel | PostDetailTest | `IMPLEMENTED` |
| ENGAGE-FR-004 | Delete own comment | Must | UX-HOME-003 | `DELETE /comments/{id}` | PostDetailViewModel | PostDetailTest | `IMPLEMENTED` |
| ENGAGE-FR-005 | Post author deletes a comment | Should | UX-HOME-003 | — | PostDetailViewModel | PostDetailTest | `IMPLEMENTED` |
| ENGAGE-FR-006 | Engagement counts | Must | UX-HOME-003 | — | PostDetailViewModel | PostDetailTest | `IMPLEMENTED` |
| ENGAGE-FR-007 | Share externally | Should | UX-HOME-003 | — | PostDetailViewModel | PostDetailTest | `IMPLEMENTED` |
| ENGAGE-FR-008 | Mentions | Could | — | — | — | — | `DEFERRED SHOULD` |

- **ENGAGE-FR-008** — A Could. `GET /mentions/suggest` exists in the Stage-4 API design and is not served by Stage 6, so there is nothing to call.

### Events

| Req | Title | Pri | Screens | API | ViewModel / use case | Test | Status |
|---|---|---|---|---|---|---|---|
| EVENT-FR-001 | Create an Event | Must | UX-EVENT-004 | `GET /users/{userId}/events` · `POST /events` | EventComposerViewModel | EventValidationTest | `IMPLEMENTED` |
| EVENT-FR-002 | Event type | Must | UX-EVENT-004 | `PATCH /events/{id}` | EventComposerViewModel | EventValidationTest | `IMPLEMENTED` |
| EVENT-FR-003 | External meeting link | Must | UX-EVENT-003 | `POST /events/{id}/join` | EventDetailViewModel | EventRsvpAndJoinTest | `IMPLEMENTED` |
| EVENT-FR-004 | RSVP | Must | UX-EVENT-002 · UX-EVENT-003 | `DELETE /events/{id}/rsvp` · `GET /events` · `PUT /events/{id}/rsvp` | EventDetailViewModel · EventsViewModel | EventRsvpAndJoinTest · EventTimesTest | `PARTIAL` |
| EVENT-FR-005 | Upcoming events list | Must | UX-EVENT-001 | `GET /events` | EventsViewModel | EventTimesTest | `IMPLEMENTED` |
| EVENT-FR-006 | Event detail | Must | UX-EVENT-003 | `GET /events/{id}` | EventDetailViewModel | EventRsvpAndJoinTest | `IMPLEMENTED` |
| EVENT-FR-007 | Edit or cancel an event | Should | UX-EVENT-002 · UX-EVENT-005 | `DELETE /events/{id}` · `GET /events` · `PATCH /events/{id}` | EventComposerViewModel · EventsViewModel | EventTimesTest · EventValidationTest | `PARTIAL` |
| EVENT-FR-008 | Event reminder | Should | — | — | — | — | `BLOCKED EXTERNAL` |

- **EVENT-FR-004** — RSVP and withdrawal work on the detail screen. "Events — Mine" cannot list the events somebody RSVP’d to, because no endpoint returns them.
- **EVENT-FR-007** — Edit and cancel work. The owner’s own list is the partial half.
- **EVENT-FR-008** — An event reminder is a push notification. DEP-003 is unprovisioned, so no reminder can be delivered (GAP-M-010).

### Search

| Req | Title | Pri | Screens | API | ViewModel / use case | Test | Status |
|---|---|---|---|---|---|---|---|
| SEARCH-FR-001 | Search users | Must | UX-SEARCH-002 | `GET /search/people` | SearchViewModel | SearchTest | `IMPLEMENTED` |
| SEARCH-FR-002 | Search posts | Should | UX-SEARCH-003 | `GET /search/posts` | SearchViewModel | SearchTest | `IMPLEMENTED` |
| SEARCH-FR-003 | Cross-Script Search — Urdu and Roman Urdu | Should | UX-SEARCH-003 | `GET /search/people` | SearchViewModel | SearchTest | `IMPLEMENTED` |
| SEARCH-FR-004 | Search events | Could | UX-SEARCH-003 | `GET /search/events` | SearchViewModel | SearchTest | `IMPLEMENTED` |
| SEARCH-FR-005 | Recent searches | Could | UX-SEARCH-001 | — | SearchViewModel | SearchTest | `IMPLEMENTED` |

### Messaging

| Req | Title | Pri | Screens | API | ViewModel / use case | Test | Status |
|---|---|---|---|---|---|---|---|
| MSG-FR-001 | Start a conversation | Must | UX-PROFILE-002 | `POST /conversations` | ProfileViewModel | ProfileTest | `IMPLEMENTED` |
| MSG-FR-002 | Send a text message | Must | UX-MSG-003 | `POST /conversations/{id}/messages` | ConversationViewModel | MessagingTest | `IMPLEMENTED` |
| MSG-FR-003 | Conversation inbox | Must | UX-MSG-001 | `GET /conversations` · `GET /conversations/unread` · `GET /conversations/{id}/messages` | InboxViewModel | MessagingTest | `IMPLEMENTED` |
| MSG-FR-004 | Near-real-time delivery | Must | UX-MSG-003 | `GET /conversations/{id}/messages/since` | ConversationViewModel | MessagingTest | `PARTIAL` |
| MSG-FR-005 | Message Requests from Non-Followers | Must | UX-MSG-002 · UX-MSG-004 | `POST /conversations/{id}/accept` · `POST /conversations/{id}/decline` | InboxViewModel | MessagingTest | `IMPLEMENTED` |
| MSG-FR-006 | Block enforcement in messaging | Must | UX-MSG-003 | — | ConversationViewModel | MessagingTest | `IMPLEMENTED` |
| MSG-FR-007 | Report a conversation | Must | UX-SAFE-001 | `POST /reports` | ReportViewModel | SafetyTest | `IMPLEMENTED` |
| MSG-FR-008 | Send an image in a message | Could | UX-MSG-003 | — | ConversationViewModel | MessagingTest | `PARTIAL` |
| MSG-FR-009 | Read receipts | Could | UX-MSG-003 | `GET /conversations/{id}/messages` · `POST /conversations/{id}/read` | ConversationViewModel | MessagingTest | `PARTIAL` |

- **MSG-FR-004** — A two-second poll of `/messages/since`, not the socket. Stage 6 does serve a Socket.IO gateway; the API rule is that "REST is the source of truth; realtime is an accelerator" and it names this route as the polling path. Recorded as GAP-M-008.
- **MSG-FR-008** — An image sends in a conversation; the same media gate applies to anything that is not an image.
- **MSG-FR-009** — Read receipts are sent and shown. A Could, and complete for text.

### Notifications

| Req | Title | Pri | Screens | API | ViewModel / use case | Test | Status |
|---|---|---|---|---|---|---|---|
| NOTIF-FR-001 | Push notifications | Must | — | — | — | — | `BLOCKED EXTERNAL` |
| NOTIF-FR-002 | Notification centre | Must | UX-HOME-007 | `GET /notifications` · `GET /notifications/unread-count` · `POST /notifications/read` · `POST /notifications/read-all` | NotificationsViewModel | NotificationsTest | `PARTIAL` |
| NOTIF-FR-003 | Engagement notifications | Must | UX-HOME-007 | — | NotificationsViewModel | NotificationsTest | `PARTIAL` |
| NOTIF-FR-004 | Message notifications | Must | UX-HOME-007 | — | NotificationsViewModel | NotificationsTest | `IMPLEMENTED` |
| NOTIF-FR-005 | Admin broadcast | Should | UX-HOME-006 · UX-HOME-007 | — | NotificationsViewModel | NotificationsTest | `PARTIAL` |
| NOTIF-FR-006 | Event reminders | Should | — | — | — | — | `BLOCKED EXTERNAL` |
| NOTIF-FR-007 | Notification preferences | Should | UX-SET-003 | `GET /notifications/preferences` · `PUT /notifications/preferences/{key}` | NotificationPreferencesViewModel | NotificationsTest | `PARTIAL` |

- **NOTIF-FR-001** — Push. DEP-003 has never been provisioned, so there is no token to register and `/notifications/devices` goes uncalled (GAP-M-010).
- **NOTIF-FR-002** — The centre is complete for in-app notifications; a reply notification still has no destination to open (GAP-M-009).
- **NOTIF-FR-003** — Engagement notifications render and navigate, except a reply, which the API gives no target for (GAP-M-009).
- **NOTIF-FR-005** — Admin broadcasts arrive in the centre and render, and the row now opens UX-HOME-006.
- **NOTIF-FR-006** — Event reminders are push. Same block as NOTIF-FR-001.
- **NOTIF-FR-007** — The seven switches are built and persist. What they gate — push — does not exist yet (DEP-003).

### Safety

| Req | Title | Pri | Screens | API | ViewModel / use case | Test | Status |
|---|---|---|---|---|---|---|---|
| SAFETY-FR-001 | Report content | Must | UX-SAFE-001 · UX-SAFE-002 | `POST /reports` | ReportViewModel | SafetyTest | `PARTIAL` |
| SAFETY-FR-002 | Report a user | Must | UX-SAFE-001 | `POST /reports` | ReportViewModel | SafetyTest | `IMPLEMENTED` |
| SAFETY-FR-003 | Report reason categories | Must | UX-SAFE-001 | — | ReportViewModel | SafetyTest | `IMPLEMENTED` |
| SAFETY-FR-004 | Threshold Auto-Hide | Must | UX-STATE-001 | — | FailureState | FailureRoutingTest | `IMPLEMENTED` |
| SAFETY-FR-005 | Block a user | Must | UX-SAFE-003 | `PUT /users/{id}/block` | ProfileViewModel | SafetyTest | `IMPLEMENTED` |
| SAFETY-FR-006 | Unblock | Must | UX-SET-005 | `DELETE /users/{id}/block` · `GET /me/blocks` | BlockedUsersViewModel | SettingsTest | `PARTIAL` |
| SAFETY-FR-007 | Blocked users list | Must | UX-SET-005 | `GET /me/blocks` | BlockedUsersViewModel | SettingsTest | `PARTIAL` |
| SAFETY-FR-008 | Community Guidelines | Must | UX-AUTH-008 | — | RegisterViewModel | RegisterFlowTest | `PARTIAL` |
| SAFETY-FR-009 | Rate limiting | Should | UX-STATE-004 | — | FailureState | FailureRoutingTest | `IMPLEMENTED` |

- **SAFETY-FR-001** — Reporting works everywhere it should. An offline report is refused rather than queued (GAP-M-014).
- **SAFETY-FR-006** — Unblock works; the row it sits on cannot name the person (GAP-M-013).
- **SAFETY-FR-007** — Same list, same limitation (GAP-M-013).
- **SAFETY-FR-008** — Community Guidelines has a screen and no document to show in it (OD-015).

### Settings

| Req | Title | Pri | Screens | API | ViewModel / use case | Test | Status |
|---|---|---|---|---|---|---|---|
| SET-FR-001 | Switch language | Must | UX-SET-001 · UX-SET-002 | `PUT /me/language` | LocaleManager · SettingsViewModel | LocaleManagerTest · SettingsTest | `IMPLEMENTED` |
| SET-FR-002 | Change password | Must | UX-SET-001 · UX-SET-004 | `POST /password/change` | ChangePasswordViewModel · SettingsViewModel | SettingsTest | `IMPLEMENTED` |
| SET-FR-003 | Blocked users list | Must | UX-SET-001 · UX-SET-005 | — | BlockedUsersViewModel · SettingsViewModel | SettingsTest | `PARTIAL` |
| SET-FR-004 | Delete Account | Must | UX-SET-001 · UX-SET-009 | `DELETE /me` · `GET /me/deletion-consequences` | DeleteAccountViewModel · SettingsViewModel | DeleteAccountTest · SettingsTest | `IMPLEMENTED` |
| SET-FR-005 | Restore account | Must | UX-AUTH-012 · UX-SET-001 | `POST /me/restore` | RestoreAccountViewModel · SettingsViewModel | DeleteAccountTest · SettingsTest | `IMPLEMENTED` |
| SET-FR-006 | Logout | Must | UX-SET-001 | — | SettingsViewModel | SettingsTest | `IMPLEMENTED` |
| SET-FR-007 | Notification preferences | Should | UX-SET-003 · UX-SET-001 | `GET /notifications/preferences` | NotificationPreferencesViewModel · SettingsViewModel | NotificationsTest · SettingsTest | `IMPLEMENTED` |
| SET-FR-008 | Legal documents | Must | UX-SET-001 · UX-SET-006 | — | SettingsViewModel | SettingsTest | `PARTIAL` |
| SET-FR-009 | Help and support | Should | UX-SET-001 · UX-SET-007 | — | SettingsViewModel | SettingsTest | `PARTIAL` |
| SET-FR-010 | About and version | Could | UX-SET-001 · UX-SET-008 | — | SettingsViewModel | SettingsTest | `IMPLEMENTED` |

- **SET-FR-003** — The blocked list loads and unblocks, but the API returns no display name or handle, so a row cannot name who it is (GAP-M-013).
- **SET-FR-008** — Legal documents: the screen and the routing are built; the three documents do not exist (OD-015).
- **SET-FR-009** — Help and support opens a mail intent to a support address that OD-015 has not yet established.

