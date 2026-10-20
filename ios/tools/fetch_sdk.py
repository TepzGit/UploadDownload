# Fetches the parts of the iOS 15.6 SDK the app needs from github.com/theos/sdks (via
# raw.githubusercontent.com), following #include/#import lines, so clang can compile against it.
import os, re, sys, threading, queue, urllib.request, urllib.error

BASE = "https://raw.githubusercontent.com/theos/sdks/master/iPhoneOS15.6.sdk/"
OUT = sys.argv[1]
seeds = sys.argv[2:]
FW = "System/Library/Frameworks/"
done, lock = set(), threading.Lock()
q = queue.Queue()
missing = []

def get(rel, depth=0):
    local = os.path.join(OUT, rel)
    if os.path.isfile(local):
        return open(local, "rb").read()
    data = None
    for attempt in range(4):
        try:
            data = urllib.request.urlopen(BASE + rel, timeout=60).read()
            break
        except urllib.error.HTTPError as e:
            return None
        except Exception:
            if attempt == 3:
                missing.append(rel)
                return None
    # git stores symlinks as a file holding the target path
    if len(data) < 200 and b"\n" not in data.strip() and not data.strip().startswith((b"#", b"/", b"-")) and depth < 4:
        target = os.path.normpath(os.path.join(os.path.dirname(rel), data.decode().strip()))
        d2 = get(target, depth + 1)
        if d2 is not None:
            return d2
    return data

def candidates(inc, frm):
    out = []
    if "/" in inc:
        fw, rest = inc.split("/", 1)
        out.append(FW + fw + ".framework/Headers/" + rest)
        out.append(FW + fw + ".framework/PrivateHeaders/" + rest)
        # sub-frameworks (e.g. CoreServices -> CarbonCore) are searched via the umbrella's Frameworks dir
        m = re.match(r"(System/Library/Frameworks/[^/]+\.framework)/", frm)
        if m:
            out.append(m.group(1) + "/Frameworks/" + fw + ".framework/Headers/" + rest)
    out.append("usr/include/" + inc)
    return out

def worker():
    while True:
        rel = q.get()
        try:
            data = get(rel)
            if data is None:
                continue
            path = os.path.join(OUT, rel)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            open(path, "wb").write(data)
            if rel.endswith((".h", ".modulemap")) or "/include/" in rel and "." not in os.path.basename(rel):
                for m in re.finditer(rb'^\s*#\s*(?:include|import|include_next)\s*[<"]([^>"]+)[>"]', data, re.M):
                    inc = m.group(1).decode()
                    local = os.path.normpath(os.path.join(os.path.dirname(rel), inc))
                    for c in [local] + candidates(inc, rel):
                        add(c)
        finally:
            q.task_done()

def add(rel):
    with lock:
        if rel in done:
            return
        done.add(rel)
    q.put(rel)

for _ in range(24):
    threading.Thread(target=worker, daemon=True).start()
for s in seeds:
    add(s)
q.join()
n = sum(len(fs) for _, _, fs in os.walk(OUT))
print("files:", n, "requested:", len(done), "network failures:", len(missing))
