// See gkproxy.h. One thread per connection; every answer is sent with "Connection: close", so
// each request is one connection to the server and one back to the web view.

#include "gkproxy.h"

#include <arpa/inet.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <netdb.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <poll.h>
#include <pthread.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <time.h>
#include <unistd.h>

#define HEAD_MAX 65536
#define MAX_FILE (12L * 1024 * 1024)
#define MAX_TOTAL (150L * 1024 * 1024)

// Whole pages that open offline (other pages are never saved, so they say "you need internet").
static const char *kPages[] = {"/", "/Main", "/Profile", "/Utility", "/journal", "/journal/Drug", "/Music", NULL};
// Never saved: big or private file transfers, and anything that changes something on a GET.
static const char *kSkip[] = {"/Files/", "/Uploader", "/upload", "/logout", "/getItems", "/search",
                              "/replications/", "/download", "/sync/", "/music/stream/", "/music/offline", NULL};

static pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;
static int listen_fd = -1;
static int cfg_port;
static char cfg_host[256];
static int cfg_upstream_port;
static char cfg_cache[1024];
static char cfg_music[1024]; // songs kept on the phone (gk_proxy_set_music_dir)
static char proxy_origin[64];
static char upstream_origin[300];
static time_t down_until; // the server didn't answer lately: saved copies go out at once
static int writes;

typedef struct {
    int fd;
    char host[256];
    int port;
    char cache[1024];
    char music[1024];
    char proxy_origin[64];
    char upstream_origin[300];
} conn_t;

// ---------------------------------------------------------------- small helpers

static int send_all(int fd, const char *buf, size_t n) {
    while (n > 0) {
        ssize_t w = send(fd, buf, n, 0);
        if (w < 0 && errno == EINTR) continue;
        if (w <= 0) return -1;
        buf += w;
        n -= (size_t)w;
    }
    return 0;
}

static void set_timeouts(int fd, int seconds) {
    struct timeval tv = {seconds, 0};
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof tv);
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof tv);
#ifdef SO_NOSIGPIPE
    int one = 1;
    setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &one, sizeof one);
#endif
}

// Reads until the blank line after the headers. Answers how many bytes are in buf (the head
// and maybe the start of the body), and the head's length in *head_len; -1 on failure.
static ssize_t read_head(int fd, char *buf, size_t cap, size_t *head_len) {
    size_t got = 0;
    while (got < cap - 1) {
        ssize_t r = recv(fd, buf + got, cap - 1 - got, 0);
        if (r < 0 && errno == EINTR) continue;
        if (r <= 0) return -1;
        size_t from = got > 3 ? got - 3 : 0;
        got += (size_t)r;
        buf[got] = 0;
        char *end = NULL;
        for (size_t i = from; i + 3 < got; i++) {
            if (buf[i] == '\r' && buf[i + 1] == '\n' && buf[i + 2] == '\r' && buf[i + 3] == '\n') {
                end = buf + i + 4;
                break;
            }
        }
        if (end) {
            *head_len = (size_t)(end - buf);
            return (ssize_t)got;
        }
    }
    return -1;
}

static int starts_with_ci(const char *s, const char *prefix) {
    return strncasecmp(s, prefix, strlen(prefix)) == 0;
}

// The value of header name in a head (lines end in \r\n), copied into out; 1 when found.
static int header_value(const char *head, size_t head_len, const char *name, char *out, size_t cap) {
    size_t nlen = strlen(name);
    const char *p = memchr(head, '\n', head_len);
    const char *end = head + head_len;
    while (p && p + 1 < end) {
        const char *line = p + 1;
        const char *eol = memchr(line, '\n', (size_t)(end - line));
        if (!eol) break;
        if ((size_t)(eol - line) > nlen && strncasecmp(line, name, nlen) == 0 && line[nlen] == ':') {
            const char *v = line + nlen + 1;
            while (v < eol && (*v == ' ' || *v == '\t')) v++;
            size_t n = (size_t)(eol - v);
            if (n > 0 && v[n - 1] == '\r') n--;
            if (n >= cap) n = cap - 1;
            memcpy(out, v, n);
            out[n] = 0;
            return 1;
        }
        p = eol;
    }
    return 0;
}

