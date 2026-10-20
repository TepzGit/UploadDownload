# Runs the link and fetches each re-exported library's .tbd the linker asks for, until it links.
import os, re, subprocess, sys, urllib.request, urllib.error
SDK = sys.argv[1]
cmd = sys.argv[2:]
BASE = "https://raw.githubusercontent.com/theos/sdks/master/iPhoneOS15.6.sdk/"
for i in range(80):
    r = subprocess.run(cmd, capture_output=True, text=True)
    m = re.search(r"re-export with install name (\S+)", r.stderr)
    if not m:
        print(r.stderr[:3000]); print("exit", r.returncode); break
    rel = m.group(1).lstrip("/") + ".tbd"
    try:
        data = urllib.request.urlopen(BASE + rel, timeout=60).read()
    except urllib.error.HTTPError as e:
        print("missing", rel, e.code); print(r.stderr[:2000]); break
    path = os.path.join(SDK, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "wb").write(data)
    print("fetched", rel)
