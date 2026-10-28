package com.geek4u.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkInfo;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.text.InputType;
import android.util.TypedValue;
import android.view.ContextMenu;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MenuItem;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.JsResult;
import android.webkit.MimeTypeMap;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Locale;

/**
 * Geek⁴u for Android: the website in a full-screen web view, so it looks and works exactly like
 * the site. The app adds what a browser would: picking files and taking photos for uploads,
 * downloads into the Downloads folder, the back button, opening other sites in the browser, and a
 * screen to type the server's address the first time.
 */
public class MainActivity extends Activity {
    /** Put the site's address here (like "https://example.com") to skip the setup screen. */
    static final String DEFAULT_SERVER = "http://87.61.252.240:42067";

    static final String ACTION_OPEN = "com.geek4u.app.OPEN";
    static final String ACTION_CHANGE_SERVER = "com.geek4u.app.CHANGE_SERVER";
    static final int REQ_FILES = 1, REQ_STORAGE = 2;
    static final int ACCENT = 0xFFA67CFF, INK = 0xFF160F24, TEXT = 0xFFF5F3FA, MUTED = 0xFF9C96AA,
            HINT = 0xFF6B6678, LINE = 0xFF23202B, SURFACE2 = 0xFF121216, BAD = 0xFFFCA5A5;
    static final int MATCH = ViewGroup.LayoutParams.MATCH_PARENT, WRAP = ViewGroup.LayoutParams.WRAP_CONTENT;

    /** Back closes the page's open popup or phone menu first, like it would in a browser tab. */
    static final String BACK_JS = "(function(){var d=document.querySelectorAll('dialog[open]');"
            + "if(d.length){d[d.length-1].close();return true}"
            + "var m=document.querySelector('header.xn.open .xn-toggle');if(m){m.click();return true}"
            + "return false})()";

    FrameLayout root;
    WebView web;
    View progress;
    View splash;
    View overlay;
    boolean overlayIsSetup;
    SharedPreferences prefs;
    String server = "";
    Typeface mono, monoBold;

    ValueCallback<Uri[]> filesCallback;
    File shotFile;
    Uri shotUri;
    String[] pendingDownload;
    View fullscreenView;
    WebChromeClient.CustomViewCallback fullscreenCallback;
    /** The page that failed to load, while the "Can't reach" screen is up. */
    String failedUrl;
    /** Saved pages and files for offline use (OfflineCache). */
    OfflineCache cache;
    volatile String userAgent;
    volatile String serverHost;
    ConnectivityManager.NetworkCallback netWatch;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        prefs = getSharedPreferences("geek4u", MODE_PRIVATE);
        cache = new OfflineCache(new File(getCacheDir(), "offline"));
        watchNetwork();
        mono = font("fonts/RobotoMono-Regular.ttf", Typeface.MONOSPACE);
        monoBold = font("fonts/RobotoMono-SemiBold.ttf", Typeface.create(Typeface.MONOSPACE, Typeface.BOLD));
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        setContentView(root);
        Shots.cleanUp(this);

        server = prefs.getString("server", DEFAULT_SERVER);
        if (server == null) server = "";
        Intent intent = getIntent();
        if (server.isEmpty()) {
            showSetup("", false);
        } else {
            String path = pathFrom(intent);
            openSite(path != null ? server + path : startUrl());
            if (intent != null && ACTION_CHANGE_SERVER.equals(intent.getAction())) showSetup(server, true);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (server.isEmpty()) return;
        if (ACTION_CHANGE_SERVER.equals(intent.getAction())) {
            showSetup(server, true);
            return;
        }
        String path = pathFrom(intent);
        if (path != null) {
            if (overlay != null && !overlayIsSetup) removeOverlay();
            failedUrl = null;
            openSite(server + path);
        }
    }

    /** The page an app shortcut asks for ("/journal"), or null. */
    static String pathFrom(Intent intent) {
        if (intent == null || !ACTION_OPEN.equals(intent.getAction())) return null;
        String path = intent.getStringExtra("path");
        return path != null && path.startsWith("/") && !path.startsWith("//") ? path : null;
    }

    // ---------------------------------------------------------------- the web view

