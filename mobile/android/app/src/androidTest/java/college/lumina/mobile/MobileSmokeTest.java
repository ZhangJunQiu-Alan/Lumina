package college.lumina.mobile;

import android.os.SystemClock;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class MobileSmokeTest {
    private android.webkit.WebView findWebView(android.view.View view) {
        if (view instanceof android.webkit.WebView) return (android.webkit.WebView) view;
        if (view instanceof android.view.ViewGroup) {
            android.view.ViewGroup group = (android.view.ViewGroup) view;
            for (int index = 0; index < group.getChildCount(); index++) {
                android.webkit.WebView found = findWebView(group.getChildAt(index));
                if (found != null) return found;
            }
        }
        return null;
    }

    private String evaluate(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        scenario.onActivity(activity -> findWebView(activity.findViewById(android.R.id.content)).evaluateJavascript(script, value -> {
            result.set(value);
            latch.countDown();
        }));
        assertTrue("WebView did not respond", latch.await(10, TimeUnit.SECONDS));
        return result.get();
    }

    private void awaitTrue(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 30000;
        while (SystemClock.elapsedRealtime() < deadline) {
            if ("true".equals(evaluate(scenario, script))) return;
            SystemClock.sleep(200);
        }
        fail("WebView condition timed out: " + script);
    }

    @Test public void nativeBundleAndPersistentStorage() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitTrue(scenario, "document.getElementById('root')?.innerText.length > 20");
            assertEquals("\"https://localhost\"", evaluate(scenario, "location.origin"));
            assertEquals("true", evaluate(scenario, "window.Capacitor.isNativePlatform()"));
            evaluate(scenario, "localStorage.setItem('lumina.qa.upgrade-marker', JSON.stringify({answer:'preserved',owner:'qa'})); true");
            scenario.recreate();
            awaitTrue(scenario, "document.getElementById('root')?.innerText.length > 20");
            assertEquals("\"preserved\"", evaluate(scenario, "JSON.parse(localStorage.getItem('lumina.qa.upgrade-marker')).answer"));
        }
    }

    private String fixtureSession() throws Exception {
        try (java.io.InputStream input = InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("private-session.json")) {
            java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int length;
            while ((length = input.read(buffer)) != -1) bytes.write(buffer, 0, length);
            return new String(bytes.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    @Test public void authenticatedRoutes() throws Exception {
        String session = fixtureSession();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitTrue(scenario, "document.getElementById('root')?.innerText.length > 20");
            evaluate(scenario, "localStorage.setItem('lumina.localAuth.session'," + JSONObject.quote(session) + "); location.href='/app/home'; true");
            awaitTrue(scenario, "location.pathname === '/app/home' && Boolean(document.querySelector('main'))");
            String[] routes = {"/app/library", "/app/import", "/app/ielts", "/app/ielts-reading", "/app/notebook", "/app/profile", "/app/settings"};
            for (String route : routes) {
                evaluate(scenario, "history.pushState({},''," + JSONObject.quote(route) + "); window.dispatchEvent(new PopStateEvent('popstate')); true");
                awaitTrue(scenario, "location.pathname === " + JSONObject.quote(route) + " && document.querySelector('main')?.innerText.length > 10");
                assertEquals("false", evaluate(scenario, "document.body.innerText.includes('这页刚才出错了')"));
            }
        }
    }

    @Test public void reviewAndDraftRecoverAfterRestart() throws Exception {
        String session = fixtureSession();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitTrue(scenario, "document.getElementById('root')?.innerText.length > 20");
            evaluate(scenario, "localStorage.setItem('lumina.localAuth.session'," + JSONObject.quote(session) + "); true");
            evaluate(scenario, """
                (() => {
                  const userId = JSON.parse(localStorage.getItem('lumina.localAuth.session')).user.id;
                  const word = { id: 'native-recovery-word', word: 'daily', phonetic: '/deili/', ipa_uk: '/deili/', ipa_us: '/deili/', pos_tags: ['adj'], ner_entities: [], chinese_definition: '每日的', senses: [{pos:'adj',meaning_zh:'每日的',example_sentence:'I read daily.',example_translation_zh:'我每天阅读。'}], example_sentences: ['I read daily.'], morphology: {summaryZh:'',parts:[]}, derivedWords:[], synonyms:[], antonyms:[], confusingPairs:[], round2ChoiceDistractors:[], memory_tip:'', audio_uk_url:null, audio_us_url:null };
                  localStorage.setItem('lumina.review-recovery.v1.' + userId, JSON.stringify({runId:'native-test', words:[word],currentIndex:0,passedQueueIndices:[]}));
                  localStorage.setItem('lumina.last-session-mode.v1.' + userId, JSON.stringify('review'));
                  localStorage.setItem('lumina.last-route.v1.' + userId, JSON.stringify('/app/session'));
                  localStorage.setItem('lumina.input.v1.' + userId + '.native-test.review.0.native-recovery-word', JSON.stringify({input:'dai',showAnswer:false,choice:null}));
                  location.href='/app/session';
                  return true;
                })()
                """);
            awaitTrue(scenario, "location.pathname === '/app/session' && [...document.querySelectorAll('input')].some(input => input.value === 'dai')");
            scenario.recreate();
            awaitTrue(scenario, "location.pathname === '/app/session' && [...document.querySelectorAll('input')].some(input => input.value === 'dai')");
            if ("true".equals(InstrumentationRegistry.getArguments().getString("expectOffline", "false"))) {
                assertEquals("false", evaluate(scenario, "navigator.onLine"));
            }
        }
    }

    @Test public void upgradeMarkerRemains() throws Exception {
        String verify = InstrumentationRegistry.getArguments().getString("verifyUpgrade", "false");
        org.junit.Assume.assumeTrue("Run after a signed APK replacement", "true".equals(verify));
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitTrue(scenario, "document.getElementById('root')?.innerText.length > 20");
            assertEquals("\"preserved\"", evaluate(scenario, "JSON.parse(localStorage.getItem('lumina.qa.upgrade-marker')).answer"));
        }
    }
}