static int in_list(const char *path, const char **list, int prefix) {
    for (int i = 0; list[i]; i++) {
        if (prefix ? strncmp(path, list[i], strlen(list[i])) == 0 : strcmp(path, list[i]) == 0) return 1;
    }
    return 0;
}

static uint64_t fnv(const char *s) {
    uint64_t h = 1469598103934665603ULL;
    for (; *s; s++) {
        h ^= (unsigned char)*s;
        h *= 1099511628211ULL;
    }
    return h;
}

static void cache_file(const conn_t *c, const char *key, char *out, size_t cap) {
    snprintf(out, cap, "%s/%016llx", c->cache, (unsigned long long)fnv(key));
}

// ---------------------------------------------------------------- the saved copies

static void trim_cache(const char *dir) {
    DIR *d = opendir(dir);
    if (!d) return;
    typedef struct { char name[64]; time_t at; off_t size; } item_t;
    item_t *items = NULL;
    size_t n = 0, cap = 0;
    long long total = 0;
    struct dirent *e;
    while ((e = readdir(d))) {
        if (e->d_name[0] == '.' || strlen(e->d_name) >= 64) continue;
        char p[1200];
        snprintf(p, sizeof p, "%s/%s", dir, e->d_name);
        struct stat st;
        if (stat(p, &st) != 0 || !S_ISREG(st.st_mode)) continue;
        if (n == cap) {
            cap = cap ? cap * 2 : 256;
            item_t *grown = realloc(items, cap * sizeof *items);
            if (!grown) break;
            items = grown;
        }
        snprintf(items[n].name, sizeof items[n].name, "%s", e->d_name);
        items[n].at = st.st_mtime;
        items[n].size = st.st_size;
        total += st.st_size;
        n++;
    }
    closedir(d);
    // Over the limit: the least recently used go first, down to 80%.
    if (total <= MAX_TOTAL) n = 0;
    while (total > MAX_TOTAL * 8 / 10 && n > 0) {
        size_t oldest = 0;
        for (size_t i = 1; i < n; i++) if (items[i].at < items[oldest].at) oldest = i;
        char p[1200];
        snprintf(p, sizeof p, "%s/%s", dir, items[oldest].name);
        unlink(p);
        total -= items[oldest].size;
        items[oldest] = items[--n];
    }
    free(items);
}

// Sends the saved copy for key; 1 when there was one.
static int replay(const conn_t *c, const char *key) {
    char path[1200];
    cache_file(c, key, path, sizeof path);
    int fd = open(path, O_RDONLY);
    if (fd < 0) return 0;
    char buf[65536];
    ssize_t r;
    while ((r = read(fd, buf, sizeof buf)) > 0) {
        if (send_all(c->fd, buf, (size_t)r) != 0) break; // the page went away
    }
    close(fd);
    utimes(path, NULL); // recently used stays longest
    return 1;
}

// ---------------------------------------------------------------- talking to the server

