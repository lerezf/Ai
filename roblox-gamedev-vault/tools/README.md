# Transcript fetcher (Windows / any OS)

One-time setup:
1. Install Python 3 (python.org; tick "Add to PATH").
2. `pip install yt-dlp`
3. Clone this repo and make sure `git push` works from that folder.

Everyday use:
1. Paste YouTube links (video, playlist, or channel) into `tools/links.txt`.
2. Run, from the vault folder:
   `python tools/fetch_transcripts.py --push`
   (or pass links directly: `python tools/fetch_transcripts.py https://www.youtube.com/@AlvinBlox --limit 5 --push`)
3. Transcripts land in `transcripts/` and get pushed. The scheduled Claude task picks up files marked `Status: unprocessed`, writes notes, and opens a branch for you to review.

Notes:
- Uses YouTube's own captions (manual or auto). Videos without captions are skipped and logged.
- Already-fetched videos are skipped via `transcripts/.fetched.json`.
- If YouTube starts blocking requests, update yt-dlp: `pip install -U yt-dlp`.
- Optional: schedule step 2 with Windows Task Scheduler to run weekly.
