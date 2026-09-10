package org.shehersaaz.mohalla

import java.io.File
import java.lang.reflect.Type
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.serializer
import org.junit.Assert.assertTrue
import org.junit.Test
import org.shehersaaz.mohalla.core.network.MohallaJson

/** Uses generated, sanitized backend specimens and the production serializers. */
class LiveContractTest {
    @OptIn(ExperimentalSerializationApi::class)
    @Test
    fun `typed Android request fields match generated backend validators`() {
        val source = File("src/main/java/org/shehersaaz/mohalla/core/network/MohallaApi.kt").readText()
            .replace(Regex("""@HTTP\(method = "(\w+)", path = "([^"]+)", hasBody = true\)"""), "@$1(\"$2\")")
        val spec = MohallaJson.parseToJsonElement(File("../../../docs/architecture/contracts/openapi-stage6-generated.json").readText()).jsonObject
        val paths = spec.getValue("paths").jsonObject
        val schemas = spec.getValue("components").jsonObject.getValue("schemas").jsonObject
        val errors = mutableListOf<String>()
        var checked = 0
        val normalize = { path: String -> path.replace(Regex("""\{[^}]+}"""), "{}") }
        val methods = Regex("""@(GET|POST|PUT|PATCH|DELETE)\("([^"]+)"\)[\s\S]*?suspend fun \w+\(([\s\S]*?)\): Response<\w+>""").findAll(source)
        for (method in methods) {
            val bodyType = Regex("""@Body\s+\w+:\s*(\w+)""").find(method.groupValues[3])?.groupValues?.get(1) ?: continue
            if (bodyType == "JsonObject") continue // Deliberate three-state PATCH builders.
            val route = "/" + method.groupValues[2]
            val server = paths.entries.firstOrNull { normalize(it.key) == normalize(route) }
                ?.value?.jsonObject?.get(method.groupValues[1].lowercase())?.jsonObject
            val ref = server?.get("requestBody")?.jsonObject?.get("content")?.jsonObject
                ?.get("application/json")?.jsonObject?.get("schema")?.jsonObject?.get("\$ref")?.jsonPrimitive?.content
            val schema = ref?.substringAfterLast('/')?.let { schemas[it]?.jsonObject }
            if (schema == null) {
                errors.add("${method.groupValues[1]} $route has no generated body schema")
                continue
            }
            val descriptor = serializer(Class.forName("org.shehersaaz.mohalla.core.network.$bodyType") as Type).descriptor
            val fields = (0 until descriptor.elementsCount).map(descriptor::getElementName).toSet()
            val properties = schema.getValue("properties").jsonObject.keys
            val required = (schema["required"] as? JsonArray)?.map { it.jsonPrimitive.content }?.toSet() ?: emptySet()
            if (!fields.containsAll(required)) errors.add("$bodyType misses required fields ${required - fields}")
            if (!properties.containsAll(fields)) errors.add("$bodyType sends unknown fields ${fields - properties}")
            checked++
        }
        assertTrue("Typed request guard exercised only $checked bodies", checked >= 20)
        assertTrue(errors.joinToString("\n"), errors.isEmpty())
    }

    @OptIn(ExperimentalSerializationApi::class)
    @Test
    fun `real HTTP response bodies decode with the production Android serializers`() {
        val specimens = File(System.getenv("MOHALLA_CONTRACT_FIXTURES")
            ?: "../../../packages/contracts/fixtures/http-responses.json")
        assertTrue("Generate backend contract specimens before running this test", specimens.isFile)
        val source = File("src/main/java/org/shehersaaz/mohalla/core/network/MohallaApi.kt").readText()
        val normalizedSource = source.replace(
            Regex("""@HTTP\(method = "(\w+)", path = "([^"]+)", hasBody = true\)"""),
            "@$1(\"$2\")",
        )
        val routes = Regex("""@(GET|POST|PUT|PATCH|DELETE)\("([^"]+)"\)[\s\S]*?suspend fun \w+\([\s\S]*?\): Response<(\w+)>""")
            .findAll(normalizedSource).map { match ->
                val path = "/" + match.groupValues[2]
                Triple(match.groupValues[1], Regex("^" + path.replace(Regex("""\{[^}]+}"""), "[^/]+") + "$"), match.groupValues[3])
            }.toList()
        val errors = mutableListOf<String>()
        var decoded = 0
        val covered = mutableSetOf<String>()
        val samples = MohallaJson.parseToJsonElement(specimens.readText()) as JsonArray
        for (sample in samples) {
            val row = sample.jsonObject
            val method = row.getValue("method").jsonPrimitive.content
            val path = row.getValue("path").jsonPrimitive.content
            val route = routes.firstOrNull { it.first == method && it.second.matches(path) } ?: continue
            val name = route.third
            if (name == "Unit") continue
            try {
                val type: Type = Class.forName("org.shehersaaz.mohalla.core.network.$name")
                MohallaJson.decodeFromJsonElement(serializer(type), row.getValue("body"))
                decoded++
                covered.add(name)
            } catch (error: Exception) {
                // No body, token, identifier or error message is printed.
                errors.add("$method ${route.second.pattern}: $name ${error.javaClass.simpleName}")
            }
        }
        println("Production serializers decoded $decoded responses across ${covered.size} types")
        assertTrue("Too few production response types exercised: ${covered.size}", covered.size >= 38)
        assertTrue(errors.distinct().joinToString("\n"), errors.isEmpty())
    }
}
