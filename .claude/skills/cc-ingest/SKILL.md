---
name: cc-ingest
description: Ingest one week's CC Foundations content from the Boersema CC Inbox Google Drive folder into the Airtable Lessons base. Triggers when the user says things like "verwerk C2W12", "verwerk hierdie week", "ingest week 12 cycle 2", "laai die Sandbox-tydskrif op", "stuur die week se materiaal na Airtable", or refers to the cc-ingest skill by name. Use only when working in the Boersema CC Foundations Dashboard repo.
---

# cc-ingest

You are processing one week of CC Foundations content for the Boersema family dashboard.

The user works in Afrikaans. Reply in Afrikaans. Keep status updates short.

## What this skill does

For one (Cycle, Week) pair, populate every Airtable field that can be filled from either CC Connected (always available) or the matching `CC Inbox/C{cycle}W{week}/` folder in Marnix's Google Drive.

**Always auto-fetched from CC Connected (no Drive needed):**
- CC URLs (`data/ccconnected-urls.csv`) → `CC Connected URL` + `CC Connected Title`
- Per-subject Memory Work Audios (`data/ccconnected-audio-urls.csv`) → `Audio Files`
- Sandbox magazine PDF (`data/ccconnected-sandbox-urls.csv`) → downloaded, split per subject → `PDFs`

**From the Drive folder, when Clarinda uploads it:**
- Photo of the CC Foundations Guide page → memory work Q+A → `Memory Work`
- Per-subject intro recordings (Clarinda reads memory work aloud) → `Intro Audio`
- `bible*.pdf` → Bible row's `PDFs` (Boersema-specific content, no CC equivalent)
- `urls.txt` → YouTube embeds → `YouTube URLs`
- A Sandbox PDF (only used as fallback if the CC download fails)

The skill is partial-friendly: if the Drive folder is missing or empty, the CC-driven fields still upload. Each week's row is created automatically if it doesn't already exist (`createIfMissing: true`).

The helper script (`scripts/airtable-upload.mjs apply`) is idempotent — fields already populated in Airtable are skipped unless the user explicitly asks to overwrite.

## Inputs

### Google Drive folder convention