    void createWeb() {
        if (web != null) return;
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUseWideViewPort(true);
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setUserAgentString(s.getUserAgentString() + " Geek4uApp/" + version() + " (Android)");
        userAgent = s.getUserAgentString();
        web.setNetworkAvailable(online());
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(web, false);
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener(new Downloads());
        registerForContextMenu(web);
        root.addView(web, 0, new FrameLayout.LayoutParams(MATCH, MATCH));

        progress = new View(this);
        progress.setBackgroundColor(ACCENT);
        progress.setPivotX(0);
        progress.setScaleX(0);
        progress.setAlpha(0);
        root.addView(progress, 1, new FrameLayout.LayoutParams(MATCH, dp(2), Gravity.TOP));
    }

    void openSite(String url) {
        createWeb();
        serverHost = Uri.parse(server).getHost();
        // Opened without internet: go to a page the phone has saved.
        if (!online() && !cache.has(url)) {
            for (String page : OfflineCache.OFFLINE_PAGES) {
                if (cache.has(server + page)) {
                    url = server + page;
                    break;
                }
            }
        }
        if (splash == null && web.getUrl() == null) showSplash();
        web.loadUrl(url);
    }

    String startUrl() {
        String last = prefs.getString("last", null);
        if (last != null && sameSite(Uri.parse(last))) return last;
        return server + "/Main";
    }

    /** Remembers the page you were on, so the app opens there again (pages only, not pictures or files). */
    void rememberPage() {
        if (web == null || failedUrl != null) return;
        String url = web.getUrl();
        if (url == null) return;
        Uri u = Uri.parse(url);
        if (!sameSite(u)) return;
        String last = u.getLastPathSegment();
        if (last != null && last.contains(".")) return;
        prefs.edit().putString("last", url).apply();
    }

    boolean sameSite(Uri uri) {
        if (server.isEmpty() || uri == null || uri.getHost() == null) return false;
        String scheme = uri.getScheme();
        if (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) return false;
        String host = Uri.parse(server).getHost();
        return host != null && host.equalsIgnoreCase(uri.getHost());
    }

