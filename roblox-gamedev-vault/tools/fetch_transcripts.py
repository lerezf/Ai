#!/usr/bin/env python3
"""Fetch YouTube transcripts into the vault's transcripts/ folder.

Usage (from anywhere):
    python tools/fetch_transcripts.py                      # reads tools/links.txt
    python tools/fetch_transcripts.py URL [URL ...]        # video, playlist, or channel links
    python tools/fetch_transcripts.py --limit 5 --push     # newest 5 per channel, then git push

Needs: pip install yt-dlp
Channel links work (e.g. https://www.youtube.com/@AlvinBlox). Already-fetched
videos are skipped (tracked in transcripts/.fetched.json).
"""
import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "transcripts"
LINKS = Path(__file__).resolve().parent / "links.txt"
STATE = OUT / ".fetched.json"

TAG_RE = re.compile(r"<[^>]+>")
TS_RE = re.compile(r"^\d{2}:\d{2}(:\d{2})?\.\d{3}\s+-->")


def vtt_to_text(vtt: str) -> str:
    """Convert a (possibly auto-generated, rolling) WebVTT file to plain text."""
    lines = []
    last = ""
    for raw in vtt.splitlines():
        line = raw.strip()
        if (not line or line.startswith(("WEBVTT", "Kind:", "Language:", "NOTE"))
                or TS_RE.match(line) or line.isdigit()):
            continue
        line = TAG_RE.sub("", line).replace("&amp;", "&").replace("&gt;", ">") \
            .replace("&lt;", "<").replace("&#39;", "'").replace("&quot;", '"').strip()
        if not line or line == last:
            continue
        lines.append(line)
        last = line
    # Join into paragraphs of ~8 lines for readability
    paras = [" ".join(lines[i:i + 8]) for i in range(0, len(lines), 8)]
    return "\n\n".join(paras)


def normalize_url(url: str) -> str:
    """Channel roots (@handle, /channel/, /c/, /user/) -> their /videos tab."""
    u = url.strip().rstrip("/")
    if re.search(r"youtube\.com/(@[^/]+|channel/[^/]+|c/[^/]+|user/[^/]+)$", u):
        u += "/videos"
    return u


def load_state() -> dict:
    if STATE.exists():
        return json.loads(STATE.read_text(encoding="utf-8"))
    return {}


def save_state(state: dict) -> None:
    OUT.mkdir(exist_ok=True)
    STATE.write_text(json.dumps(state, indent=2), encoding="utf-8")


def list_videos(yt_dlp, url: str, limit: int):
    opts = {"quiet": True, "extract_flat": True, "skip_download": True,
            "playlistend": limit, "ignoreerrors": True}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(normalize_url(url), download=False)
    if not info:
        return []
    if info.get("_type") == "playlist":
        entries = []
        for e in info.get("entries") or []:
            if not e:
                continue
            # channel pages can nest tabs (Videos/Shorts); flatten one level
            if e.get("_type") == "playlist":
                entries.extend(x for x in (e.get("entries") or []) if x)
            else:
                entries.append(e)
        return [e["id"] for e in entries[:limit] if e.get("id")]
    return [info["id"]]


def fetch_one(yt_dlp, vid: str, langs: str):
    url = f"https://www.youtube.com/watch?v={vid}"
    with tempfile.TemporaryDirectory() as tmp:
        opts = {
            "quiet": True, "skip_download": True, "writesubtitles": True,
            "writeautomaticsub": True, "subtitleslangs": [langs, f"{langs}-*"],
            "subtitlesformat": "vtt", "outtmpl": f"{tmp}/%(id)s.%(ext)s",
            "ignoreerrors": False,
        }
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
        vtts = sorted(Path(tmp).glob("*.vtt"))
        if not vtts:
            return None, info
        return vtt_to_text(vtts[0].read_text(encoding="utf-8", errors="ignore")), info


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("urls", nargs="*", help="video / playlist / channel URLs (default: tools/links.txt)")
    ap.add_argument("--limit", type=int, default=10, help="max videos per link (newest first), default 10")
    ap.add_argument("--lang", default="en", help="subtitle language, default en")
    ap.add_argument("--push", action="store_true", help="git add/commit/push transcripts when done")
    args = ap.parse_args()

    try:
        import yt_dlp
    except ImportError:
        print("Missing dependency. Run:  pip install yt-dlp")
        return 1

    urls = args.urls
    if not urls and LINKS.exists():
        urls = [l.strip() for l in LINKS.read_text(encoding="utf-8").splitlines()
                if l.strip() and not l.strip().startswith("#")]
    if not urls:
        print("No links. Pass URLs or add them to tools/links.txt")
        return 1

    OUT.mkdir(exist_ok=True)
    state = load_state()
    new = 0
    for url in urls:
        print(f"\n== {url}")
        try:
            ids = list_videos(yt_dlp, url, args.limit)
        except Exception as e:  # noqa: BLE001
            print(f"  could not list videos: {e}")
            continue
        for vid in ids:
            if vid in state:
                print(f"  skip {vid} (already fetched)")
                continue
            try:
                text, info = fetch_one(yt_dlp, vid, args.lang)
            except Exception as e:  # noqa: BLE001
                print(f"  fail {vid}: {e}")
                continue
            if not text:
                print(f"  no captions for {vid}")
                state[vid] = {"title": (info or {}).get("title", ""), "status": "no-captions"}
                continue
            title = info.get("title", vid)
            md = (f"# {title}\n\n"
                  f"- **URL:** https://www.youtube.com/watch?v={vid}\n"
                  f"- **Channel:** {info.get('channel') or info.get('uploader', '')}\n"
                  f"- **Uploaded:** {info.get('upload_date', '')}\n"
                  f"- **Status:** unprocessed\n\n"
                  f"## Transcript\n\n{text}\n")
            (OUT / f"{vid}.md").write_text(md, encoding="utf-8")
            state[vid] = {"title": title, "status": "fetched"}
            new += 1
            print(f"  saved {vid}: {title}")
    save_state(state)
    print(f"\nDone. {new} new transcript(s) in {OUT}")

    if args.push and new:
        subprocess.run(["git", "-C", str(ROOT), "add", "transcripts"], check=False)
        subprocess.run(["git", "-C", str(ROOT), "commit", "-m", f"Add {new} transcript(s)"], check=False)
        subprocess.run(["git", "-C", str(ROOT), "push"], check=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