Root folder: **`CC Inbox`** (in Marnix's Google Drive, accessed via the Drive MCP).

Per week, a subfolder named like `C2W12` (Cycle 2 Week 12). Inside the week folder, Clarinda drops files with any names. Examples of what may be there:

- A Sandbox magazine PDF (whole magazine, not yet split per subject)
- A photo/scan/PDF of the CC Foundations Guide page for that week (contains all subjects' memory-work Q+A)
- Audio files (MP3/M4A/WAV) — Clarinda's per-subject intros (she reads memory work aloud)
- One or more PDFs whose filename starts with **`bible`** (case-insensitive) — Boersema-specific Bible study material for the week. Each is uploaded as-is to Bible's `PDFs` attachment field. Multiple Bible PDFs in one week are all attached.
- Optionally a `urls.txt` with YouTube/video links per subject (see below)
- Optionally a `notes.txt` or similar with hand-written notes (the skill ignores these)

### Intro audio convention

Every week folder contains **one short intro audio per subject** (Clarinda reads the week's memory work aloud — typically 15–60 seconds per subject). Filenames are unreliable — iPhone Voice Memos defaults to location-based names like `1216 Woodlands Drive 2.m4a`. The skill classifies each audio by **content**, not filename:

1. Run `scripts/classify-intro-audio.py <folder> <memory-work.json>` — it transcribes each audio with Whisper and matches the transcript against the per-subject memory work text.
2. The output JSON reports a `subject` + `confidence` band (`high`, `medium`, `low`, `none`) per audio.
3. For `high` confidence → upload to that subject's `Intro Audio` field automatically.
4. For `medium` confidence → upload but mention the assignment in the final report.
5. For `low` or `none` confidence, or audio shorter than 5 s → ask the user before uploading. The 5-second cutoff catches the common "iPhone test recording" false positive.

All intro audios go to the **`Intro Audio`** attachment field — never `Audio Files`. (`Audio Files` is reserved for the longer CC memory work song that Marnix may attach separately.)

The skill expects the Whisper model at `~/.cache/cc-ingest/whisper-models/ggml-base.en.bin` and `whisper-cli` on PATH. Run `scripts/setup.sh` once on a new machine to install both.

### urls.txt convention (for YouTube / extra videos)

Optional plain-text file `urls.txt` in the week folder with one line per video, format `<subject>: <url>`. The skill parses each line and appends the URL to the matching subject's `YouTube URLs` field (which already supports multiple URLs, one per line).

```
history: https://youtu.be/abc123
science: https://youtube.com/watch?v=xyz
science: https://youtu.be/another  # multiple lines per subject allowed
math: https://youtu.be/...
```

Subject names are case-insensitive and tolerant of dashboard names (`english grammar`, `english`, or `eng` all map to `English Grammar`). Lines starting with `#` are ignored as comments.

MP4 files in the folder are NOT auto-uploaded — Airtable has no video attachment field and direct MP4s can exceed size limits. If Marnix wants a local video served, he should upload it to YouTube and paste the URL in `urls.txt`.

### CC Connected lookup tables

Three CSV lookup tables in `.claude/skills/cc-ingest/data/`:

1. **`ccconnected-urls.csv`** — `Cycle,Week,Subject,URL,Title`. CC video URLs (`https://ccconnected.com/content/asset/fullScreen/<id>`) for each subject's memory work video. Populated once per cycle from a browser-console scrape (see chat history for the snippet that uses the learningPath endpoint).

2. **`ccconnected-audio-urls.csv`** — `Cycle,Week,Subject,URL,Title,EmbedUrl`. The `EmbedUrl` is the direct `classicalconversations.widen.net` MP3 download URL — publicly fetchable, no auth needed for the download. One per-subject Memory Work Audio per week (~150–900 KB each, just that subject).

3. **`ccconnected-sandbox-urls.csv`** — `Cycle,Week,AssetKey,EmbedId,WidenURL,Title`. Direct widen download URL for each week's Sandbox magazine PDF.

> Fine Arts and Bible are not in CC's standard set, so they're absent from CSV 1 and 2 by design. CSV 3 is per-week (not per-subject) — Bible and Fine Arts are skipped during the per-subject split anyway.

### Airtable schema (reference — confirmed live)

Table: `Lessons`. Each row has formula field `ID = "C" & Cycle & "W" & Week & "-" & Subject`, e.g. `C2W12-History`.

Subjects (9): `History`, `Science`, `English Grammar`, `Latin`, `Math`, `Geography`, `Timeline`, `Fine Arts`, `Bible`.

Text fields: `Memory Work`, `Memory Work (Afrikaans)`, `CC Connected URL`, `CC Connected Title`, `YouTube URLs`.

Attachment fields: `Audio Files`, `PDFs`, `Intro Audio`.

> Bible is Boersema-specific (not standard CC content). It will usually have no Sandbox section and no CC Connected URL. That is normal — skip those for Bible.

## Preconditions

Before doing anything, verify:

1. `.env` exists at repo root with `AIRTABLE_PAT` and `AIRTABLE_BASE_ID`. If not, ask the user.
2. The PAT has `data.records:write` scope. If `apply` later fails with 401/403, tell the user to update the PAT scopes at <https://airtable.com/create/tokens>.
3. Google Drive MCP is available (tools starting with `mcp__...__search_files`, `download_file_content`, etc.). If not, ask the user to connect it.

## Workflow

### Step 1 — Resolve which week

If the user said "C2W12" or "Cycle 2 Week 12", use that. If they said "hierdie week" or didn't specify, ask which (Cycle, Week). Do not guess.

### Step 2 — Find the Drive folder

Use the Drive MCP to search for the week folder under `CC Inbox`. Match the folder name `C{cycle}W{week}` (zero-padded variants also OK, like `C2W08`). List files inside.

If the folder doesn't exist, ask the user whether to proceed with only the CC-Connected-driven fields (URLs + per-subject audios). If they say yes, skip Steps 3–7 and 8c–8d (the Drive-driven parts) and go straight to Step 8.

If the folder exists but is empty, the CC-Connected steps still run. Tell the user the folder is empty and that you're proceeding with just CC URLs and per-subject audios.

### Step 3 — Download files to a temp directory

Create `/tmp/cc-ingest/C{cycle}W{week}/` and download every file into it. Keep original filenames so classification can use them.

### Step 4 — Classify files

For each file, decide what it is. Filename hints first; if those are unhelpful, open and inspect.

- **Sandbox PDF**: large multi-page PDF (>10 pages typically). Filename usually contains "sandbox". If unsure, open page 1 and check for "The SANDBOX" header.
- **Bible PDF**: filename starts with `bible` (case-insensitive). Goes straight to Bible row's `PDFs` field, no splitting needed.
- **Memory work source**: photo (.jpg/.png) or single-page PDF showing all subjects' Q+A in the CC Guide layout. Typically <2 MB and 1 page.
- **Intro audios**: MP3/M4A/WAV files. Filenames are unreliable (iPhone Voice Memos defaults). All audios are routed to the transcription-based classifier in Step 7.
- **`urls.txt`**: YouTube links per subject, handled in Step 8c.
- **`notes.txt`** or other plain-text scratch files: ignored.
- **Subject-prefixed PDFs (already split, e.g. `03_History.pdf`)**: rare; if present, skip the Sandbox split step and use these directly.

If anything is genuinely ambiguous (e.g. a randomly-named PDF that's neither Sandbox nor Bible-prefixed), ask one short question listing the candidate uses.

### Step 5 — Sandbox: auto-fetch from CC + split per subject (always)

The Sandbox magazine is **always** auto-fetched from CC Connected — Marnix doesn't need Clarinda to upload it. Use Drive only as fallback if the CC fetch fails.

1. Look up the widen URL in `data/ccconnected-sandbox-urls.csv` for `(Cycle, Week)`.
2. Download to `/tmp/cc-ingest/C{cycle}W{week}/sandbox.pdf` with curl. Typical size 5–30 MB.
3. **Fallback**: if the CSV has no row OR the download fails, look for a Sandbox PDF in the Drive folder (large multi-page PDF whose page 1 says "The SANDBOX"). Use that instead. If neither source has it, skip the split with a warning.
4. Read each page's text with the pypdf venv at `~/.cache/cc-ingest/venv/bin/python` and find subject markers — both heading-style ("HISTORY", "MATH", etc., usually all-caps on their own line) and topic phrasing ("Liquid Equivalents" = Math, "Industrial Revolution" = History, etc.). The same subject can span multiple non-contiguous pages.
5. Tell the user the detected page ranges in one short summary, format `History: pp 18–19, 29–30  ·  Science: pp 9, 31–32  ·  Math: pp 37–40  ·  ...`. Proceed unless the ranges look obviously wrong.
6. Write per-subject PDFs to `/tmp/cc-ingest/C{cycle}W{week}/split/` using pypdf. Filename convention matches Marnix's existing pattern: `NN_Subject_Topic.pdf` (e.g. `03_History_Industrial_Revolution.pdf`). Number prefix is fixed per subject:
   - `03` History · `04` Science · `05` Math · `06` Latin · `07` English Grammar · `08` Geography · `09` Timeline
7. Verify each split is under 5 MB (Airtable's `uploadAttachment` limit). If oversized, recommend manual upload via the Airtable web UI for that subject.

Skip Bible and Fine Arts in the per-subject split — Bible isn't in the Sandbox, and the Sandbox's Fine Arts mention is only a one-line reference inside Morning Time Plans. Fine Arts and Bible PDFs come from separate sources (see Step 8d for Bible).

### Step 6 — Extract memory work

If a memory-work source file is present (typically a photo of the CC Foundations Guide page for the week), read the image with the Read tool (which supports JPG/PNG) and extract the Q+A pairs per subject. The Guide layout has 8 subjects in a 3×3-ish grid across one page (no Bible).

Convention (decided 2026-05-19, applies to all new ingests):
- **Memory Work field**: the actual Q+A content. Multi-line text, formatted cleanly.
- **Memory Work (Afrikaans) field**: leave empty.

Example for History W13:

```
Tell me about the Industrial Revolution.
Watt's steam engine, Cartwright's power loom, and Whitney's cotton gin spurred the Industrial Revolution that began in the 1760s.
```

For subjects with table data (Math Liquid Equivalents, Latin endings, Geography lists), preserve the table structure with line breaks.

> Older weeks (W11–W12) follow an earlier pattern: subject label in `Memory Work`, content in `Memory Work (Afrikaans)`. Don't migrate them automatically — they were Marnix's manual entries. New ingests use the new convention.

If memory work extraction is uncertain for any subject, include only the ones you're confident about and report the rest as missing. Do NOT invent content not visibly on the page.

### Step 7 — Classify intro audios

Write the per-subject memory work text from Step 6 to `/tmp/cc-ingest/C{cycle}W{week}-mw.json`:

```json
{"History": "Tell me about ... 1760s.", "Math": "Liquid Equivalents. 8 fluid ounces ...", ...}
```

Run the classifier:

```bash
.claude/skills/cc-ingest/scripts/classify-intro-audio.py \
  /tmp/cc-ingest/C{cycle}W{week}/audios \
  /tmp/cc-ingest/C{cycle}W{week}-mw.json
```

(Put the downloaded audio files in a subdirectory so the classifier doesn't pick up the Sandbox PDF or the Guide image.)

The output is a JSON dict keyed by audio filename, each entry with `transcript`, `duration_seconds`, `subject`, `confidence`, `match_counts`, and optionally `warning`.

Decisions per audio:
- `confidence: high` → assign to that subject's `Intro Audio` without asking.
- `confidence: medium` → assign and mention the assignment in the final report so Marnix can verify.
- `confidence: low` or `none`, OR a `warning` is present → ask Marnix before uploading.

All assignments go to **`Intro Audio`** field (never `Audio Files`).

If two audios score high for the same subject, take the longer one and flag the shorter as a possible duplicate.

### Step 8 — Look up CC Connected URLs

Read `.claude/skills/cc-ingest/data/ccconnected-urls.csv`. For each subject with a matching row, add `CC Connected URL` and `CC Connected Title` to the manifest.

Subjects with no row in the CSV: skip those fields, add to a "missing CC URLs" list to report at the end.

### Step 8b — Look up + download CC per-subject Memory Work Audio

Read `.claude/skills/cc-ingest/data/ccconnected-audio-urls.csv`. For each subject with a matching row, download the MP3 from the `EmbedUrl` (e.g. `https://classicalconversations.widen.net/content/.../mp3/...mp3?u=zq6gep`) via direct curl — no auth needed for the widen CDN, only for the CC API the URL came from.

Save each download to `/tmp/cc-ingest/C{cycle}W{week}/audio-per-subject/NN_Subject - C{cycle}W{week} - Memory Work Audio.mp3` (numbered to match Marnix's existing convention: 01_History, 02_Science, ..., 07_Timeline).

Add these to the manifest as `Audio Files` attachments. **Fine Arts and Bible have no entry — skip without warning.**

### Step 8c — Read urls.txt (YouTube videos)

If `urls.txt` exists in the week folder, parse it. Format: one `<subject>: <url>` line per entry, `#`-prefixed lines are comments. The first colon separates subject from URL (URLs contain `://`).

Normalize subject names case-insensitively, with aliases:
```
history → History    science → Science          latin → Latin
math, maths → Math   english, eng → English Grammar
geography, geo → Geography                       timeline → Timeline
art, arts, fine art → Fine Arts                  bible → Bible
```

Multiple lines per subject are combined (one URL per line) and written to that subject's `YouTube URLs` field. Existing content in that field is preserved unless `overwrite: true` is set.

### Step 8d — Bible PDFs from Drive

Bible content is Boersema-specific — CC has no per-week Bible material. The skill picks up any PDF in the week folder whose filename starts with `bible` (case-insensitive), e.g. `bible-week13.pdf`, `Bible Memory Work.pdf`, `bible_song.pdf`. Multiple Bible PDFs in one week are all attached.

For each detected Bible PDF:
1. Verify the file is <5 MB (Airtable limit). If larger, report it and tell the user to compress or upload manually.
2. Add to the manifest as a `PDFs` attachment on the **Bible** subject.

If no `bible*.pdf` files are present, skip Bible entirely — do NOT create the Bible row. (A row with no content makes the dashboard show Bible as available when it actually isn't.)

### Step 9 — Build the manifest

Construct a JSON manifest matching the format documented in `scripts/airtable-upload.mjs`. Write it to `/tmp/cc-ingest/C{cycle}W{week}-manifest.json` so the user can inspect it if needed.

Default `defaultOverwrite: false` — the helper will skip fields that already have content. If the user explicitly asks to overwrite (e.g. "vervang die memory work"), set `overwrite: true` on the affected subjects.

Default `createIfMissing: true` — if a row for `C{cycle}W{week}-{subject}` doesn't yet exist in Airtable, the helper creates it with the right Cycle/Week/Subject and then proceeds. Set to `false` only if you want to fail loudly when rows are missing.

### Step 10 — Apply

Run the helper with the env vars from `.env`:

```bash
set -a; source .env; set +a
node .claude/skills/cc-ingest/scripts/airtable-upload.mjs apply /tmp/cc-ingest/C{cycle}W{week}-manifest.json
```

Capture the JSON report. If any subject reports `fetch failed` (Node 24's fetch occasionally glitches against `content.airtable.com` for attachment uploads), re-run the same `apply` — the helper is idempotent and will skip everything that already succeeded.

### Step 11 — Report

Summarise in Afrikaans, brief and structured:

```
Verwerk C2W12:
✓ History — fields updated, intro audio + audio + pdf opgelaai
✓ Science — fields updated, audio + pdf opgelaai
○ Math — oorgeslaan (reeds vol)
✗ Bible — geen inhoud in folder gevind
⚠ CC Connected URL ontbreek vir: Latin, Fine Arts
```

Mention any errors verbatim from the report.

## Things to avoid

- Do not overwrite existing field content unless the user explicitly asks.
- Do not upload files >5 MB (Airtable's uploadAttachment limit). If a file is too big, report it and ask the user how to proceed (compress, or skip).
- Do not commit the Drive temp files into the repo. They live under `/tmp/`.
- Do not invent CC Connected URLs. If the CSV lookup misses, report it as missing.
- Do not guess subject assignment for ambiguous audio. Ask.

## Helping populate the CC Connected CSV later

A common follow-up: the user wants to fill in the CSV for a whole cycle. CC Connected requires a paid login; you cannot scrape it without credentials. Either:

- Marnix manually browses the site and dictates URLs (you append rows to the CSV)
- He pastes a list of URLs with subjects and you parse them into the CSV
- He gives you the asset IDs only (`11685`, etc.) and you build the URLs
