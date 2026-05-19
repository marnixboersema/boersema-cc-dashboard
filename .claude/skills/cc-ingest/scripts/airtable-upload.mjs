#!/usr/bin/env node
// CLI helper for the cc-ingest skill.
//
// Two commands:
//   inspect <cycle> <week> <subject>
//     -> prints {found, id, fields} JSON for that row.
//
//   apply [manifest.json|-]
//     -> reads a manifest JSON (file path or stdin), applies all updates
//        to Airtable, and prints a JSON report. By default it does NOT
//        overwrite fields that already have content — set overwrite:true
//        per-subject or defaultOverwrite:true at the top of the manifest.
//
// Manifest shape:
// {
//   "cycle": 2,
//   "week": 12,
//   "defaultOverwrite": false,
//   "subjects": {
//     "History": {
//       "overwrite": false,
//       "fields": {
//         "Memory Work": "Tell me about ...",
//         "CC Connected URL": "https://...",
//         "CC Connected Title": "History - Cycle 2, Week 12",
//         "YouTube URLs": "https://youtu.be/..."
//       },
//       "attachments": {
//         "Intro Audio":  [{"path": "/tmp/cc/intro.mp3",   "filename": "intro.mp3"}],
//         "Audio Files":  [{"path": "/tmp/cc/history.mp3", "filename": "history.mp3"}],
//         "PDFs":         [{"path": "/tmp/cc/history.pdf", "filename": "03_History.pdf"}]
//       }
//     }
//   }
// }

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setDefaultResultOrder } from 'node:dns';

// Node 24's fetch uses happy-eyeballs (IPv4 + IPv6 in parallel). On networks
// without working IPv6, the IPv6 attempts return EHOSTUNREACH and the IPv4
// candidates sometimes time out too — the request fails even though curl to
// the same host succeeds instantly. Forcing IPv4-first resolves Airtable
// hostnames directly to working IPs and skips the IPv6 dead end.
setDefaultResultOrder('ipv4first');

const PAT = process.env.AIRTABLE_PAT;
const BASE = process.env.AIRTABLE_BASE_ID;
const TABLE = process.env.AIRTABLE_TABLE_NAME || 'Lessons';
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

if (!PAT || !BASE) {
  console.error('Missing AIRTABLE_PAT or AIRTABLE_BASE_ID. Source the repo .env first.');
  process.exit(2);
}

const HEADERS = {
  Authorization: `Bearer ${PAT}`,
  'Content-Type': 'application/json',
};

// Node 24's fetch occasionally fails with ETIMEDOUT against api.airtable.com
// even though the network is fine (happy-eyeballs glitches between IPv4/IPv6
// candidates). Retry transient network errors with exponential backoff and
// give each attempt a clean timeout so a bad IP doesn't hang forever.
async function fetchWithRetry(url, options = {}, { attempts = 6, timeoutMs = 15000 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { ...options, signal: ctrl.signal });
      clearTimeout(t);
      return r;
    } catch (err) {
      clearTimeout(t);
      lastErr = err;
      const isTransient =
        err.name === 'AbortError' ||
        err.code === 'ETIMEDOUT' ||
        err.code === 'ECONNRESET' ||
        err.code === 'EHOSTUNREACH' ||
        err.cause?.code === 'ETIMEDOUT' ||
        err.cause?.code === 'ECONNRESET' ||
        err.cause?.code === 'EHOSTUNREACH' ||
        /fetch failed/i.test(err.message || '');
      if (!isTransient || i === attempts - 1) throw err;
      const backoff = 500 * Math.pow(2, i);  // 500, 1000, 2000 ms
      await new Promise(res => setTimeout(res, backoff));
    }
  }
  throw lastErr;
}

async function findRecord(cycle, week, subject) {
  const id = `C${cycle}W${week}-${subject}`;
  const url = new URL(`https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TABLE)}`);
  url.searchParams.set('filterByFormula', `{ID}='${id.replace(/'/g, "\\'")}'`);
  url.searchParams.set('maxRecords', '1');
  const r = await fetchWithRetry(url, { headers: HEADERS });
  if (!r.ok) throw new Error(`find ${id}: ${r.status} ${await r.text()}`);
  const data = await r.json();
  return data.records?.[0] || null;
}

async function createRecord(cycle, week, subject) {
  const url = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TABLE)}`;
  const r = await fetchWithRetry(url, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      fields: { Cycle: cycle, Week: week, Subject: subject },
    }),
  });
  if (!r.ok) {
    const text = await r.text();
    if (r.status === 401 || r.status === 403) {
      throw new Error(`POST ${r.status}: PAT lacks data.records:write scope. ${text}`);
    }
    throw new Error(`POST ${r.status}: ${text}`);
  }
  return r.json();
}

async function patchFields(recordId, fields) {
  const url = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TABLE)}/${recordId}`;
  const r = await fetchWithRetry(url, {
    method: 'PATCH',
    headers: HEADERS,
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) {
    const text = await r.text();
    if (r.status === 401 || r.status === 403) {
      throw new Error(`PATCH ${r.status}: PAT lacks data.records:write scope. ${text}`);
    }
    throw new Error(`PATCH ${r.status}: ${text}`);
  }
  return r.json();
}

