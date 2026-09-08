package org.shehersaaz.mohalla

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.shehersaaz.mohalla.core.network.CategoriesResponse
import org.shehersaaz.mohalla.core.network.CategoryResponse
import org.shehersaaz.mohalla.core.network.MohallaJson

/**
 * A required field the server does not send is a feature that never worked.
 *
 * THIS IS THE THIRD INSTANCE OF ONE PATTERN in Stage 7, and the reason it keeps
 * happening is that nothing could see it:
 *
 *   - group 12: `MessagesResponse.nextCursor` was typed as the EVENTS cursor,
 *     whose field is `cursorStartsAt`. Paging broke past thirty messages.
 *   - group 14: PATCH bodies could not express a JSON null, so clearing a bio
 *     was impossible.
 *   - here: `CategoryResponse.id` was a **required** `String` and
 *     `GET /categories` has never sent one. Every fetch threw
 *     `MissingFieldException`, the composer swallowed it into an empty list,
 *     and **POST-FR-006's category picker had therefore never worked** — it
 *     opened onto nothing, silently. Nothing in the app read `id` at all.
 *
 * `ApiContractTest` CANNOT CATCH ANY OF THEM, and says so in its own comment:
 * the generated OpenAPI contract has `components.schemas` empty, so it proves a
 * route exists and never that a field does. That gap is where all three lived.
 *
 * SO THIS TEST DECODES A REAL RESPONSE BODY. Not a hand-written fixture that
 * would drift, and not a schema that does not exist — a captured body, checked
 * into the repository beside the contract it came from, decoded through the
 * app's own `MohallaJson`. A required field the server omits fails here, at the
 * decode, exactly as it fails on a device.
 *
 * THE CAPTURE IS SYNTHETIC AND SMALL. Two of BR-017's eleven rows, taken from
 * the local development API, containing nothing but category names.
 */
class WireRequiredFieldTest {

    /**
     * A real `GET /categories` body, as the local Stage 6 API returns it.
     *
     * Note what is NOT here: `id`. That absence is the whole point of the file.
     */
    private val categoriesBody = """
        {
          "categories": [
            {
              "slug": "water-sanitation",
              "nameEn": "Water & Sanitation",
              "nameUr": "پانی اور صفائی",
              "sortOrder": 5
            },
            {
              "slug": "general",
              "nameEn": "General",
              "nameUr": "عمومی",
              "sortOrder": 11
            }
          ]
        }
    """.trimIndent()

    @Test
    fun `THE REAL CATEGORIES BODY DECODES`() {
        // The assertion the defect failed. Before the fix this threw
        // MissingFieldException on `id`, and every category list in the app was
        // silently empty as a result.
        val decoded = MohallaJson.decodeFromString<CategoriesResponse>(categoriesBody)

        assertEquals(2, decoded.categories.size)
        assertEquals("water-sanitation", decoded.categories.first().slug)
        assertEquals("Water & Sanitation", decoded.categories.first().nameEn)
        assertEquals("پانی اور صفائی", decoded.categories.first().nameUr)
        assertEquals(5, decoded.categories.first().sortOrder)
    }

    @Test
    fun `CategoryResponse DECLARES NOTHING THE SERVER DOES NOT SEND`() {
        // AN EXACT SET, not a denylist — the lesson group 11 paid for. And it
        // is checked against the keys of the real body above rather than a list
        // typed twice, so the two cannot drift apart.
        val sent = Json.parseToJsonElement(categoriesBody)
            .jsonObject["categories"]!!
            .let { (it as kotlinx.serialization.json.JsonArray).first() }
            .jsonObject
            .keys

        assertExactFields(
            type = CategoryResponse::class.java,
            expected = sent,
            because = "a field this type declares and the server never sends is either " +
                "a required field that breaks every decode, or a nullable field that " +
                "is always null - and `id` was the first kind for the whole of Stage 7",
        )
    }

    @Test
    fun `A MISSING OPTIONAL FIELD IS STILL FINE`() {
        // The server is entitled to omit `sortOrder` or a name, and a client
        // that broke on that would be brittle in the other direction.
        val decoded = MohallaJson.decodeFromString<CategoriesResponse>(
            """{"categories":[{"slug":"general"}]}""",
        )

        assertEquals("general", decoded.categories.single().slug)
        assertEquals(null, decoded.categories.single().nameEn)
        assertEquals(null, decoded.categories.single().sortOrder)
    }

