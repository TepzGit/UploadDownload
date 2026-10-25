package com.geek4u.app;

import android.net.Uri;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Keeps a copy of the pages and files the app loads, so the Graph, Profile and Utility open
 * without internet. Online, the app fetches GET requests itself (with the web view's cookies),
 * saves a copy and hands the answer to the web view. Offline, or when the server doesn't
 * answer, it hands over the saved copy. The site's own JavaScript (offline.js) keeps the
 * substance data and queues saves until the phone is back online.
 */
final class OfflineCache {
    /** Whole pages that work offline. Other pages say "you need internet" (nav.js / the app). */
    static final String[] OFFLINE_PAGES = {"/", "/Main", "/Profile", "/Utility", "/journal", "/journal/Drug"};
    /** Never cached: big or private file transfers, and anything that changes state on a GET. */
    static final String[] SKIP_PREFIXES = {"/Files/", "/Uploader", "/upload", "/logout", "/getItems", "/search",
            "/replications/", "/download", "/sync/"};
    static final long MAX_FILE = 12L * 1024 * 1024;
    static final long MAX_TOTAL = 150L * 1024 * 1024;

    final File dir;
    int writes;

    OfflineCache(File dir) {
        this.dir = dir;
        dir.mkdirs();
    }

    /** Should this request go through the cache? (Only GETs the app may store.) */
    boolean handles(WebResourceRequest req, String serverHost) {
        if (!"GET".equalsIgnoreCase(req.getMethod())) return false;
        Uri u = req.getUrl();
        String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.ROOT);
        if (!scheme.equals("http") && !scheme.equals("https")) return false;
        Map<String, String> h = req.getRequestHeaders();
        if (h != null && (h.containsKey("Range") || h.containsKey("range"))) return false;
        boolean ours = serverHost != null && serverHost.equalsIgnoreCase(u.getHost());
        String path = u.getPath() == null || u.getPath().isEmpty() ? "/" : u.getPath();
        if (req.isForMainFrame()) {
            if (!ours) return false;
            for (String p : OFFLINE_PAGES) if (p.equals(path)) return true;
            return false;
        }
        if (ours) {
            for (String p : SKIP_PREFIXES) if (path.startsWith(p)) return false;
        }
        return true; // our scripts, styles, pictures and JSON, plus the CDNs and fonts pages use
    }

    /**
     * The answer for a request: fetched now (and saved) when online, the saved copy when not.
     * null = let the web view load it itself (or fail and show the "can't reach" screen).
     */
    WebResourceResponse load(WebResourceRequest req, String userAgent, boolean online) {
        String url = req.getUrl().toString();
        // A whole page is the same for every ?query (Drug info reads ?drug= itself), so
        // it is also kept under its address without one.
        String page = req.isForMainFrame() && req.getUrl().getQuery() != null ? pageKey(url) : null;
        if (online) {
            try {
                Fetched f = fetch(url, req.getRequestHeaders(), userAgent);
                if (f == null) return null; // a redirect or a huge file: the web view does it
                if (f.status == 200) {
                    save(url, f);
                    if (page != null) save(page, f);
                }
                return f.toResponse();
            } catch (IOException e) {
                // The server or the network is down: fall back to the saved copy.
            }
        }
        Fetched saved = read(url);
        if (saved == null && page != null) saved = read(page);
        return saved == null ? null : saved.toResponse();
    }

    /** The page's address without its ?query and #part. */
    static String pageKey(String url) {
        int cut = url.length();
        int q = url.indexOf('?'), h = url.indexOf('#');
        if (q >= 0) cut = q;
        if (h >= 0 && h < cut) cut = h;
        return url.substring(0, cut);
    }

    boolean has(String url) {
        return read(url) != null || read(pageKey(url)) != null;
    }

    // ---------------------------------------------------------------- network

    static final class Fetched {
        int status;
        String reason;
        String mime;
        String encoding;
        Map<String, String> headers = new HashMap<>();
        byte[] body;

        WebResourceResponse toResponse() {
            WebResourceResponse r = new WebResourceResponse(mime, encoding, new ByteArrayInputStream(body));
            r.setStatusCodeAndReasonPhrase(status, reason == null || reason.isEmpty() ? "OK" : reason);
            r.setResponseHeaders(headers);
            return r;
        }
    }

    Fetched fetch(String url, Map<String, String> requestHeaders, String userAgent) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setInstanceFollowRedirects(false);
        c.setConnectTimeout(10000);
        c.setReadTimeout(30000);
        c.setUseCaches(false);
        if (requestHeaders != null) {
            for (Map.Entry<String, String> e : requestHeaders.entrySet()) {
                String k = e.getKey();
                // HttpURLConnection unzips only what it asked to be zipped, so it picks the encoding.
                if (k == null || k.equalsIgnoreCase("Accept-Encoding") || k.equalsIgnoreCase("Cookie")) continue;
                c.setRequestProperty(k, e.getValue());
            }
        }
        if (userAgent != null) c.setRequestProperty("User-Agent", userAgent);
        CookieManager cookies = CookieManager.getInstance();
        String cookie = cookies.getCookie(url);
        if (cookie != null && !cookie.isEmpty()) c.setRequestProperty("Cookie", cookie);
        try {
            int status = c.getResponseCode();
            for (Map.Entry<String, List<String>> e : c.getHeaderFields().entrySet()) {
                if (e.getKey() == null || !e.getKey().equalsIgnoreCase("Set-Cookie") || e.getValue() == null) continue;
                for (String sc : e.getValue()) cookies.setCookie(url, sc);
            }
            if (status >= 300 && status < 400) {
                // Remember where it pointed, so the saved copy of the target answers offline.
                String location = c.getHeaderField("Location");
                if (location != null) saveRedirect(url, new URL(new URL(url), location).toString());
                return null;
            }
            long length = c.getContentLengthLong();
            if (length > MAX_FILE) return null;

            Fetched f = new Fetched();
            f.status = status;
            f.reason = c.getResponseMessage();
            String type = c.getContentType();
            f.mime = mimeOf(type, url);
            f.encoding = charsetOf(type);
            for (Map.Entry<String, List<String>> e : c.getHeaderFields().entrySet()) {
                String k = e.getKey();
                if (k == null || e.getValue() == null) continue;
                String lk = k.toLowerCase(Locale.ROOT);
                if (lk.equals("set-cookie") || lk.equals("content-encoding") || lk.equals("content-length")
                        || lk.equals("transfer-encoding") || lk.equals("connection")) continue;
                f.headers.put(k, join(e.getValue()));
            }
            InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
            f.body = in == null ? new byte[0] : readAll(in, MAX_FILE + 1);
            if (f.body.length > MAX_FILE) return null;
            return f;
        } finally {
            c.disconnect();
        }
    }

    // ---------------------------------------------------------------- disk

    File file(String url) {
        return new File(dir, sha1(url));
    }

    void save(String url, Fetched f) {
        File target = file(url);
        File tmp = new File(dir, target.getName() + ".tmp");
        try (DataOutputStream out = new DataOutputStream(new FileOutputStream(tmp))) {
            out.writeInt(1); // format version
            out.writeUTF(f.mime == null ? "" : f.mime);
            out.writeUTF(f.encoding == null ? "" : f.encoding);
            out.writeInt(f.headers.size());
            for (Map.Entry<String, String> e : f.headers.entrySet()) {
                out.writeUTF(e.getKey());
                out.writeUTF(e.getValue().length() > 8000 ? e.getValue().substring(0, 8000) : e.getValue());
            }
            out.writeInt(f.body.length);
            out.write(f.body);
        } catch (IOException e) {
            tmp.delete();
            return;
        }
        if (!tmp.renameTo(target)) {
            target.delete();
            tmp.renameTo(target);
        }
        if (++writes % 40 == 1) trim();
    }

    void saveRedirect(String from, String to) {
        if (from.equals(to)) return;
        File tmp = new File(dir, file(from).getName() + ".tmp");
        try (DataOutputStream out = new DataOutputStream(new FileOutputStream(tmp))) {
            out.writeInt(2); // a redirect
            out.writeUTF(to);
        } catch (IOException e) {
            tmp.delete();
            return;
        }
        File target = file(from);
        if (!tmp.renameTo(target)) {
            target.delete();
            tmp.renameTo(target);
        }
    }

    Fetched read(String url) {
        return read(url, 0);
    }

    Fetched read(String url, int hops) {
        File f = file(url);
        if (!f.exists() || hops > 4) return null;
        try (DataInputStream in = new DataInputStream(new FileInputStream(f))) {
            int version = in.readInt();
            if (version == 2) return read(in.readUTF(), hops + 1);
            if (version != 1) return null;
            Fetched out = new Fetched();
            out.status = 200;
            out.reason = "OK";
            out.mime = emptyToNull(in.readUTF());
            out.encoding = emptyToNull(in.readUTF());
            int n = in.readInt();
            for (int i = 0; i < n; i++) out.headers.put(in.readUTF(), in.readUTF());
            out.body = new byte[in.readInt()];
            in.readFully(out.body);
            f.setLastModified(System.currentTimeMillis()); // recently used stays longest
            return out;
        } catch (IOException e) {
            return null;
        }
    }

    /** Keeps the cache under MAX_TOTAL by dropping the least recently used files. */
    void trim() {
        File[] files = dir.listFiles();
        if (files == null) return;
        long total = 0;
        for (File f : files) total += f.length();
        if (total <= MAX_TOTAL) return;
        Arrays.sort(files, new Comparator<File>() {
            public int compare(File a, File b) {
                return Long.compare(a.lastModified(), b.lastModified());
            }
        });
        for (File f : files) {
            if (total <= MAX_TOTAL * 8 / 10) break;
            total -= f.length();
            f.delete();
        }
    }

    // ---------------------------------------------------------------- helpers

    static String mimeOf(String contentType, String url) {
        if (contentType != null && !contentType.isEmpty()) {
            int semi = contentType.indexOf(';');
            return (semi >= 0 ? contentType.substring(0, semi) : contentType).trim();
        }
        String lower = url.toLowerCase(Locale.ROOT);
        if (lower.contains(".js")) return "text/javascript";
        if (lower.contains(".css")) return "text/css";
        return "application/octet-stream";
    }

    static String charsetOf(String contentType) {
        if (contentType == null) return null;
        for (String part : contentType.split(";")) {
            String p = part.trim();
            if (p.toLowerCase(Locale.ROOT).startsWith("charset=")) return p.substring(8).replace("\"", "").trim();
        }
        return contentType.startsWith("text/") || contentType.contains("json") || contentType.contains("javascript") ? "utf-8" : null;
    }

    static String join(List<String> values) {
        StringBuilder b = new StringBuilder();
        for (String v : values) {
            if (v == null) continue;
            if (b.length() > 0) b.append(", ");
            b.append(v);
        }
        return b.toString();
    }

    static byte[] readAll(InputStream in, long limit) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        try {
            while ((n = in.read(buf)) != -1) {
                out.write(buf, 0, n);
                if (out.size() > limit) break;
            }
        } finally {
            in.close();
        }
        return out.toByteArray();
    }

    static String emptyToNull(String s) {
        return s == null || s.isEmpty() ? null : s;
    }

    static String sha1(String s) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-1").digest(s.getBytes("UTF-8"));
            StringBuilder b = new StringBuilder();
            for (byte x : d) b.append(String.format(Locale.ROOT, "%02x", x));
            return b.toString();
        } catch (Exception e) {
            return Integer.toHexString(s.hashCode());
        }
    }
}
