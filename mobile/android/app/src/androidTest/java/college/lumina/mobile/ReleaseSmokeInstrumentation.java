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

public class ReleaseSmokeInstrumentation extends Instrumentation {
    @Override public void onCreate(Bundle arguments) { super.onCreate(arguments); start(); }

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
            long deadline = SystemClock.elapsedRealtime() + 45000;
            boolean passed = false;
            while (SystemClock.elapsedRealtime() < deadline) {
                String state = evaluate(activity, "Boolean(document.getElementById('root')?.innerText.length > 20 && JSON.parse(localStorage.getItem('lumina.qa.upgrade-marker') || 'null')?.answer === 'preserved' && [...document.querySelectorAll('input')].some(input => input.value === 'dai'))");
                if ("true".equals(state)) { passed = true; break; }
                SystemClock.sleep(250);
            }
            if (!passed) {
                String state = evaluate(activity, "JSON.stringify({path:location.pathname,rendered:document.getElementById('root')?.innerText.length,marker:JSON.parse(localStorage.getItem('lumina.qa.upgrade-marker') || 'null')?.answer,inputs:[...document.querySelectorAll('input')].map(input=>input.type==='password'?'[redacted]':input.value)})");
                throw new IllegalStateException("Release recovery failed: " + state);
            }
            report.putString("stream", "PASS: minified signed release rendered; pre-upgrade storage marker and review draft preserved\n");
            finish(Activity.RESULT_OK, report);
        } catch (Exception error) {
            report.putString("stream", "FAIL: " + error.getMessage() + "\n");
            finish(Activity.RESULT_CANCELED, report);
        }
    }
}