static int connect_upstream(const conn_t *c, int timeout_ms) {
    char port[16];
    snprintf(port, sizeof port, "%d", c->port);
    struct addrinfo hints = {0}, *res = NULL;
    hints.ai_socktype = SOCK_STREAM;
    hints.ai_family = AF_UNSPEC;
    if (getaddrinfo(c->host, port, &hints, &res) != 0) return -1;
    int fd = -1;
    for (struct addrinfo *a = res; a; a = a->ai_next) {
        fd = socket(a->ai_family, a->ai_socktype, a->ai_protocol);
        if (fd < 0) continue;
        int flags = fcntl(fd, F_GETFL, 0);
        fcntl(fd, F_SETFL, flags | O_NONBLOCK);
        int rc = connect(fd, a->ai_addr, a->ai_addrlen);
        if (rc != 0 && errno == EINPROGRESS) {
            struct pollfd p = {fd, POLLOUT, 0};
            rc = poll(&p, 1, timeout_ms) == 1 ? 0 : -1;
            if (rc == 0) {
                int err = 0;
                socklen_t len = sizeof err;
                getsockopt(fd, SOL_SOCKET, SO_ERROR, &err, &len);
                if (err) rc = -1;
            }
        }
        if (rc == 0) {
            fcntl(fd, F_SETFL, flags);
            int one = 1;
            setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof one);
            break;
        }
        close(fd);
        fd = -1;
    }
    freeaddrinfo(res);
    return fd;
}

static void put_line(char *out, size_t *n, size_t cap, const char *line, size_t len) {
    if (*n + len + 1 >= cap) return;
    memcpy(out + *n, line, len);
    *n += len;
}

// A header line, with the value's leading from swapped for to (Origin, Referer, Location).
static void put_rewritten(char *out, size_t *n, size_t cap, const char *name, const char *value, size_t vlen,
                          const char *from, const char *to) {
    char line[HEAD_MAX];
    size_t flen = strlen(from);
    int k;
    if (vlen >= flen && strncasecmp(value, from, flen) == 0) {
        k = snprintf(line, sizeof line, "%s: %s%.*s\r\n", name, to, (int)(vlen - flen), value + flen);
    } else {
        k = snprintf(line, sizeof line, "%s: %.*s\r\n", name, (int)vlen, value);
    }
    if (k > 0 && (size_t)k < sizeof line) put_line(out, n, cap, line, (size_t)k);
}

// Rebuilds a head: drops the hop headers, adds Host (requests) and Connection: close.
static size_t rewrite_head(const char *head, size_t head_len, char *out, size_t cap, const conn_t *c, int request) {
    size_t n = 0;
    const char *end = head + head_len;
    const char *eol = memchr(head, '\n', head_len);
    if (!eol) return 0;
    put_line(out, &n, cap, head, (size_t)(eol - head + 1));
    if (request) {
        char host[300];
        int k = c->port == 80 ? snprintf(host, sizeof host, "Host: %s\r\n", c->host)
                              : snprintf(host, sizeof host, "Host: %s:%d\r\n", c->host, c->port);
        put_line(out, &n, cap, host, (size_t)k);
    }
    const char *line = eol + 1;
    while (line < end) {
        const char *le = memchr(line, '\n', (size_t)(end - line));
        if (!le) break;
        size_t len = (size_t)(le - line + 1);
        if (len <= 2) break; // the blank line
        const char *colon = memchr(line, ':', len);
        if (colon) {
            size_t nlen = (size_t)(colon - line);
            const char *v = colon + 1;
            while (v < le && (*v == ' ' || *v == '\t')) v++;
            size_t vlen = (size_t)(le - v);
            if (vlen > 0 && v[vlen - 1] == '\r') vlen--;
            char name[64];
            if (nlen < sizeof name) {
                memcpy(name, line, nlen);
                name[nlen] = 0;
                if (!strcasecmp(name, "Connection") || !strcasecmp(name, "Keep-Alive") || !strcasecmp(name, "Proxy-Connection")
                    || (request && !strcasecmp(name, "Host"))) {
                    line = le + 1;
                    continue;
                }
                if (request && (!strcasecmp(name, "Origin") || !strcasecmp(name, "Referer"))) {
                    put_rewritten(out, &n, cap, name, v, vlen, c->proxy_origin, c->upstream_origin);
                    line = le + 1;
                    continue;
                }
                if (!request && !strcasecmp(name, "Location")) {
                    put_rewritten(out, &n, cap, name, v, vlen, c->upstream_origin, c->proxy_origin);
                    line = le + 1;
                    continue;
                }
            }
        }
        put_line(out, &n, cap, line, len);
        line = le + 1;
    }
    put_line(out, &n, cap, "Connection: close\r\n\r\n", 21);
    return n;
}