    /** true = the app handles the link itself (another site, mail, phone), false = load it here. */
    boolean route(Uri uri) {
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (scheme.equals("http") || scheme.equals("https")) {
            if (sameSite(uri)) return false;
            openOutside(uri);
            return true;
        }
        if (scheme.equals("about") || scheme.equals("data") || scheme.equals("blob") || scheme.equals("javascript")) return false;
        if (scheme.equals("intent")) {
            try {
                Intent i = Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME);
                i.addCategory(Intent.CATEGORY_BROWSABLE);
                i.setComponent(null);
                i.setSelector(null);
                startActivity(i);
            } catch (Exception e) {
                toast("No app on this phone can open that link.");
            }
            return true;
        }
        openOutside(uri);
        return true;
    }

    void openOutside(Uri uri) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, uri);
            i.addCategory(Intent.CATEGORY_BROWSABLE);
            startActivity(i);
        } catch (ActivityNotFoundException e) {
            toast("No app on this phone can open that link.");
        }
    }

    /** An error page shows the URL that failed, or Chromium's own error address. */
    boolean isErrorPage(String url) {
        if (failedUrl == null) return false;
        if (url == null || url.equals(failedUrl)) return true;
        return url.startsWith("chrome-error:") || url.startsWith("data:text/html,chromewebdata") || url.equals("about:blank");
    }

    class Client extends WebViewClient {
        // Runs off the main thread for every request: pages, scripts, pictures, JSON.
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            String host = serverHost;
            if (cache == null || host == null || !cache.handles(request, host)) return null;
            return cache.load(request, userAgent, online());
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            // Leave frames inside a page alone, only whole-page moves can go to another app.
            if (!request.isForMainFrame()) return false;
            return route(request.getUrl());
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return route(Uri.parse(url));
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap icon) {
            showProgress(10);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            showProgress(100);
            if (!isErrorPage(url)) {
                failedUrl = null;
                if (overlay != null && !overlayIsSetup) removeOverlay();
                hideSplash();
            }
            CookieManager.getInstance().flush();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (!request.isForMainFrame()) return;
            failedUrl = request.getUrl().toString();
            showError(error.getErrorCode(), String.valueOf(error.getDescription()));
        }

        @Override
        public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
            handler.cancel();
            String url = error.getUrl();
            if (url != null && sameSite(Uri.parse(url)) && (view.getUrl() == null || url.equals(view.getUrl()) || view.getProgress() < 100)) {
                failedUrl = url;
                showError(WebViewClient.ERROR_FAILED_SSL_HANDSHAKE, "");
            }
        }

        // The page's renderer crashed or was stopped to free memory: start a fresh one where you were.
        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            String url = view.getUrl();
            root.removeView(view);
            view.destroy();
            if (view == web) {
                web = null;
                root.removeView(progress);
                progress = null;
                createWeb();
                web.loadUrl(url != null && sameSite(Uri.parse(url)) ? url : server + "/Main");
            }
            return true;
        }
    }

    class Chrome extends WebChromeClient {
        @Override
        public void onProgressChanged(WebView view, int p) {
            showProgress(p);
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (filesCallback != null) filesCallback.onReceiveValue(null);
            filesCallback = callback;
            try {
                startActivityForResult(chooser(params), REQ_FILES);
                return true;
            } catch (ActivityNotFoundException e) {
                filesCallback = null;
                toast("No app on this phone can pick files.");
                return false;
            }
        }

        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (fullscreenView != null) {
                callback.onCustomViewHidden();
                return;
            }
            fullscreenView = view;
            fullscreenCallback = callback;
            root.addView(view, new FrameLayout.LayoutParams(MATCH, MATCH));
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }

        @Override
        public void onHideCustomView() {
            hideFullscreen();
        }

        @Override
        public boolean onJsAlert(WebView view, String url, String message, final JsResult result) {
            new AlertDialog.Builder(MainActivity.this)
                    .setMessage(message)
                    .setPositiveButton(android.R.string.ok, new DialogInterface.OnClickListener() {
                        public void onClick(DialogInterface d, int which) {
                            result.confirm();
                        }
                    })
                    .setOnCancelListener(new DialogInterface.OnCancelListener() {
                        public void onCancel(DialogInterface d) {
                            result.confirm();
                        }
                    })
                    .show();
            return true;
        }

        @Override
        public boolean onJsConfirm(WebView view, String url, String message, final JsResult result) {
            new AlertDialog.Builder(MainActivity.this)
                    .setMessage(message)
                    .setPositiveButton(android.R.string.ok, new DialogInterface.OnClickListener() {
                        public void onClick(DialogInterface d, int which) {
                            result.confirm();
                        }
                    })
                    .setNegativeButton(android.R.string.cancel, new DialogInterface.OnClickListener() {
                        public void onClick(DialogInterface d, int which) {
                            result.cancel();
                        }
                    })
                    .setOnCancelListener(new DialogInterface.OnCancelListener() {
                        public void onCancel(DialogInterface d) {
                            result.cancel();
                        }
                    })
                    .show();
            return true;
        }
    }

    void hideFullscreen() {
        if (fullscreenView == null) return;
        root.removeView(fullscreenView);
        fullscreenView = null;
        getWindow().getDecorView().setSystemUiVisibility(0);
        if (fullscreenCallback != null) fullscreenCallback.onCustomViewHidden();
        fullscreenCallback = null;
    }

    void showProgress(int p) {
        if (progress == null) return;
        progress.animate().cancel();
        if (p >= 100) {
            progress.animate().scaleX(1f).alpha(0f).setDuration(250);
        } else {
            if (progress.getAlpha() == 0f) progress.setScaleX(0f);
            progress.setAlpha(1f);
            progress.animate().scaleX(Math.max(0.08f, p / 100f)).setDuration(180);
        }
    }

    // ---------------------------------------------------------------- long-press a picture to save it

    @Override
    public void onCreateContextMenu(ContextMenu menu, View v, ContextMenu.ContextMenuInfo info) {
        super.onCreateContextMenu(menu, v, info);
        if (web == null || v != web) return;
        WebView.HitTestResult hit = web.getHitTestResult();
        if (hit == null) return;
        int type = hit.getType();
        final String src = hit.getExtra();
        if (src == null || (type != WebView.HitTestResult.IMAGE_TYPE && type != WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE)) return;
        String scheme = Uri.parse(src).getScheme();
        if (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) return;
        menu.add("Save picture").setOnMenuItemClickListener(new MenuItem.OnMenuItemClickListener() {
            public boolean onMenuItemClick(MenuItem item) {
                download(src, web != null ? web.getSettings().getUserAgentString() : null, null, null);
                return true;
            }
        });
    }

    // ---------------------------------------------------------------- uploads

    /** The file picker, plus the camera when the page takes pictures (like Chrome offers). */
    Intent chooser(WebChromeClient.FileChooserParams params) {
        ArrayList<String> types = new ArrayList<String>();
        String[] accept = params.getAcceptTypes();
        if (accept != null) {
            for (String a : accept) {
                if (a == null) continue;
                for (String part : a.split(",")) {
                    String t = part.trim().toLowerCase(Locale.ROOT);
                    if (t.isEmpty()) continue;
                    if (t.startsWith(".")) {
                        t = MimeTypeMap.getSingleton().getMimeTypeFromExtension(t.substring(1));
                        if (t == null) continue;
                    }
                    if (!types.contains(t)) types.add(t);
                }
            }
        }
        boolean images = !types.isEmpty();
        for (String t : types) if (!t.startsWith("image/")) images = false;

        Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
        pick.addCategory(Intent.CATEGORY_OPENABLE);
        if (params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) {
            pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        }
        if (types.isEmpty()) {
            pick.setType("*/*");
        } else if (types.size() == 1) {
            pick.setType(types.get(0));
        } else {
            pick.setType(images ? "image/*" : "*/*");
            pick.putExtra(Intent.EXTRA_MIME_TYPES, types.toArray(new String[0]));
        }

        Intent chooser = Intent.createChooser(pick, images ? "Choose a picture" : "Choose a file");
        shotFile = null;
        shotUri = null;
        if (types.isEmpty() || images || types.contains("*/*")) {
            File f = Shots.newFile(this);
            if (f != null) {
                shotFile = f;
                shotUri = Shots.uriFor(f);
                Intent cam = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                cam.putExtra(MediaStore.EXTRA_OUTPUT, shotUri);
                cam.setClipData(ClipData.newRawUri("", shotUri));
                cam.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{cam});
            }
        }
        return chooser;
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        if (request != REQ_FILES) {
            super.onActivityResult(request, result, data);
            return;
        }
        if (filesCallback == null) return;
        Uri[] picked = null;
        if (result == RESULT_OK) {
            ClipData clip = data != null ? data.getClipData() : null;
            if (clip != null && clip.getItemCount() > 0 && clip.getItemAt(0).getUri() != null
                    && !(shotUri != null && shotUri.equals(clip.getItemAt(0).getUri()))) {
                ArrayList<Uri> uris = new ArrayList<Uri>();
                for (int i = 0; i < clip.getItemCount(); i++) {
                    Uri u = clip.getItemAt(i).getUri();
                    if (u != null) uris.add(u);
                }
                picked = uris.toArray(new Uri[0]);
            } else if (data != null && data.getData() != null && !data.getData().equals(shotUri)) {
                picked = new Uri[]{data.getData()};
            } else if (shotFile != null && shotFile.length() > 0) {
                picked = new Uri[]{shotUri};
            }
        }
        filesCallback.onReceiveValue(picked);
        filesCallback = null;
    }

    // ---------------------------------------------------------------- downloads

    class Downloads implements DownloadListener {
        @Override
        public void onDownloadStart(String url, String userAgent, String disposition, String mimeType, long length) {
            download(url, userAgent, disposition, mimeType);
        }
    }

    void download(String url, String userAgent, String disposition, String mimeType) {
        Uri uri = Uri.parse(url);
        if (!"http".equalsIgnoreCase(uri.getScheme()) && !"https".equalsIgnoreCase(uri.getScheme())) {
            toast("That file can't be downloaded in the app.");
            return;
        }
        if (Build.VERSION.SDK_INT < 29
                && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            pendingDownload = new String[]{url, userAgent, disposition, mimeType};
            requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_STORAGE);
            return;
        }
        String name = URLUtil.guessFileName(url, disposition, mimeType);
        try {
            DownloadManager.Request r = new DownloadManager.Request(uri);
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null) r.addRequestHeader("Cookie", cookie);
            if (userAgent != null) r.addRequestHeader("User-Agent", userAgent);
            if (mimeType != null && !mimeType.isEmpty() && !mimeType.equals("application/octet-stream")) r.setMimeType(mimeType);
            r.setTitle(name);
            r.setDescription(getString(R.string.app_name));
            r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(r);
            toast("Downloading " + name + "…");
        } catch (Exception e) {
            toast("Couldn't download that. " + e.getMessage());
        }
    }

    @Override
    public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        if (request != REQ_STORAGE) return;
        String[] d = pendingDownload;
        pendingDownload = null;
        if (d == null) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) download(d[0], d[1], d[2], d[3]);
        else toast("Allow storage so the app can save downloads.");
    }

    // ---------------------------------------------------------------- back button and lifecycle

    @Override
    public void onBackPressed() {
        if (fullscreenView != null) {
            hideFullscreen();
            return;
        }
        if (overlay != null) {
            if (overlayIsSetup && !server.isEmpty() && web != null) {
                removeOverlay();
                if (web.getUrl() == null) openSite(startUrl());
                return;
            }
            if (!overlayIsSetup && web != null && web.canGoBack()) {
                removeOverlay();
                failedUrl = null;
                web.goBack();
                return;
            }
            super.onBackPressed();
            return;
        }
        if (web == null) {
            super.onBackPressed();
            return;
        }
        web.evaluateJavascript(BACK_JS, new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String handled) {
                if ("true".equals(handled)) return;
                if (web != null && web.canGoBack()) web.goBack();
                else MainActivity.super.onBackPressed();
            }
        });
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) {
            web.onPause();
            rememberPage();
        }
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    /** Tells the page when the phone goes on or offline, so it can upload saved changes. */
    void watchNetwork() {
        if (Build.VERSION.SDK_INT < 24) return;
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            netWatch = new ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(Network network) {
                    tellWeb(true);
                }

                @Override
                public void onLost(Network network) {
                    tellWeb(online());
                }
            };
            cm.registerDefaultNetworkCallback(netWatch);
        } catch (Exception e) {
            netWatch = null;
        }
    }

    void tellWeb(final boolean available) {
        runOnUiThread(new Runnable() {
            public void run() {
                if (web != null) web.setNetworkAvailable(available);
            }
        });
    }

    @Override
    protected void onDestroy() {
        if (netWatch != null) {
            try {
                ((ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE)).unregisterNetworkCallback(netWatch);
            } catch (Exception e) {
                // already gone
            }
        }
        if (web != null) {
            root.removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    // ---------------------------------------------------------------- splash, setup and error screens

    void showSplash() {
        LinearLayout box = column();
        box.setBackgroundColor(Color.BLACK);
        box.addView(logo(190));
        splash = box;
        // Under the progress line, so loading still shows.
        root.addView(splash, root.indexOfChild(web) + 1, new FrameLayout.LayoutParams(MATCH, MATCH));
        // Never keep it up forever, even if the page is slow to finish.
        splash.postDelayed(new Runnable() {
            public void run() {
                hideSplash();
            }
        }, 12000);
    }

    void hideSplash() {
        if (splash == null) return;
        final View v = splash;
        splash = null;
        v.animate().alpha(0f).setDuration(220).withEndAction(new Runnable() {
            public void run() {
                root.removeView(v);
            }
        });
    }

    void removeOverlay() {
        if (overlay == null) return;
        hideKeyboard(overlay);
        root.removeView(overlay);
        overlay = null;
    }

    void setOverlay(View content, boolean setup) {
        removeOverlay();
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.BLACK);
        FrameLayout center = new FrameLayout(this);
        center.addView(content, new FrameLayout.LayoutParams(WRAP, WRAP, Gravity.CENTER));
        scroll.addView(center, new FrameLayout.LayoutParams(MATCH, MATCH));
        overlay = scroll;
        overlayIsSetup = setup;
        root.addView(overlay, new FrameLayout.LayoutParams(MATCH, MATCH));
        hideSplash();
    }

    void showSetup(String prefill, final boolean canCancel) {
        LinearLayout col = new MaxWidth(this, dp(440));
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(dp(24), dp(32), dp(24), dp(32));
        col.setGravity(Gravity.CENTER_HORIZONTAL);

        col.addView(logo(170), new LinearLayout.LayoutParams(WRAP, WRAP));
        col.addView(text("Connect to your server", 18, TEXT, true), lp(MATCH, WRAP, 28));
        col.addView(text("Type the address you open Geek⁴u at in your browser. You only do this once.", 12, MUTED, false), lp(MATCH, WRAP, 6));
        TextView label = text("Server address", 11, MUTED, false);
        label.setGravity(Gravity.START);
        col.addView(label, lp(MATCH, WRAP, 22));

        final EditText input = new EditText(this);
        styleInput(input);
        input.setHint("example.com or 192.168.1.20:42067");
        input.setText(prefill);
        input.setSelection(input.getText().length());
        col.addView(input, lp(MATCH, dp(48), 6));

        final TextView error = text("", 12, BAD, false);
        error.setGravity(Gravity.START);
        error.setVisibility(View.GONE);
        col.addView(error, lp(MATCH, WRAP, 10));

        final Button go = button("Connect", true);
        col.addView(go, lp(MATCH, dp(48), 16));
        final Button anyway = button("Use it anyway", false);
        anyway.setVisibility(View.GONE);
        col.addView(anyway, lp(MATCH, dp(48), 10));
        if (canCancel) {
            Button cancel = button("Cancel", false);
            col.addView(cancel, lp(MATCH, dp(48), 10));
            cancel.setOnClickListener(new View.OnClickListener() {
                public void onClick(View v) {
                    removeOverlay();
                    if (web == null || web.getUrl() == null) openSite(startUrl());
                }
            });
        }

        go.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) {
                connect(input, error, go, anyway);
            }
        });
        anyway.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) {
                String[] tries = candidates(input.getText().toString());
                if (tries.length == 0) return;
                useServer(tries[0]);
            }
        });
        input.setOnEditorActionListener(new TextView.OnEditorActionListener() {
            public boolean onEditorAction(TextView v, int action, KeyEvent event) {
                if (action == EditorInfo.IME_ACTION_GO || action == EditorInfo.IME_ACTION_DONE
                        || (event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER && event.getAction() == KeyEvent.ACTION_DOWN)) {
                    go.performClick();
                    return true;
                }
                return false;
            }
        });
        setOverlay(col, true);
        input.requestFocus();
    }

    void connect(final EditText input, final TextView error, final Button go, final Button anyway) {
        final String[] tries = candidates(input.getText().toString());
        if (tries.length == 0) {
            error.setText("Type your server's address first, like example.com or 192.168.1.20:42067.");
            error.setVisibility(View.VISIBLE);
            return;
        }
        hideKeyboard(input);
        error.setVisibility(View.GONE);
        anyway.setVisibility(View.GONE);
        go.setEnabled(false);
        go.setText("Checking…");
        new Thread(new Runnable() {
            public void run() {
                String found = null;
                for (String t : tries) {
                    try {
                        found = probe(t);
                    } catch (Exception e) {
                        found = null;
                    }
                    if (found != null) break;
                }
                final String ok = found;
                runOnUiThread(new Runnable() {
                    public void run() {
                        if (isFinishing()) return;
                        go.setEnabled(true);
                        go.setText("Connect");
                        if (ok != null) {
                            useServer(ok);
                        } else {
                            error.setText("Couldn't reach " + Uri.parse(tries[0]).getEncodedAuthority()
                                    + ". Check the address, and that your server is running.");
                            error.setVisibility(View.VISIBLE);
                            anyway.setVisibility(View.VISIBLE);
                        }
                    }
                });
            }
        }).start();
    }

    void useServer(String origin) {
        boolean changed = !origin.equals(server);
        server = origin;
        SharedPreferences.Editor e = prefs.edit().putString("server", origin);
        if (changed) e.remove("last");
        e.apply();
        removeOverlay();
        failedUrl = null;
        if (changed || web == null || web.getUrl() == null) {
            openSite(origin + "/Main");
            web.clearHistory();
        }
    }

    /** Asks the address for its /Main page. Any answer means a server is there; a redirect can switch to https. */
    static String probe(String origin) throws Exception {
        URL main = new URL(origin + "/Main");
        HttpURLConnection c = (HttpURLConnection) main.openConnection();
        c.setConnectTimeout(7000);
        c.setReadTimeout(7000);
        c.setInstanceFollowRedirects(false);
        c.setRequestProperty("User-Agent", "Geek4uApp");
        try {
            int code = c.getResponseCode();
            if (code >= 300 && code < 400) {
                String location = c.getHeaderField("Location");
                if (location != null) {
                    Uri to = Uri.parse(new URL(main, location).toString());
                    if (to.getHost() != null && to.getHost().equalsIgnoreCase(Uri.parse(origin).getHost())) {
                        return to.getScheme() + "://" + to.getEncodedAuthority();
                    }
                }
            }
            return origin;
        } finally {
            c.disconnect();
        }
    }

    /** "example.com" -> try https then http; "192.168.1.20:42067" -> http then https; full links are used as typed. */
    static String[] candidates(String typed) {
        String t = typed == null ? "" : typed.trim();
        if (t.isEmpty() || t.contains(" ")) return new String[0];
        String lower = t.toLowerCase(Locale.ROOT);
        if (lower.startsWith("http://") || lower.startsWith("https://")) {
            Uri u = Uri.parse(t);
            if (u.getHost() == null || u.getHost().isEmpty()) return new String[0];
            return new String[]{u.getScheme().toLowerCase(Locale.ROOT) + "://" + u.getEncodedAuthority()};
        }
        int slash = t.indexOf('/');
        String host = slash >= 0 ? t.substring(0, slash) : t;
        if (host.isEmpty() || host.startsWith(":") || host.endsWith(":")) return new String[0];
        boolean local = host.matches("^[0-9.]+(:\\d+)?$") || host.startsWith("localhost") || host.contains(":") || host.startsWith("[");
        return local ? new String[]{"http://" + host, "https://" + host} : new String[]{"https://" + host, "http://" + host};
    }

    void showError(int code, String description) {
        String host = Uri.parse(server).getEncodedAuthority();
        String message;
        if (!online()) message = "You're offline. Connect to the internet and try again.";
        else if (code == WebViewClient.ERROR_HOST_LOOKUP) message = "The address " + host + " couldn't be found. Check it's typed right.";
        else if (code == WebViewClient.ERROR_CONNECT) message = "Your server didn't answer. Is it running?";
        else if (code == WebViewClient.ERROR_TIMEOUT) message = "Your server took too long to answer.";
        else if (code == WebViewClient.ERROR_FAILED_SSL_HANDSHAKE) message = "A secure connection to your server couldn't be made.";
        else message = description == null || description.isEmpty() ? "Something went wrong loading the page." : description;

        LinearLayout col = new MaxWidth(this, dp(440));
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(dp(24), dp(32), dp(24), dp(32));
        col.setGravity(Gravity.CENTER_HORIZONTAL);
        col.addView(logo(150), new LinearLayout.LayoutParams(WRAP, WRAP));
        boolean offline = !online();
        String savedPage = null;
        if (offline) {
            message = "This page needs internet. The Graph, your Profile and Utility work offline.";
            for (String page : OfflineCache.OFFLINE_PAGES) {
                if (cache.has(server + page) && !page.equals("/Main")) {
                    savedPage = server + page;
                    break;
                }
            }
        }
        col.addView(text(offline ? "You need internet" : "Can't reach Geek⁴u", 18, TEXT, true), lp(MATCH, WRAP, 28));
        col.addView(text(message, 13, MUTED, false), lp(MATCH, WRAP, 8));
        col.addView(text(server, 11, HINT, false), lp(MATCH, WRAP, 10));
        if (savedPage != null) {
            final String target = savedPage;
            Button graph = button(target.endsWith("/Profile") ? "Open your Profile" : target.endsWith("/Utility") ? "Open Utility" : "Open the Graph", true);
            col.addView(graph, lp(MATCH, dp(48), 22));
            graph.setOnClickListener(new View.OnClickListener() {
                public void onClick(View v) {
                    failedUrl = null;
                    removeOverlay();
                    createWeb();
                    web.loadUrl(target);
                }
            });
        }
        Button retry = button("Try again", savedPage == null);
        col.addView(retry, lp(MATCH, dp(48), savedPage == null ? 22 : 10));
        Button change = button("Change server", false);
        col.addView(change, lp(MATCH, dp(48), 10));
        retry.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) {
                String url = failedUrl != null ? failedUrl : server + "/Main";
                failedUrl = null;
                removeOverlay();
                createWeb();
                web.loadUrl(url);
            }
        });
        change.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) {
                showSetup(server, true);
            }
        });
        setOverlay(col, false);
    }

    boolean online() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            NetworkInfo info = cm.getActiveNetworkInfo();
            return info == null || info.isConnected();
        } catch (Exception e) {
            return true;
        }
    }

    // ---------------------------------------------------------------- small view helpers (styled like the site)

    /** A column that never gets wider than max (so the setup screen looks right on tablets). */
    static class MaxWidth extends LinearLayout {
        final int max;

        MaxWidth(Context c, int max) {
            super(c);
            this.max = max;
        }

        @Override
        protected void onMeasure(int widthSpec, int heightSpec) {
            int size = MeasureSpec.getSize(widthSpec);
            int mode = MeasureSpec.getMode(widthSpec);
            int width = mode == MeasureSpec.UNSPECIFIED ? max : Math.min(size, max);
            super.onMeasure(MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY), heightSpec);
        }
    }

    LinearLayout column() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        return box;
    }

    ImageView logo(int widthDp) {
        ImageView v = new ImageView(this);
        v.setImageResource(R.drawable.logo);
        v.setAdjustViewBounds(true);
        v.setContentDescription(getString(R.string.app_name));
        v.setLayoutParams(new LinearLayout.LayoutParams(dp(widthDp), WRAP));
        return v;
    }

    TextView text(String s, int sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        t.setTypeface(bold ? monoBold : mono);
        t.setLineSpacing(0, 1.35f);
        t.setGravity(Gravity.CENTER_HORIZONTAL);
        return t;
    }

    Button button(String label, boolean primary) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTypeface(monoBold);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        b.setTextColor(primary ? INK : TEXT);
        b.setStateListAnimator(null);
        GradientDrawable shape = new GradientDrawable();
        shape.setCornerRadius(dp(2));
        shape.setColor(primary ? ACCENT : SURFACE2);
        if (!primary) shape.setStroke(dp(1), LINE);
        b.setBackground(new RippleDrawable(ColorStateList.valueOf(primary ? 0x33160F24 : 0x22FFFFFF), shape, null));
        return b;
    }

    void styleInput(final EditText input) {
        input.setSingleLine(true);
        input.setTypeface(mono);
        input.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        input.setTextColor(TEXT);
        input.setHintTextColor(HINT);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setImeOptions(EditorInfo.IME_ACTION_GO);
        input.setPadding(dp(12), 0, dp(12), 0);
        final GradientDrawable shape = new GradientDrawable();
        shape.setCornerRadius(dp(2));
        shape.setColor(Color.BLACK);
        shape.setStroke(dp(1), LINE);
        input.setBackground(shape);
        input.setOnFocusChangeListener(new View.OnFocusChangeListener() {
            public void onFocusChange(View v, boolean focused) {
                shape.setStroke(dp(1), focused ? ACCENT : LINE);
            }
        });
    }

    LinearLayout.LayoutParams lp(int w, int h, int topDp) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(w, h);
        p.topMargin = dp(topDp);
        return p;
    }

    void hideKeyboard(View v) {
        InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
        if (imm != null && v != null) imm.hideSoftInputFromWindow(v.getWindowToken(), 0);
    }

    Typeface font(String asset, Typeface fallback) {
        try {
            return Typeface.createFromAsset(getAssets(), asset);
        } catch (Exception e) {
            return fallback;
        }
    }

    String version() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "1";
        }
    }

    int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    void toast(String s) {
        Toast.makeText(this, s, Toast.LENGTH_SHORT).show();
    }
}
