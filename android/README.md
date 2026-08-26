# Lumina Android

Native Android client built with Kotlin and Jetpack Compose.

## Current module

- Email/password sign in
- Email/password registration
- Persistent Supabase session restoration
- Native auth deep-link handling through `lumina://auth`
- Sign out
- Authenticated home overview from the existing Edge Function
- Daily metrics, seven-day learning orbit and routine steps
- Home refresh, date selection and official-library/mode selection
- Native Home/Library navigation
- Official library progress for all eight built-in libraries
- Learning-group list, group detail and word-memory detail
- Start or resume official-library learning from Home and Library
- Native Round 1 word confirmation with rich word details
- Native Round 2 four-choice recall with answer reveal
- Native Round 3 spelling recall with incorrect-word requeue
- Server-synced learning checkpoints and round completion
- Round 2/3 attempt persistence to the shared review history
- Native due-review queue with the same 100-word daily cap
- Review spelling, answer reveal, unknown and direct-mastered actions
- Incorrect-review requeue and final memory-state summary
- Review completion synced to today's routine
- Native learning preferences synced through the shared API
- Pronunciation, autoplay, feedback timing, Round 2/3 and memory-tip settings
- Native word-audio playback with locale, speed, repeat-count and gap preferences
- Automatic Round 1/2 pronunciation and answer-feedback timing
- Learning cards respect the memory-tip visibility preference
- Native word lookup sheet with pronunciation, definitions and memory state
- Add or remove new words from the personal saved-word library
- Browse saved words and create a 30-word personal learning group in save order
- Native IELTS dashboard with real reading/listening catalogs, progress and recent attempts
- Native IELTS Reading exam with passages, figures, all question families, timer, submission and review
- Native IELTS Listening exam with section audio, paper previews, answers, submission and review

The Android client uses the same Supabase project and user data as the web app.

## Local configuration

The build reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from the
repository root `.env` file by default.

To override those values, copy `local.properties.example` to
`android/local.properties` and fill in:

```properties
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
API_BASE_URL=https://your-project.supabase.co/functions/v1/api
```

Email confirmation currently returns through `https://lumina.college/auth`, so
registration works with the existing production allow list. To return directly
to the Android app for future OAuth and password recovery, add `lumina://auth`
to the allowed redirect URLs in Supabase Auth.

## Build

```bash
cd android
./gradlew test
./gradlew assembleDebug
```
