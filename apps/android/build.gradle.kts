// Top-level build file.
//
// STAGE 5 FOUNDATION. No product feature is implemented in this project.

plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.compose) apply false
    // QA-009. Declared here, applied in :app — the Google Services plugin reads
    // google-services.json, which is git-ignored and supplied per environment.
    alias(libs.plugins.google.services) apply false
}