async function uploadAttachment(recordId, fieldName, filePath, filename) {
  const buf = await readFile(filePath);
  if (buf.length > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `${filePath} is ${(buf.length / 1024 / 1024).toFixed(1)} MB ` +
      `(>${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB Airtable uploadAttachment limit).`
    );
  }
  const name = filename || filePath.split('/').pop();
  const url = `https://content.airtable.com/v0/${BASE}/${recordId}/${encodeURIComponent(fieldName)}/uploadAttachment`;
  // Larger timeout for attachment uploads (file body can be megabytes).
  const r = await fetchWithRetry(url, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      contentType: guessContentType(name),
      file: buf.toString('base64'),
      filename: name,
    }),
  }, { attempts: 6, timeoutMs: 60000 });
  if (!r.ok) {
    const text = await r.text();
    if (r.status === 401 || r.status === 403) {
      throw new Error(`upload ${r.status}: PAT lacks data.records:write scope. ${text}`);
    }
    throw new Error(`upload ${name} -> ${fieldName}: ${r.status} ${text}`);
  }
  return r.json();
}

function guessContentType(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.m4a')) return 'audio/mp4';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.ogg')) return 'audio/ogg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

function fieldHasContent(value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

async function applyManifest(manifest) {
  const { cycle, week, subjects, defaultOverwrite = false, createIfMissing = true } = manifest;
  if (cycle == null || week == null || !subjects) {
    throw new Error('Manifest must have cycle, week, and subjects');
  }
  const report = { cycle, week, results: [] };

  for (const [subject, spec] of Object.entries(subjects)) {
    const entry = { subject, actions: [], skipped: [], errors: [] };
    try {
      let rec = await findRecord(cycle, week, subject);
      if (!rec) {
        if (!createIfMissing) {
          entry.errors.push(`Row C${cycle}W${week}-${subject} not found in Airtable`);
          report.results.push(entry);
          continue;
        }
        rec = await createRecord(cycle, week, subject);
        entry.actions.push(`created row C${cycle}W${week}-${subject}`);
      }
      const overwrite = spec.overwrite ?? defaultOverwrite;
      const current = rec.fields || {};

      // Manifest semantics:
      //   - field omitted from spec.fields → don't touch
      //   - value === "" or null → clear the field (only if overwrite allowed)
      //   - value is a real value → write it (respecting overwrite policy)
      const fieldsToPatch = {};
      for (const [k, v] of Object.entries(spec.fields || {})) {
        const wantsClear = v === '' || v == null;
        const hasContent = fieldHasContent(current[k]);
        if (!overwrite && hasContent) {
          entry.skipped.push(`field "${k}" (already has content)`);
          continue;
        }
        if (wantsClear && !hasContent) {
          // Nothing to clear, nothing to write.
          continue;
        }
        fieldsToPatch[k] = wantsClear ? '' : v;
      }
      if (Object.keys(fieldsToPatch).length > 0) {
        await patchFields(rec.id, fieldsToPatch);
        entry.actions.push(`updated fields: ${Object.keys(fieldsToPatch).join(', ')}`);
      }

      for (const [fieldName, files] of Object.entries(spec.attachments || {})) {
        if (!Array.isArray(files) || files.length === 0) continue;
        const existed = fieldHasContent(current[fieldName]);
        if (!overwrite && existed) {
          entry.skipped.push(`attachment "${fieldName}" (already has content)`);
          continue;
        }
        // With overwrite=true, REPLACE existing attachments rather than append:
        // PATCH the field to [] first, then upload the new files.
        // (The uploadAttachment endpoint appends, so without this step
        // a re-run leaves the old content alongside the new.)
        if (overwrite && existed) {
          try {
            await patchFields(rec.id, { [fieldName]: [] });
            entry.actions.push(`cleared existing "${fieldName}"`);
          } catch (err) {
            entry.errors.push(`clear ${fieldName}: ${err.message}`);
            continue;
          }
        }
        for (const f of files) {
          try {
            await uploadAttachment(rec.id, fieldName, resolve(f.path), f.filename);
            entry.actions.push(`uploaded to "${fieldName}": ${f.filename || f.path}`);
          } catch (err) {
            entry.errors.push(`${fieldName} <- ${f.filename || f.path}: ${err.message}`);
          }
        }
      }
    } catch (err) {
      entry.errors.push(err.message);
    }
    report.results.push(entry);
  }
  return report;
}

async function readManifest(arg) {
  if (!arg || arg === '-') {
    return new Promise((res, rej) => {
      let data = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', c => { data += c; });
      process.stdin.on('end', () => {
        try { res(JSON.parse(data)); } catch (e) { rej(new Error('Invalid JSON on stdin: ' + e.message)); }
      });
      process.stdin.on('error', rej);
    });
  }
  return JSON.parse(await readFile(arg, 'utf8'));
}

const cmd = process.argv[2];
try {
  if (cmd === 'apply') {
    const manifest = await readManifest(process.argv[3]);
    const report = await applyManifest(manifest);
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else if (cmd === 'inspect') {
    const cycle = Number(process.argv[3]);
    const week = Number(process.argv[4]);
    const subject = process.argv[5];
    if (!cycle || !week || !subject) {
      console.error('Usage: airtable-upload.mjs inspect <cycle> <week> <subject>');
      process.exit(2);
    }
    const rec = await findRecord(cycle, week, subject);
    const out = rec ? { found: true, id: rec.id, fields: rec.fields } : { found: false };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  } else {
    console.error('Usage:\n' +
      '  airtable-upload.mjs apply [manifest.json|-]\n' +
      '  airtable-upload.mjs inspect <cycle> <week> <subject>');
    process.exit(2);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