static int server_down(void) {
    pthread_mutex_lock(&lock);
    int down = time(NULL) < down_until;
    pthread_mutex_unlock(&lock);
    return down;
}

static void mark_down(int down) {
    pthread_mutex_lock(&lock);
    down_until = down ? time(NULL) + 5 : 0;
    pthread_mutex_unlock(&lock);
}

// ---------------------------------------------------------------- songs kept on the phone

// /music/stream/<id>?v=<version> is answered from <music dir>/<id>-<version>.audio when the
// app saved that song (with its type in .mime), online or not, with Range for seeking.
// 1 when it was answered here.
static int serve_music(const conn_t *c, const char *method, const char *target, const char *req, size_t head_len) {
    if (!c->music[0] || strncmp(target, "/music/stream/", 14) != 0) return 0;
    const char *p = target + 14;
    char id[24] = {0}, v[64] = {0};
    size_t n = 0;
    while (*p >= '0' && *p <= '9' && n < sizeof id - 1) id[n++] = *p++;
    if (!n) return 0;
    const char *q = strstr(p, "v=");
    if (*p != '?' || !q || (q[-1] != '?' && q[-1] != '&')) return 0;
    q += 2;
    n = 0;
    while (((*q >= '0' && *q <= '9') || (*q >= 'a' && *q <= 'z') || (*q >= 'A' && *q <= 'Z')) && n < sizeof v - 1) v[n++] = *q++;
    if (!n) return 0;
    char path[1200], mime_path[1200], mime[128] = "audio/mpeg";
    snprintf(path, sizeof path, "%s/%s-%s.audio", c->music, id, v);
    snprintf(mime_path, sizeof mime_path, "%s/%s-%s.mime", c->music, id, v);
    int fd = open(path, O_RDONLY);
    if (fd < 0) return 0;
    struct stat st;
    if (fstat(fd, &st) != 0 || st.st_size <= 0) {
        close(fd);
        return 0;
    }
    FILE *mf = fopen(mime_path, "r");
    if (mf) {
        if (fgets(mime, sizeof mime, mf)) mime[strcspn(mime, "\r\n;")] = 0;
        fclose(mf);
        if (!mime[0] || strchr(mime, ' ')) snprintf(mime, sizeof mime, "audio/mpeg");
    }
    long long size = (long long)st.st_size, from = 0, to = size - 1;
    char range[128];
    int partial = 0;
    if (header_value(req, head_len, "Range", range, sizeof range) && starts_with_ci(range, "bytes=")) {
        const char *r = range + 6;
        if (*r == '-') { // the last N bytes
            long long last = atoll(r + 1);
            if (last > 0) from = size > last ? size - last : 0;
        } else {
            from = atoll(r);
            const char *dash = strchr(r, '-');
            if (dash && dash[1] >= '0' && dash[1] <= '9') to = atoll(dash + 1);
        }
        if (to >= size) to = size - 1;
        if (from > to || from >= size) {
            char head[256];
            int hn = snprintf(head, sizeof head, "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */%lld\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", size);
            send_all(c->fd, head, (size_t)hn);
            close(fd);
            return 1;
        }
        partial = 1;
    }
    char head[512];
    int hn;
    if (partial) {
        hn = snprintf(head, sizeof head, "HTTP/1.1 206 Partial Content\r\nContent-Type: %s\r\nContent-Length: %lld\r\nContent-Range: bytes %lld-%lld/%lld\r\n"
                      "Accept-Ranges: bytes\r\nCache-Control: private, max-age=31536000\r\nConnection: close\r\n\r\n", mime, to - from + 1, from, to, size);
    } else {
        hn = snprintf(head, sizeof head, "HTTP/1.1 200 OK\r\nContent-Type: %s\r\nContent-Length: %lld\r\nAccept-Ranges: bytes\r\n"
                      "Cache-Control: private, max-age=31536000\r\nConnection: close\r\n\r\n", mime, size);
    }
    if (send_all(c->fd, head, (size_t)hn) != 0 || strcmp(method, "HEAD") == 0) {
        close(fd);
        return 1;
    }
    if (lseek(fd, (off_t)from, SEEK_SET) < 0) {
        close(fd);
        return 1;
    }
    char buf[65536];
    long long left = to - from + 1;
    while (left > 0) {
        ssize_t r = read(fd, buf, (size_t)(left < (long long)sizeof buf ? left : (long long)sizeof buf));
        if (r < 0 && errno == EINTR) continue;
        if (r <= 0 || send_all(c->fd, buf, (size_t)r) != 0) break;
        left -= r;
    }
    close(fd);
    return 1;
}

