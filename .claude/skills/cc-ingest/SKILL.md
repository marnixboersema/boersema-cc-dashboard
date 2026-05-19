---
name: cc-ingest
description: Ingest one week's CC Foundations content from the Boersema CC Inbox Google Drive folder into the Airtable Lessons base. Triggers when the user says things like "verwerk C2W12", "verwerk hierdie week", "ingest week 12 cycle 2", "laai die Sandbox-tydskrif op", "stuur die week se materiaal na Airtable", or refers to the cc-ingest skill by name. Use only when working in the Boersema CC Foundations Dashboard repo.
---

# cc-ingest

You are processing one week of CC Foundations content for the Boersema family dashboard.

The user works in Afrikaans. Reply in Afrikaans. Keep status updates short.

## What this skill does

For one (Cycle, Week) pair:

1. Find the matching folder in Google Drive
2. Classify the files in it (Sandbox PDF, memory-work source image, audio, intro audio)
3. Split the Sandbox PDF per subject if needed
4. Extract memory work Q+A per subject from the source image/PDF
5. Look up CC Connected URLs from a CSV
6. Build a manifest and call `scripts/airtable-upload.mjs apply`
7. Report what was uploaded, skipped, or missing

The helper script is idempotent — it does NOT overwrite Airtable fields that already have content (unless the user explicitly asks).

## Inputs

### Google Drive folder convention

Root folder: **`CC Inbox`** (in Marnix's Google Drive, accessed via the Drive MCP).

Per week, a subfolder named like `C2W12` (Cycle 2 Week 12). Inside the week folder, Clarinda drops files with any names. Examples of what may be there:

- A Sandbox magazine PDF (whole magazine, not yet split per subject)
- A photo/scan/PDF of the CC Foundations Guide page for that week (contains all subjects' memory-work Q+A)
- Audio files (MP3/M4A/WAV) — may be one per subject, may have generic names
- One or more "intro audio" files (parent introducing the subject/week)
- Optionally a `urls.txt` with YouTube/video links per subject (see below)
- Optionally a `notes.txt` or similar with hand-written notes

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

### CC Connected URLs

Lookup table at `.claude/skills/cc-ingest/data/ccconnected-urls.csv` with columns `Cycle,Week,Subject,URL,Title`. URLs use the form `https://ccconnected.com/content/asset/fullScreen/<id>`. Marnix populates this CSV per cycle (one-time work). If a row is missing for a subject, skip its CC URL field and report it as missing at the end.

### CC Connected per-subject audios

Lookup table at `.claude/skills/cc-ingest/data/ccconnected-audio-urls.csv` with columns `Cycle,Week,Subject,URL,Title,EmbedUrl`. The `EmbedUrl` is the direct `classicalconversations.widen.net` MP3 download URL — publicly fetchable, no CC Connected auth needed for the download itself.

These audios are CC Foundations' per-subject "Memory Work Audio" tracks (short, ~150–900 KB each — just that subject's memory work, not the whole week). They go to the **`Audio Files`** field. Per cycle this needs a one-time browser-console scrape (see the audio-feed snippet in the chat history); after that, the skill looks up + downloads + uploads automatically.

> Fine Arts and Bible are not in CC's standard memory work audio set, so those rows will be missing from this CSV. Skip without warning for those two subjects.

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

If the folder doesn't exist or is empty, stop and tell the user.

### Step 3 — Download files to a temp directory

Create `/tmp/cc-ingest/C{cycle}W{week}/` and download every file into it. Keep original filenames so classification can use them.

### Step 4 — Classify files

For each file, decide what it is. Use filename hints first, then content if needed:

- **Sandbox PDF**: large multi-page PDF (>5 pages typically), filename often contains "sandbox" or a date. If unsure, open the first page with the `pdf` skill to check.
- **Memory work source**: photo or single-page PDF showing the Q+A in a Guide layout. Typically smaller, often image (.jpg/.png) or 1-2 page PDF.
- **Per-subject audio**: filename contains a subject name (history, science, latin, math, english, geography, timeline, "fine arts", bible). Use case-insensitive match.
- **Intro audio**: filename starts with `intro` (matches the convention above).
- **Subject-prefixed PDFs (already split)**: filename starts with a subject keyword, e.g. `history.pdf`. If these exist, skip the Sandbox split step.

If anything is ambiguous, ask the user one short question listing the candidates.

### Step 5 — Split the Sandbox PDF (always)

Marnix's requirement: the Sandbox magazine must always be split per subject before upload. The CC Sandbox is structured as a magazine but contains clear per-subject pages mid-document (typically pp 15–42 across History, Science, Math, Latin, English, Geography, Timeline).

Workflow (used pypdf — already installed in `/tmp/cc-ingest/venv`):

1. Download the Sandbox PDF from Drive into `/tmp/cc-ingest/C{cycle}W{week}/sandbox.pdf`.
2. Read each page's text and find subject markers (lines containing "HISTORY", "MATH", "SCIENCE", "LATIN", "ENGLISH", "GEOGRAPHY", "TIMELINE" as headings, plus topic phrasing like "Liquid Equivalents" = Math, "First Conjugation" = Latin, "Industrial Revolution" = History, etc.). Multi-page subject sections are common.
3. Tell the user the detected page ranges in one short summary. Format: `History: pp 18–19, 29–30  ·  Science: pp 9, 31–32  ·  Math: pp 37–40  ·  ...`. Ask for confirmation only if ranges look wrong; otherwise proceed.
4. Use pypdf via `/tmp/cc-ingest/venv/bin/python` to write per-subject PDFs to `/tmp/cc-ingest/C{cycle}W{week}/split/`. Filename convention matches Marnix's existing pattern: `NN_Subject_Topic.pdf` (e.g. `03_History_Industrial_Revolution.pdf`). Number prefix:
   - `03` History
   - `04` Science
   - `05` Math
   - `06` Latin
   - `07` English (Indefinite Pronouns, etc.)
   - `08` Geography
   - `09` Timeline
5. Verify each split is under 5 MB (Airtable uploadAttachment limit). If oversized, recommend the user upload manually via Airtable web UI (which has higher limits).

Skip Bible and Fine Arts splits — Bible isn't on the Sandbox at all, and Fine Arts content in the Sandbox is just a brief mention in Morning Time Plans (not a standalone section). Fine Arts PDFs come from a separate source.

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
