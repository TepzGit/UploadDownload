package com.geek4u.app;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.CookieManager;
import android.webkit.MimeTypeMap;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Locale;
import java.util.Set;

/**
 * Copies the Files folders the member picked on their Profile ("Phone sync") into
 * Download/Geek4u on the phone, where the Files app shows them, and keeps them matching the
 * server: new and changed files come down, files gone from the server (or from the picked
 * folders) are removed. Only files this app put there are ever touched.
 *
 * Android 10 and newer: written through MediaStore, so no storage permission is needed.
 * Android 9 and older: written straight into Download/Geek4u (needs the storage permission).
 */
final class SyncEngine {
    interface Listener {
        void onStatus(JSONObject status);
    }

    static final String FOLDER = "Geek4u";
    static final String WHERE = "Files › Download › " + FOLDER;

    final Context context;
    final File indexFile;
    final Listener listener;
    volatile boolean running;
    JSONObject status = new JSONObject();

    SyncEngine(Context context, Listener listener) {
        this.context = context.getApplicationContext();
        this.indexFile = new File(context.getFilesDir(), "sync-index.json");
        this.listener = listener;
        JSONObject saved = readJson(indexFile);
        try {
            status.put("state", "idle");
            status.put("where", WHERE);
            if (saved != null) {
                status.put("last", saved.optLong("last"));
                status.put("files", saved.optJSONObject("files") == null ? 0 : saved.optJSONObject("files").length());
                status.put("bytes", saved.optLong("bytes"));
            }
        } catch (JSONException e) {
            // never for these values
        }
    }

    long lastSync() {
        return status.optLong("last");
    }