static void *serve(void *arg) {
    conn_t *c = arg;
    char *req = malloc(HEAD_MAX), *out = malloc(HEAD_MAX + 1024), *resp = malloc(HEAD_MAX);
    int up = -1;
    if (!req || !out || !resp) goto done;
    set_timeouts(c->fd, 60);

    size_t head_len = 0;
    ssize_t got = read_head(c->fd, req, HEAD_MAX, &head_len);
    if (got < 0) goto done;

    char method[16] = {0}, target[4096] = {0};
    if (sscanf(req, "%15s %4095s", method, target) != 2 || target[0] != '/') goto done;
    char path[4096];
    snprintf(path, sizeof path, "%s", target);
    char *q = strpbrk(path, "?#");
    if (q) *q = 0;

    if ((strcmp(method, "GET") == 0 || strcmp(method, "HEAD") == 0) && serve_music(c, method, target, req, head_len)) goto done;

    char value[256];
    int is_get = strcmp(method, "GET") == 0;
    int ranged = header_value(req, head_len, "Range", value, sizeof value);
    int saveable = is_get && !ranged && !in_list(path, kSkip, 1);
    int page = in_list(path, kPages, 0);
    char key[4200], page_key[4200];
    snprintf(key, sizeof key, "GET %s", target);
    snprintf(page_key, sizeof page_key, "GET %s", path);
    int has_query = strcmp(path, target) != 0;

    long long body_left = 0;
    if (header_value(req, head_len, "Content-Length", value, sizeof value)) body_left = atoll(value);
    if (header_value(req, head_len, "Transfer-Encoding", value, sizeof value)) {
        const char *msg = "HTTP/1.1 411 Length Required\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        send_all(c->fd, msg, strlen(msg));
        goto done;
    }
    body_left -= (long long)((size_t)got - head_len);

    // Known to be down a moment ago: answer saved pages at once instead of waiting again.
    if (saveable && server_down() && (replay(c, key) || (page && has_query && replay(c, page_key)))) goto done;

    up = connect_upstream(c, 6000);
    if (up < 0) {
        mark_down(1);
        goto offline;
    }
    set_timeouts(up, 60);
    size_t n = rewrite_head(req, head_len, out, HEAD_MAX + 1024, c, 1);
    if (n == 0 || send_all(up, out, n) != 0) goto offline;
    if ((size_t)got > head_len && send_all(up, req + head_len, (size_t)got - head_len) != 0) goto offline;
    while (body_left > 0) {
        ssize_t r = recv(c->fd, req, (size_t)(body_left < HEAD_MAX ? body_left : HEAD_MAX), 0);
        if (r < 0 && errno == EINTR) continue;
        if (r <= 0) goto done;
        if (send_all(up, req, (size_t)r) != 0) goto offline;
        body_left -= r;
    }

    size_t rhead_len = 0;
    ssize_t rgot = read_head(up, resp, HEAD_MAX, &rhead_len);
    if (rgot < 0) goto offline;
    mark_down(0);

    int status = 0;
    sscanf(resp, "HTTP/%*s %d", &status);
    if (saveable && status == 200) {
        if (header_value(resp, rhead_len, "Content-Type", value, sizeof value) && starts_with_ci(value, "text/html") && !page)
            saveable = 0; // pages that need internet stay that way
        if (header_value(resp, rhead_len, "Content-Length", value, sizeof value) && atoll(value) > MAX_FILE) saveable = 0;
    } else {
        saveable = 0;
    }

    size_t rn = rewrite_head(resp, rhead_len, out, HEAD_MAX + 1024, c, 0);
    char tmp[1200] = {0};
    FILE *save = NULL;
    long long saved = 0;
    if (saveable) {
        char final_path[1200];
        cache_file(c, key, final_path, sizeof final_path);
        snprintf(tmp, sizeof tmp, "%s.%lx.part", final_path, (unsigned long)pthread_self());
        save = fopen(tmp, "wb");
        if (save && fwrite(out, 1, rn, save) != rn) { fclose(save); save = NULL; unlink(tmp); }
    }
    int client_ok = send_all(c->fd, out, rn) == 0;
    if (rgot > (ssize_t)rhead_len) {
        size_t extra = (size_t)rgot - rhead_len;
        if (client_ok) client_ok = send_all(c->fd, resp + rhead_len, extra) == 0;
        if (save) { fwrite(resp + rhead_len, 1, extra, save); saved += (long long)extra; }
    }
    int complete = 1;
    for (;;) {
        ssize_t r = recv(up, resp, HEAD_MAX, 0);
        if (r < 0 && errno == EINTR) continue;
        if (r < 0) { complete = 0; break; }
        if (r == 0) break;
        if (client_ok) client_ok = send_all(c->fd, resp, (size_t)r) == 0;
        if (save) {
            saved += r;
            if (saved > MAX_FILE || fwrite(resp, 1, (size_t)r, save) != (size_t)r) { fclose(save); save = NULL; unlink(tmp); }
        }
        if (!client_ok && !save) break;
    }
    if (save) {
        int ok = fclose(save) == 0 && complete;
        char final_path[1200];
        if (ok) {
            cache_file(c, key, final_path, sizeof final_path);
            ok = rename(tmp, final_path) == 0;
            // Drug info is the same page for every ?drug=, so it's also kept without the query.
            if (ok && page && has_query) {
                char page_path[1200], copy_tmp[1300];
                cache_file(c, page_key, page_path, sizeof page_path);
                snprintf(copy_tmp, sizeof copy_tmp, "%s.copy", page_path);
                FILE *src = fopen(final_path, "rb"), *dst = fopen(copy_tmp, "wb");
                if (src && dst) {
                    char b[65536];
                    size_t k;
                    while ((k = fread(b, 1, sizeof b, src)) > 0) fwrite(b, 1, k, dst);
                }
                if (src) fclose(src);
                if (dst && fclose(dst) == 0) rename(copy_tmp, page_path);
            }
        }
        if (!ok) unlink(tmp);
        pthread_mutex_lock(&lock);
        int w = ++writes;
        pthread_mutex_unlock(&lock);
        if (w % 40 == 1) trim_cache(c->cache);
    }
    goto done;

offline:
    // No answer from the server: the saved copy, or a closed connection (fetch throws, so the
    // page knows it's offline; a page load shows the app's "You need internet" screen).
    if (saveable && !replay(c, key) && page && has_query) replay(c, page_key);

done:
    if (up >= 0) close(up);
    close(c->fd);
    free(req);
    free(out);
    free(resp);
    free(c);
    return NULL;
}

