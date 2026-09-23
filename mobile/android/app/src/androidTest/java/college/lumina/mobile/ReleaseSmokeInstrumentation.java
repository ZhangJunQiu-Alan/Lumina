package college.lumina.mobile;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;

public class ReleaseSmokeInstrumentation extends Instrumentation {
    private Bundle options;
    @Override public void onCreate(Bundle arguments) {
        super.onCreate(arguments);
        options = arguments == null ? new Bundle() : arguments;
        start();
    }

    private WebView findWebView(View view) {
        if (view instanceof WebView) return (WebView) view;
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) {
                WebView found = findWebView(group.getChildAt(i));
                if (found != null) return found;
            }
        }
        return null;
    }

    private String evaluate(Activity activity, String script) throws Exception {
        AtomicReference<String> result = new AtomicReference<>();
        CountDownLatch done = new CountDownLatch(1);
        runOnMainSync(() -> {
            WebView webView = findWebView(activity.findViewById(android.R.id.content));
            if (webView == null) { done.countDown(); return; }
            webView.evaluateJavascript(script, value -> { result.set(value); done.countDown(); });
        });
        if (!done.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("WebView unresponsive");
        return result.get();
    }

    @Override public void onStart() {
        Bundle report = new Bundle();
        try {
            Intent intent = new Intent().setClassName("college.lumina.mobile", "college.lumina.mobile.MainActivity")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            Activity activity = startActivitySync(intent);
            String prepareToken = options.getString("prepareUpgrade", "");
            String verifyToken = options.getString("verifyUpgrade", "");
            String rendered = "document.getElementById('root')?.innerText.length > 20 && location.origin === 'https://localhost' && window.Capacitor.isNativePlatform()";
            String draftKey = "lumina.input.v1.qa-upgrade.test.review.0.word";
            long deadline = SystemClock.elapsedRealtime() + 45000;
            boolean passed = false;
            while (SystemClock.elapsedRealtime() < deadline) {
                String condition;
                if (!prepareToken.isEmpty()) {
                    condition = "(() => { if (!(" + rendered + ")) return false; "
                        + "localStorage.setItem('lumina.qa.upgrade-marker',JSON.stringify({answer:'preserved',token:" + JSONObject.quote(prepareToken) + "}));"
                        + "localStorage.setItem('" + draftKey + "',JSON.stringify({input:'dai',showAnswer:false,choice:null})); return true; })()";
                } else if (!verifyToken.isEmpty()) {
                    condition = "Boolean(" + rendered
                        + " && JSON.parse(localStorage.getItem('lumina.qa.upgrade-marker') || 'null')?.token === " + JSONObject.quote(verifyToken)
                        + " && JSON.parse(localStorage.getItem('" + draftKey + "') || 'null')?.input === 'dai')";
                } else {
                    condition = "Boolean(" + rendered + " && JSON.parse(localStorage.getItem('lumina.qa.upgrade-marker') || 'null')?.answer === 'preserved' && [...document.querySelectorAll('input')].some(input => input.value === 'dai'))";
                }
                String state = evaluate(activity, condition);
                if ("true".equals(state)) { passed = true; break; }
                SystemClock.sleep(250);
            }
            if (!passed) {
                String state = evaluate(activity, "JSON.stringify({path:location.pathname,rendered:document.getElementById('root')?.innerText.length,marker:JSON.parse(localStorage.getItem('lumina.qa.upgrade-marker') || 'null')?.answer,inputs:[...document.querySelectorAll('input')].map(input=>input.type==='password'?'[redacted]':input.value)})");
                throw new IllegalStateException("Release recovery failed: " + state);
            }
            if (!prepareToken.isEmpty()) {
                runOnMainSync(() -> activity.moveTaskToBack(true));
                SystemClock.sleep(5000);
            }
            report.putString("stream", !prepareToken.isEmpty()
                ? "PASS: pre-upgrade storage marker and draft prepared\n"
                : !verifyToken.isEmpty()
                    ? "PASS: minified signed release rendered; pre-upgrade storage marker and stored draft preserved\n"
                    : "PASS: minified signed release rendered; pre-upgrade storage marker and review draft preserved\n");
            finish(Activity.RESULT_OK, report);
        } catch (Exception error) {
            report.putString("stream", "FAIL: " + error.getMessage() + "\n");
            finish(Activity.RESULT_CANCELED, report);
        }
    }
}
