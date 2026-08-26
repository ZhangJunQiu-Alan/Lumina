import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

fun parseEnvFile(file: File): Map<String, String> {
    if (!file.exists()) return emptyMap()

    return file.readLines()
        .map(String::trim)
        .filter { it.isNotEmpty() && !it.startsWith("#") && it.contains("=") }
        .associate { line ->
            val separator = line.indexOf('=')
            val key = line.substring(0, separator).trim()
            val value = line.substring(separator + 1).trim().removeSurrounding("\"").removeSurrounding("'")
            key to value
        }
}

fun String.asBuildConfigString(): String =
    "\"${replace("\\", "\\\\").replace("\"", "\\\"")}\""

val localProperties = Properties().apply {
    val localPropertiesFile = rootProject.file("local.properties")
    if (localPropertiesFile.exists()) {
        localPropertiesFile.inputStream().use(::load)
    }
}
val repositoryEnv = parseEnvFile(rootProject.file("../.env"))
val supabaseUrl =
    localProperties.getProperty("SUPABASE_URL")
        ?: repositoryEnv["VITE_SUPABASE_URL"]
        ?: ""
val supabasePublishableKey =
    localProperties.getProperty("SUPABASE_PUBLISHABLE_KEY")
        ?: repositoryEnv["VITE_SUPABASE_PUBLISHABLE_KEY"]
        ?: ""
val apiBaseUrl =
    localProperties.getProperty("API_BASE_URL")
        ?: repositoryEnv["VITE_API_BASE_URL"]
        ?: supabaseUrl
            .takeIf(String::isNotBlank)
            ?.trimEnd('/')
            ?.let { "$it/functions/v1/api" }
        ?: ""

android {
    namespace = "college.lumina.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "college.lumina.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        buildConfigField("String", "SUPABASE_URL", supabaseUrl.asBuildConfigString())
        buildConfigField(
            "String",
            "SUPABASE_PUBLISHABLE_KEY",
            supabasePublishableKey.asBuildConfigString(),
        )
        buildConfigField("String", "API_BASE_URL", apiBaseUrl.asBuildConfigString())
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
        compose = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    debugImplementation(libs.androidx.compose.ui.tooling)

    implementation(platform(libs.supabase.bom))
    implementation(libs.supabase.auth)
    implementation(libs.ktor.client.android)
    implementation(libs.kotlinx.serialization.json)

    testImplementation(libs.junit)
    testImplementation(libs.ktor.client.mock)
    testImplementation(libs.kotlinx.coroutines.test)
}