// ---------------------------------------------------------------- listening

static void *accept_loop(void *arg) {
    int fd = (int)(intptr_t)arg;
    for (;;) {
        int client = accept(fd, NULL, NULL);
        if (client < 0) {
            if (errno == EINTR || errno == ECONNABORTED) continue;
            break; // closed by gk_proxy_stop, or iOS took the socket away
        }
        conn_t *c = calloc(1, sizeof *c);
        if (!c) {
            close(client);
            continue;
        }
        c->fd = client;
        pthread_mutex_lock(&lock);
        snprintf(c->host, sizeof c->host, "%s", cfg_host);
        c->port = cfg_upstream_port;
        snprintf(c->cache, sizeof c->cache, "%s", cfg_cache);
        snprintf(c->music, sizeof c->music, "%s", cfg_music);
        snprintf(c->proxy_origin, sizeof c->proxy_origin, "%s", proxy_origin);
        snprintf(c->upstream_origin, sizeof c->upstream_origin, "%s", upstream_origin);
        pthread_mutex_unlock(&lock);
        pthread_t t;
        pthread_attr_t attr;
        pthread_attr_init(&attr);
        pthread_attr_setdetachstate(&attr, PTHREAD_CREATE_DETACHED);
        pthread_attr_setstacksize(&attr, 512 * 1024);
        if (pthread_create(&t, &attr, serve, c) != 0) {
            close(client);
            free(c);
        }
        pthread_attr_destroy(&attr);
    }
    return NULL;
}

