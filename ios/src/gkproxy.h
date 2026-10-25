// A small web proxy on 127.0.0.1 that the iOS app's web view loads the site through, so the
// site keeps working offline: every page, script, style and JSON answer it fetches is saved, and
// when the server can't be reached the saved copy is sent instead. Anything that isn't saved
// gets its connection closed, which the page sees as "offline" (fetch throws), so the site's
// own offline code (offline.js, the outbox) takes over.
//
// Plain POSIX C with threads, so it builds into the app and also on Linux for testing.

#ifndef GKPROXY_H
#define GKPROXY_H

// Starts (or restarts) the proxy on 127.0.0.1:port, forwarding to upstream_host:upstream_port
// over plain http, keeping saved answers in cache_dir. 0 when it is listening.
int gk_proxy_start(int port, const char *upstream_host, int upstream_port, const char *cache_dir);

// 1 when the proxy is still accepting connections (iOS can close a sleeping app's sockets).
int gk_proxy_alive(void);

void gk_proxy_stop(void);

// Songs the app saved for offline listening: /music/stream/<id>?v=<version> is answered from
// dir/<id>-<version>.audio (its type in .mime) whenever that file is there.
void gk_proxy_set_music_dir(const char *dir);

#endif