    synchronized JSONObject status() {
        try {
            return new JSONObject(status.toString());
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    /** Starts a sync on its own thread (does nothing while one runs). */
    void start(final String server, final String userAgent, final boolean canWriteOld) {
        synchronized (this) {
            if (running || server == null || server.isEmpty()) return;
            running = true;
        }
        new Thread(new Runnable() {
            public void run() {
                try {
                    if (Build.VERSION.SDK_INT < 29 && !canWriteOld) {
                        fail("Allow Geek4u to save files on this phone to sync your folders.");
                        return;
                    }
                    sync(server, userAgent);
                } catch (Exception e) {
                    fail(e instanceof IOException ? "Couldn't reach the server. Sync will try again later."
                            : "Sync stopped: " + e.getMessage());
                } finally {
                    running = false;
                }
            }
        }, "geek4u-sync").start();
    }

    // ---------------------------------------------------------------- the sync

    void sync(String server, String userAgent) throws Exception {
        update("running", 0, 0, null);
        JSONObject manifest = getJson(server + "/sync/manifest", userAgent);
        JSONArray list = manifest.optJSONArray("files");
        if (list == null) list = new JSONArray();

        JSONObject index = readJson(indexFile);
        if (index == null) index = new JSONObject();
        JSONObject have = index.optJSONObject("files");
        if (have == null) have = new JSONObject();

        Set<String> wanted = new HashSet<>();
        int total = list.length(), done = 0, failed = 0;
        long bytes = 0;
        long lastSave = System.currentTimeMillis();
        for (int i = 0; i < list.length(); i++) {
            JSONObject f = list.getJSONObject(i);
            String path = cleanPath(f.optString("path"));
            if (path == null) {
                total--;
                continue;
            }
            wanted.add(path);
            long size = f.optLong("size"), mtime = f.optLong("mtime");
            JSONObject old = have.optJSONObject(path);
            boolean same = old != null && old.optLong("size") == size && old.optLong("mtime") == mtime && stillThere(old);
            if (!same) {
                try {
                    String where = download(server, userAgent, path, old);
                    JSONObject entry = new JSONObject();
                    entry.put("size", size);
                    entry.put("mtime", mtime);
                    entry.put("at", where);
                    have.put(path, entry);
                } catch (IOException e) {
                    failed++;
                    if (!reachable(server)) throw e;
                }
            }
            if (have.has(path)) bytes += size;
            done++;
            if (System.currentTimeMillis() - lastSave > 1500) {
                index.put("files", have);
                writeJson(indexFile, index);
                lastSave = System.currentTimeMillis();
                update("running", done, total, null);
            }
        }

        // Files no longer on the server, or in a folder that was unticked.
        Iterator<String> keys = have.keys();
        Set<String> drop = new HashSet<>();
        while (keys.hasNext()) {
            String k = keys.next();
            if (!wanted.contains(k)) drop.add(k);
        }
        for (String k : drop) {
            remove(have.optJSONObject(k));
            have.remove(k);
        }

        index.put("files", have);
        index.put("bytes", bytes);
        index.put("last", System.currentTimeMillis());
        writeJson(indexFile, index);
        synchronized (this) {
            status.put("last", index.getLong("last"));
            status.put("files", have.length());
            status.put("bytes", bytes);
        }
        if (failed > 0) fail(failed + (failed == 1 ? " file" : " files") + " couldn't be copied. Sync will try again.");
        else update("idle", done, total, null);
    }

    JSONObject getJson(String url, String userAgent) throws Exception {
        HttpURLConnection c = open(url, userAgent);
        try {
            int code = c.getResponseCode();
            String type = c.getContentType() == null ? "" : c.getContentType();
            if (code == 403) throw new Exception("your account has no Files access.");
            if (code >= 300 && code < 400 || code == 401 || !type.contains("json")) throw new Exception("log in again in the app.");
            if (code != 200) throw new IOException("server answered " + code);
            byte[] body = OfflineCache.readAll(c.getInputStream(), 64L * 1024 * 1024);
            return new JSONObject(new String(body, "UTF-8"));
        } finally {
            c.disconnect();
        }
    }

    HttpURLConnection open(String url, String userAgent) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setInstanceFollowRedirects(false);
        c.setConnectTimeout(15000);
        c.setReadTimeout(60000);
        c.setUseCaches(false);
        if (userAgent != null) c.setRequestProperty("User-Agent", userAgent);
        String cookie = CookieManager.getInstance().getCookie(url);
        if (cookie != null && !cookie.isEmpty()) c.setRequestProperty("Cookie", cookie);
        return c;
    }

    boolean reachable(String server) {
        try {
            HttpURLConnection c = open(server + "/sync/folders", null);
            c.setConnectTimeout(7000);
            c.getResponseCode();
            c.disconnect();
            return true;
        } catch (IOException e) {
            return false;
        }
    }

    /** Downloads one file over the old copy (or as a new one). Answers where it is now. */
    String download(String server, String userAgent, String path, JSONObject old) throws IOException {
        HttpURLConnection c = open(server + "/sync/file?path=" + URLEncoder.encode(path, "UTF-8"), userAgent);
        try {
            int code = c.getResponseCode();
            if (code != 200) throw new IOException("server answered " + code + " for " + path);
            InputStream in = c.getInputStream();
            try {
                return Build.VERSION.SDK_INT >= 29 ? writeMediaStore(path, old, in) : writeFile(path, in);
            } finally {
                in.close();
            }
        } finally {
            c.disconnect();
        }
    }

    // ---------------------------------------------------------------- where the files go

    String writeMediaStore(String path, JSONObject old, InputStream in) throws IOException {
        ContentResolver cr = context.getContentResolver();
        Uri target = null;
        if (old != null && old.optString("at").startsWith("content:")) {
            target = Uri.parse(old.optString("at"));
            OutputStream out = null;
            try {
                out = cr.openOutputStream(target, "wt");
            } catch (Exception e) {
                out = null; // deleted from the Files app: make a new one
            }
            if (out != null) {
                copy(in, out);
                return target.toString();
            }
        }
        int slash = path.lastIndexOf('/');
        String dir = Environment.DIRECTORY_DOWNLOADS + "/" + FOLDER + (slash > 0 ? "/" + path.substring(0, slash) : "");
        String name = path.substring(slash + 1);
        Uri collection = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        // A file with this name that this app put there before (the index got lost): reuse it.
        target = findOwn(cr, collection, dir + "/", name);
        if (target == null) {
            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            v.put(MediaStore.MediaColumns.MIME_TYPE, mimeOf(name));
            v.put(MediaStore.MediaColumns.RELATIVE_PATH, dir);
            v.put(MediaStore.MediaColumns.IS_PENDING, 1);
            target = cr.insert(collection, v);
            if (target == null) throw new IOException("couldn't make " + path);
        }
        OutputStream out = cr.openOutputStream(target, "wt");
        if (out == null) throw new IOException("couldn't write " + path);
        copy(in, out);
        ContentValues done = new ContentValues();
        done.put(MediaStore.MediaColumns.IS_PENDING, 0);
        cr.update(target, done, null, null);
        return target.toString();
    }

    static Uri findOwn(ContentResolver cr, Uri collection, String relativePath, String name) {
        String[] cols = {MediaStore.MediaColumns._ID};
        Cursor c = null;
        try {
            c = cr.query(collection, cols, MediaStore.MediaColumns.RELATIVE_PATH + "=? AND "
                    + MediaStore.MediaColumns.DISPLAY_NAME + "=?", new String[]{relativePath, name}, null);
            if (c != null && c.moveToFirst()) return ContentUris.withAppendedId(collection, c.getLong(0));
        } catch (Exception e) {
            // not found
        } finally {
            if (c != null) c.close();
        }
        return null;
    }

    @SuppressWarnings("deprecation")
    static File oldRoot() {
        return new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), FOLDER);
    }

    String writeFile(String path, InputStream in) throws IOException {
        File target = new File(oldRoot(), path);
        File parent = target.getParentFile();
        if (parent != null) parent.mkdirs();
        File tmp = new File(parent, "." + target.getName() + ".part");
        copy(in, new FileOutputStream(tmp));
        if (!tmp.renameTo(target)) {
            target.delete();
            if (!tmp.renameTo(target)) throw new IOException("couldn't save " + path);
        }
        return target.getAbsolutePath();
    }

    boolean stillThere(JSONObject entry) {
        String at = entry.optString("at");
        if (at.isEmpty()) return false;
        if (!at.startsWith("content:")) return new File(at).exists();
        Cursor c = null;
        try {
            c = context.getContentResolver().query(Uri.parse(at), new String[]{MediaStore.MediaColumns._ID}, null, null, null);
            return c != null && c.moveToFirst();
        } catch (Exception e) {
            return false;
        } finally {
            if (c != null) c.close();
        }
    }

    void remove(JSONObject entry) {
        if (entry == null) return;
        String at = entry.optString("at");
        try {
            if (at.startsWith("content:")) context.getContentResolver().delete(Uri.parse(at), null, null);
            else if (!at.isEmpty()) new File(at).delete();
        } catch (Exception e) {
            // already gone, or the user took it over
        }
    }

    // ---------------------------------------------------------------- helpers

    /** "a/b/c.jpg" from the server, or null when it tries to leave the folder. */
    static String cleanPath(String p) {
        if (p == null) return null;
        p = p.replace('\\', '/');
        StringBuilder b = new StringBuilder();
        for (String part : p.split("/")) {
            if (part.isEmpty() || part.equals(".")) continue;
            if (part.equals("..")) return null;
            if (b.length() > 0) b.append('/');
            b.append(part);
        }
        return b.length() == 0 ? null : b.toString();
    }

    static String mimeOf(String name) {
        int dot = name.lastIndexOf('.');
        String ext = dot >= 0 ? name.substring(dot + 1).toLowerCase(Locale.ROOT) : "";
        String m = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
        return m != null ? m : "application/octet-stream";
    }

    static void copy(InputStream in, OutputStream out) throws IOException {
        try {
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
        } finally {
            out.close();
        }
    }

    void update(String state, int done, int total, String error) {
        JSONObject copy;
        synchronized (this) {
            try {
                status.put("state", state);
                status.put("done", done);
                status.put("total", total);
                if (error == null) status.remove("error");
                else status.put("error", error);
            } catch (JSONException e) {
                // never
            }
            copy = status();
        }
        if (listener != null) listener.onStatus(copy);
    }

    void fail(String message) {
        update("error", 0, 0, message);
    }

    static JSONObject readJson(File f) {
        if (!f.exists()) return null;
        try {
            FileInputStream in = new FileInputStream(f);
            return new JSONObject(new String(OfflineCache.readAll(in, 64L * 1024 * 1024), "UTF-8"));
        } catch (Exception e) {
            return null;
        }
    }

    static void writeJson(File f, JSONObject o) {
        File tmp = new File(f.getPath() + ".tmp");
        try {
            FileOutputStream out = new FileOutputStream(tmp);
            out.write(o.toString().getBytes("UTF-8"));
            out.close();
            if (!tmp.renameTo(f)) {
                f.delete();
                tmp.renameTo(f);
            }
        } catch (IOException e) {
            tmp.delete();
        }
    }
}