void gk_proxy_set_music_dir(const char *dir) {
    if (dir) mkdir(dir, 0700);
    pthread_mutex_lock(&lock);
    snprintf(cfg_music, sizeof cfg_music, "%s", dir ? dir : "");
    pthread_mutex_unlock(&lock);
}

void gk_proxy_stop(void) {
    pthread_mutex_lock(&lock);
    int fd = listen_fd;
    listen_fd = -1;
    pthread_mutex_unlock(&lock);
    if (fd >= 0) {
        shutdown(fd, SHUT_RDWR);
        close(fd);
    }
}

int gk_proxy_alive(void) {
    pthread_mutex_lock(&lock);
    int port = cfg_port, fd = listen_fd;
    pthread_mutex_unlock(&lock);
    if (fd < 0) return 0;
    int s = socket(AF_INET, SOCK_STREAM, 0);
    if (s < 0) return 0;
    struct sockaddr_in a = {0};
    a.sin_family = AF_INET;
    a.sin_port = htons((uint16_t)port);
    a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    set_timeouts(s, 2);
    int ok = connect(s, (struct sockaddr *)&a, sizeof a) == 0;
    close(s);
    return ok;
}

int gk_proxy_start(int port, const char *upstream_host, int upstream_port, const char *cache_dir) {
    signal(SIGPIPE, SIG_IGN);
    gk_proxy_stop();
    mkdir(cache_dir, 0700);

    int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) return -1;
    int one = 1;
    setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
    struct sockaddr_in a = {0};
    a.sin_family = AF_INET;
    a.sin_port = htons((uint16_t)port);
    a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    if (bind(fd, (struct sockaddr *)&a, sizeof a) != 0 || listen(fd, 64) != 0) {
        close(fd);
        return -1;
    }

    pthread_mutex_lock(&lock);
    listen_fd = fd;
    cfg_port = port;
    snprintf(cfg_host, sizeof cfg_host, "%s", upstream_host);
    cfg_upstream_port = upstream_port;
    snprintf(cfg_cache, sizeof cfg_cache, "%s", cache_dir);
    snprintf(proxy_origin, sizeof proxy_origin, "http://127.0.0.1:%d", port);
    if (upstream_port == 80) snprintf(upstream_origin, sizeof upstream_origin, "http://%s", upstream_host);
    else snprintf(upstream_origin, sizeof upstream_origin, "http://%s:%d", upstream_host, upstream_port);
    down_until = 0;
    pthread_mutex_unlock(&lock);

    pthread_t t;
    if (pthread_create(&t, NULL, accept_loop, (void *)(intptr_t)fd) != 0) {
        gk_proxy_stop();
        return -1;
    }
    pthread_detach(t);
    return 0;
}
