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
- Optionally a `notes.txt` or similar with hand-written notes

### Intro audio convention

- `intro.mp3` (or .m4a/.wav) → applied to all 9 subjects that have content
- `intro-history.mp3`, `intro-science.mp3`, etc. → per-subject override
- Both can coexist: the generic intro applies to subjects without a specific intro

### CC Connected URLs

Lookup table at `.claude/skills/cc-ingest/data/ccconnected-urls.csv` with columns `Cycle,Week,Subject,URL,Title`. URLs use the form `https://ccconnected.com/content/asset/fullScreen/<id>`. Marnix populates this CSV per cycle (one-time work). If a row is missing for a subject, skip its CC URL field and report it as missing at the end.

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

### Step 5 — Split the Sandbox PDF (if needed)

If a Sandbox PDF is present AND no per-subject PDFs exist yet, invoke the `pdf` skill to:

1. Read the PDF and identify the page range for each of the 8 CC subjects (skip Bible — it's not in Sandbox). Use the table of contents if present; otherwise read section headings page by page.
2. Tell the user the detected ranges in one short summary and ask for confirmation before splitting. Format: `History: pp 2–4, Science: pp 5–8, ...`.
3. After confirmation, write per-subject PDFs to `/tmp/cc-ingest/C{cycle}W{week}/<subject>.pdf` with the original Sandbox page numbers preserved.

If the PDF can't be split confidently (e.g. no clear subject headings), ask the user to provide page ranges manually.

### Step 6 — Extract memory work

If a memory-work source file is present, read it (Read tool can read images directly) and extract the Q+A pairs per subject. The CC Guide layout typically has one page per week with all 8 subjects' "Tell me about..." questions and answers.

Build a per-subject text in this format:

```
Tell me about <topic>.
<answer paragraph>
```

Put this in the `Memory Work` field. Leave `Memory Work (Afrikaans)` empty — the user has chosen English-only for now.

If memory work extraction is uncertain for any subject, include only the ones you're confident about and report the rest as missing.

### Step 7 — Match audio to subjects

For each per-subject audio file (by filename keyword), assign to that subject's `Audio Files`. For each `intro*.mp3`, assign to `Intro Audio` (generic → all subjects with content; subject-specific → only that subject).

If an audio file's subject is ambiguous, ask the user.

### Step 8 — Look up CC Connected URLs

Read `.claude/skills/cc-ingest/data/ccconnected-urls.csv`. For each subject with a matching row, add `CC Connected URL` and `CC Connected Title` to the manifest.

Subjects with no row in the CSV: skip those fields, add to a "missing CC URLs" list to report at the end.

### Step 9 — Build the manifest

Construct a JSON manifest matching the format documented in `scripts/airtable-upload.mjs`. Write it to `/tmp/cc-ingest/C{cycle}W{week}-manifest.json` so the user can inspect it if needed.

Default `defaultOverwrite: false` — the helper will skip fields that already have content. If the user explicitly asks to overwrite (e.g. "vervang die memory work"), set `overwrite: true` on the affected subjects.

### Step 10 — Apply

Run the helper with the env vars from `.env`:

```bash
set -a; source .env; set +a
node .claude/skills/cc-ingest/scripts/airtable-upload.mjs apply /tmp/cc-ingest/C{cycle}W{week}-manifest.json
```

Capture the JSON report.

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

- Do not create new Airtable rows. All 576 rows already exist (or should). If a row is missing, report it — do not create it.
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
