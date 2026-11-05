"""
pillprep.py: turns pill photos into Geek4u pill pictures.

Give it a folder of photos named brand + dose, for example
    Elvanse 70.jpg, oxycontin80mg.png, Ritalin_10.webp
and it removes the background, crops to the pill, makes it at most
512 px, and saves "elvanse70.png", "oxycontin80.png", "ritalin10.png"
into assets/pills. The site shows new pictures without a restart.

First time only (in a terminal):
    py -m pip install "rembg[cpu]" pillow
The first run also downloads the background model once (about 170 MB).

Use:
    py tools\\pillprep.py "X:\\Hooki's assets\\new pills"
    py tools\\pillprep.py "X:\\Hooki's assets\\new pills" --overwrite
Options: --out FOLDER (default: assets/pills next to this script's folder),
         --overwrite (replace pictures already on the site),
         --keep (don't remove the background, e.g. for already cut-out PNGs),
         --model NAME (rembg model, default isnet-general-use; u2net also works),
         --size N (longest side in px, default 512).
"""
import argparse
import re
import sys
from pathlib import Path

from PIL import Image, ImageOps

# Same rule as the server (UploadDownload.go pillNamePattern): brand, then the dose number, then an optional unit.
NAME = re.compile(r"^(.*?[a-z][^0-9]*?)[\s_-]*(\d+(?:[.,]\d+)?)\s*(mg|mcg|µg|ug|g)?$", re.I)
PICTURES = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff", ".avif"}


def site_name(stem):
    """'Elvanse 70' -> 'elvanse70', 'Co-codamol 30mg' -> 'co-codamol30', 'Xanax 0,5' -> 'xanax0.5'. None when no dose."""
    m = NAME.match(stem.strip())
    if not m:
        return None
    brand = re.sub(r"[^a-z0-9-]+", "", m.group(1).strip(" _-").lower())
    dose = m.group(2).replace(",", ".")
    unit = (m.group(3) or "mg").lower().replace("µg", "mcg").replace("ug", "mcg")
    if not brand:
        return None
    return f"{brand}{dose}" + ("" if unit == "mg" else unit)


def already_cut_out(img):
    """True when the picture already has a transparent background (corners see-through)."""
    if img.mode != "RGBA":
        return False
    a = img.getchannel("A")
    w, h = img.size
    corners = [a.getpixel((0, 0)), a.getpixel((w - 1, 0)), a.getpixel((0, h - 1)), a.getpixel((w - 1, h - 1))]
    return max(corners) < 16


def crop_to_pill(img, pad=0.04):
    """Crops away the empty border, keeping a small margin."""
    alpha = img.getchannel("A").point(lambda v: 255 if v > 24 else 0)
    box = alpha.getbbox()
    if not box:
        return img
    l, t, r, b = box
    p = int(max(r - l, b - t) * pad)
    return img.crop((max(0, l - p), max(0, t - p), min(img.width, r + p), min(img.height, b + p)))


def main():
    ap = argparse.ArgumentParser(description="Remove the background of pill photos and save them for Geek4u.")
    ap.add_argument("folder", help="folder with pill photos named brand + dose")
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "assets" / "pills"))
    ap.add_argument("--overwrite", action="store_true")
    ap.add_argument("--keep", action="store_true", help="keep the background")
    ap.add_argument("--model", default="isnet-general-use")
    ap.add_argument("--size", type=int, default=512)
    args = ap.parse_args()

    src, out = Path(args.folder), Path(args.out)
    if not src.is_dir():
        sys.exit(f"Folder not found: {src}")
    out.mkdir(parents=True, exist_ok=True)

    session = None
    done, skipped, bad = 0, 0, []
    files = sorted(f for f in src.iterdir() if f.is_file() and f.suffix.lower() in PICTURES)
    if not files:
        sys.exit(f"No pictures in {src}")
    for f in files:
        name = site_name(f.stem)
        if not name:
            bad.append(f"{f.name}: no dose in the name (use e.g. 'Elvanse 70.jpg')")
            continue
        target = out / f"{name}.png"
        if target.exists() and not args.overwrite:
            print(f"skip  {f.name} -> {target.name} (already there, use --overwrite)")
            skipped += 1
            continue
        try:
            img = ImageOps.exif_transpose(Image.open(f)).convert("RGBA")
            if not args.keep and not already_cut_out(img):
                if session is None:
                    from rembg import new_session  # loaded only when needed (slow import)
                    print(f"Loading the background model ({args.model}), the first time downloads it…")
                    session = new_session(args.model)
                from rembg import remove
                img = remove(img, session=session, post_process_mask=True)
            img = crop_to_pill(img)
            img.thumbnail((args.size, args.size), Image.LANCZOS)
            img.save(target, optimize=True)
            print(f"ok    {f.name} -> {target.name} ({img.width}x{img.height})")
            done += 1
        except Exception as e:  # one broken picture shouldn't stop the rest
            bad.append(f"{f.name}: {e}")
    print(f"\n{done} saved to {out}, {skipped} skipped, {len(bad)} with problems.")
    for line in bad:
        print("  !", line)


if __name__ == "__main__":
    main()