    @Test
    fun `EVERY REQUIRED WIRE FIELD IS ONE THE SERVER ALWAYS SENDS`() {
        // AN ALLOWLIST, NOT A BAN — and the distinction is the whole point.
        //
        // A required field is a RISK, not automatically a defect. The server is
        // a separate deployable that can add, rename or drop a field between
        // releases, and a required one turns any of those into a crash or a
        // silently empty list. But defaulting everything is worse in the other
        // direction: a `PostResponse` whose `id` quietly became `""` would send
        // a screen looking for a post that cannot exist, and hide a real server
        // fault behind a blank.
        //
        // So the rule is that each required field is a claim somebody made on
        // the record: *the server always sends this*. The 43 below are those
        // claims. A NEW one fails this test until it is added here — which is
        // the moment to go and check the actual response body, because that is
        // the check nobody made for `CategoryResponse.id` and it cost
        // POST-FR-006 the whole of Stage 7.
        //
        // `CategoryResponse.slug` is on the list deliberately: it is the
        // identity the rest of the app already keys on, and every response
        // carries it. `id` is gone, because no response ever carried that.
        val claimed = setOf(
            "BlockEntryResponse.blockedUserId",
            "BlockEntryResponse.createdAt",
            "CancelEventResponse.outcome",
            "CategoryResponse.slug",
            "CommentResponse.author",
            "CommentResponse.body",
            "CommentResponse.createdAt",
            "CommentResponse.id",
            "CommentResponse.postId",
            "ConversationResponse.conversationId",
            "ConversationResponse.otherUserId",
            "CursorCreatedAtResponse.cursorCreatedAt",
            "CursorCreatedAtResponse.cursorId",
            "EventCursorResponse.cursorId",
            "EventCursorResponse.cursorStartsAt",
            "EventResponse.creatorId",
            "EventResponse.description",
            "EventResponse.eventType",
            "EventResponse.id",
            "EventResponse.startsAt",
            "EventResponse.status",
            "EventResponse.title",
            "FeaturedItemResponse.body",
            "FeaturedItemResponse.id",
            "FeaturedItemResponse.title",
            "FeedCursorResponse.createdAt",
            "FeedCursorResponse.id",
            "FeedItemResponse.author",
            "FeedItemResponse.body",
            "FeedItemResponse.id",
            "JoinEventResponse.meetingUrl",
            "MessageResponse.conversationId",
            "MessageResponse.createdAt",
            "MessageResponse.id",
            "MessageResponse.senderId",
            "NotificationResponse.id",
            "OwnProfileResponse.userId",
            "PostResponse.author",
            "PostResponse.body",
            "PostResponse.id",
            "PublicProfileResponse.userId",
            "UploadSlotResponse.mediaId",
            "UploadSlotResponse.upload",
        )

        val api = File("src/main/java/org/shehersaaz/mohalla/core/network/MohallaApi.kt")
        assertTrue("MohallaApi.kt must be readable", api.isFile)

        val actual = mutableListOf<String>()
        Regex(
            """@Serializable\s*\ndata class (\w*Response)\(([^)]*)\)""",
            RegexOption.DOT_MATCHES_ALL,
        ).findAll(api.readText()).forEach { match ->
            val name = match.groupValues[1]
            match.groupValues[2].split('\n').forEach { line ->
                val field = Regex("""^\s*val (\w+):\s*([^=,]+),?\s*$""").find(line)
                    ?: return@forEach
                if (!line.contains('=')) actual += "$name.${field.groupValues[1]}"
            }
        }

        val added = (actual.toSet() - claimed).sorted()
        val gone = (claimed - actual.toSet()).sorted()

        assertEquals(
            "NEW required response fields. Each one asserts that the server " +
                "always sends it - go and read an actual response body before " +
                "adding it here, because that is the check nobody did for " +
                "CategoryResponse.id:\n" +
                added.joinToString("\n") { "    $it" } + "\n",
            emptyList<String>(),
            added,
        )

        assertEquals(
            "These required fields are gone. If a field became optional that " +
                "is good news - remove it from this list:\n" +
                gone.joinToString("\n") { "    $it" } + "\n",
            emptyList<String>(),
            gone,
        )
    }
}
