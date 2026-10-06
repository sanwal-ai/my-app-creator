plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

fun prop(name: String, fallback: String): String =
    (project.findProperty(name) as String?)
        ?.trim()
        ?.takeIf { it.isNotBlank() }
        ?: fallback

fun quoted(value: String): String =
    "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

val dynamicAppId = prop("APP_PACKAGE", "com.myappcreator.client")
val dynamicAppName = prop("APP_NAME", "My App Creator")
val dynamicVersionName = prop("APP_VERSION", "1.0.0")
val dynamicVersionCode = prop("APP_VERSION_CODE", "1").toIntOrNull()?.coerceAtLeast(1) ?: 1
val appDocumentId = prop("APP_ID", "1791224204585")

val firebaseApiKey = prop("FIREBASE_API_KEY", "")
val firebaseProjectId = prop("FIREBASE_PROJECT_ID", "myappcreator-2bd13")
val firebaseApplicationId = prop("FIREBASE_APPLICATION_ID", "1:98660702874:android:dynamic")

android {
    namespace = "com.myappcreator.client"
    compileSdk = 35

    defaultConfig {
        applicationId = dynamicAppId
        minSdk = 24
        targetSdk = 35
        versionCode = dynamicVersionCode
        versionName = dynamicVersionName

        manifestPlaceholders["appName"] = dynamicAppName

        buildConfigField("String", "APP_DOCUMENT_ID", quoted(appDocumentId))
        buildConfigField("String", "FIREBASE_API_KEY", quoted(firebaseApiKey))
        buildConfigField("String", "FIREBASE_PROJECT_ID", quoted(firebaseProjectId))
        buildConfigField("String", "FIREBASE_APPLICATION_ID", quoted(firebaseApplicationId))
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation(platform("com.google.firebase:firebase-bom:33.7.0"))
    implementation("com.google.firebase:firebase-firestore")

    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
}
