plugins {
    // AGP 9.0+ has built-in Kotlin support. The separate
    // `org.jetbrains.kotlin.android` plugin is no longer required and AGP now
    // fails the build if it is applied alongside.
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.google.services)
}

android {
    namespace = "org.shehersaaz.mohalla"

    // Pinned in docs/foundation/04-toolchain-versions.md.
    //
    // Compose BOM 2026.08.00 resolves Compose 1.12.0, whose AAR metadata
    // REQUIRES consumers to compile against API 37 or later. compileSdk 36
    // fails `checkDebugAarMetadata` with 11 issues. This is a hard dependency
    // constraint, not a preference.
    //
    // 37.2 and 37.1 are also published; 37.0 is chosen as the lowest release
    // that satisfies the constraint, and 37.2-beta* are excluded as pre-release.
    compileSdk = 37

    defaultConfig {
        applicationId = "org.shehersaaz.mohalla"

        // API 26+ is an approved Stage 4 constraint, not a preference.
        minSdk = 26
        // targetSdk tracks compileSdk. Raising it opts into new runtime
        // behaviour, which is reviewed per release rather than assumed safe -
        // but leaving it behind compileSdk on a foundation with no runtime
        // behaviour to break has no benefit.
        targetSdk = 37

        versionCode = 1
        versionName = "0.0.1-foundation"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

    }

    buildTypes {
        debug {
            isMinifyEnabled = false
            // 10.0.2.2 is the host loopback as seen from the Android emulator.
            buildConfigField("String", "API_BASE_URL", "\"http://10.0.2.2:3000\"")
            // OD-015 is unresolved: no Terms document has been published, so
            // there is no version to name. A debug build records this literal
            // so the value in the registration audit trail says exactly what
            // was accepted - nothing - rather than a plausible-looking version
            // string that would imply a document existed. The release gate
            // below refuses to build without a real one.
            buildConfigField("String", "TERMS_VERSION", "\"unpublished-od-015\"")
            // §42 - the host this app claims links for. `mohalla.invalid`
            // is reserved by RFC 2606 and can never resolve, so a debug
            // build cannot accidentally open a link belonging to somebody
            // who registered a plausible name. DEP-007 supplies the real
            // one; until then the resolver works and the filters match
            // nothing anybody can send.
            buildConfigField("String", "APP_HOST", "\"mohalla.invalid\"")
            manifestPlaceholders["appHost"] = "mohalla.invalid"
            buildConfigField("String", "SUPPORT_EMAIL", "\"\"")
        }
        release {
            // Signing config is deliberately absent. Release signing keys are
            // never committed and are not part of the Stage 5 foundation.
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // Overridden per real environment at release time; never a real host in source.
            buildConfigField("String", "API_BASE_URL", "\"https://api.invalid\"")
            // Deliberately EMPTY, which makes registration fail closed in a
            // release build until a Terms document is published and its
            // version supplied here. `RegisterViewModel` refuses to submit an
            // empty version, so a release APK cannot record an acceptance of a
            // document that does not exist (OD-015).
            buildConfigField("String", "TERMS_VERSION", "\"\"")
            // §42 - DEP-007's domain has not been provisioned, so there is no
            // host this build can claim. Empty rather than a guess: the
            // resolver refuses every link when the host is blank, and an
            // `autoVerify` filter for a domain we do not control would either
            // fail verification or, worse, succeed for somebody else's.
            buildConfigField("String", "APP_HOST", "\"\"")
            manifestPlaceholders["appHost"] = "mohalla.invalid"
            // SET-FR-009 asks for "a working support contact". None has
            // been published, so this is empty and the Help screen says so
            // rather than mailing an address nobody reads - which matters
            // most because this is also the suspension appeal channel.
            buildConfigField("String", "SUPPORT_EMAIL", "\"\"")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }

    androidResources {
        // Urdu and English are peers. Declaring both keeps Play's language list
        // honest and stops resource shrinking from dropping Urdu.
        localeFilters += setOf("en", "ur")
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
}

// The localization / RTL gate reads resource files and the manifest at RUNTIME,
// through relative File paths. Gradle cannot infer that, so without this block
// it treats `testDebugUnitTest` as UP-TO-DATE when only those files change -
// and the gate is silently skipped at exactly the moment it matters: when a
// string or the manifest was edited.
//
// This was found by negative test, not by review: deleting an Urdu string and
// setting supportsRtl="false" produced a PASSING build until the inputs were
// declared here.
tasks.withType<Test>().configureEach {
    inputs
        .files(
            fileTree("src/main/res") { include("values*/strings.xml") },
            file("src/main/AndroidManifest.xml"),
            file(System.getenv("MOHALLA_CONTRACT_FIXTURES")
                ?: "../../../packages/contracts/fixtures/http-responses.json"),
            file("src/main/java/org/shehersaaz/mohalla/core/network/MohallaApi.kt"),
        )
        .withPathSensitivity(PathSensitivity.RELATIVE)
        .withPropertyName("localizationGateInputs")
}

java {
    // Declare the JDK the build needs rather than inheriting whatever is on
    // PATH, so the build is reproducible across machines and CI.
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

dependencies {
    // QA-009 / NOTIF-FR-001. The BOM pins the Firebase artifacts together, so
    // firebase-messaging is declared without a version of its own.
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.material.icons)
    implementation(libs.kotlinx.coroutines.android)

    // ---- Stage 7 ---------------------------------------------------------
    // Each of these is named by the frozen mobile architecture
    // (04-mobile-architecture.md §2, §4). Nothing here is a preference.
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    // `LocalLifecycleOwner`, which the conversation screen ties its poll to.
    // DECLARED EXPLICITLY even though navigation-compose happens to bring it in
    // transitively: an implicit compile dependency is one version bump away
    // from disappearing, and the compose-ui copy of that composition local is
    // deprecated in favour of this one.
    implementation(libs.androidx.lifecycle.runtime.compose)
    // SEC-004: session tokens in EncryptedSharedPreferences backed by Keystore.
    implementation(libs.androidx.security.crypto)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.retrofit)
    implementation(libs.retrofit.serialization)
    implementation(libs.okhttp)
    implementation(libs.coil.compose)

    debugImplementation(libs.androidx.ui.tooling)
    debugImplementation(libs.androidx.ui.test.manifest)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.ui.test.junit4)
}
