#!/usr/bin/env python3
"""Classify intro audios by transcribing each and matching against memory work.

The cc-ingest workflow:
  1. Clarinda records one short intro per subject (she reads the week's memory
     work aloud). She uploads them all to the week folder with whatever
     filenames her phone picked (typically iPhone Voice Memos location names
     like "1216 Woodlands Drive 2.m4a" — useless as subject hints).
  2. This script transcribes each audio with whisper-cli and matches each
     transcript against the per-subject memory work text. The subject whose
     memory work shares the most distinctive words with the transcript wins.

Usage:
  classify-intro-audio.py <audio-folder> <memory-work.json> [--out report.json]

memory-work.json format:
  {
    "History": "Tell me about the Industrial Revolution. Watt's steam engine ...",
    "Math":    "Liquid Equivalents. 8 fluid ounces ...",
    ...
  }

Stdout: JSON report keyed by audio filename. Each entry has the transcript,
duration, best-guess subject, and a confidence band so Claude can decide
whether to upload directly or ask the user.
"""
import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

WHISPER_BIN = '/opt/homebrew/bin/whisper-cli'
MODEL_PATH = os.path.expanduser('~/.cache/cc-ingest/whisper-models/ggml-base.en.bin')

# Words too common across subjects to be useful as a distinctive signal.
STOPWORDS = {
    'about', 'after', 'again', 'against', 'around', 'because', 'before',
    'being', 'between', 'cycle', 'every', 'first', 'memory', 'never',
    'often', 'other', 'present', 'school', 'second', 'subject', 'tell',
    'tense', 'their', 'there', 'these', 'thing', 'those', 'three', 'today',
    'under', 'until', 'using', 'video', 'week', 'where', 'which', 'while',
    'would', 'years', 'young',
}

# Subject aliases — Whisper sometimes mis-spells specialized terms.
# Keys are normalized forms; values list variant spellings whisper produces.
WHISPER_ALIASES = {
    'mercury':  ['mercury', 'mercrury'],
    'gemini':   ['gemini', 'jamini'],
    'apollo':   ['apollo', 'apollos'],
    'shuttle':  ['shuttle', 'shuttles'],
    'watt':     ['watt', "watt's", 'whats', 'watts'],
    'whitney':  ['whitney', "whitney's"],
    'cartwright': ['cartwright', "cartwright's"],
    'industrial': ['industrial'],
}


def transcribe(audio_path: Path) -> tuple[str, float]:
    """Return (transcript_text, duration_seconds)."""
    wav = audio_path.with_suffix(audio_path.suffix + '.wav')
    # afconvert is built into macOS — convert to 16-bit PCM WAV for whisper.
    subprocess.run(
        ['afconvert', '-f', 'WAVE', '-d', 'LEI16@16000', str(audio_path), str(wav)],
        check=True, capture_output=True,
    )
    # Get duration via afinfo
    duration = 0.0
    try:
        info = subprocess.run(['afinfo', str(wav)], capture_output=True, text=True, check=True).stdout
        m = re.search(r'estimated duration:\s*([\d.]+)', info)
        if m:
            duration = float(m.group(1))
    except Exception:
        pass

    # Run whisper-cli
    result = subprocess.run(
        [WHISPER_BIN, '-m', MODEL_PATH, '-f', str(wav), '--no-prints', '-l', 'en'],
        capture_output=True, text=True, check=True,
    )
    wav.unlink(missing_ok=True)

    # Strip whisper's timestamp prefixes
    text = re.sub(
        r'\[\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}\]\s*',
        '', result.stdout,
    )
    return text.strip(), duration


def distinctive_words(text: str) -> set[str]:
    """Pull out content-bearing words (length >= 5, not a stopword)."""
    words = set(re.findall(r"[a-zA-Z]{5,}", text.lower()))
    return words - STOPWORDS


def score_against_subjects(transcript: str, mw_by_subject: dict[str, str]) -> dict[str, int]:
    """For each subject, count how many of its distinctive words appear in
    the transcript. Higher = stronger evidence the audio is about that subject.
    """
    t = transcript.lower()
    # Expand transcript with alias matches (e.g. 'whats' -> also count 'watt').
    expanded = t
    for canonical, variants in WHISPER_ALIASES.items():
        if any(v in t for v in variants):
            expanded += ' ' + canonical
    scores = {}
    for subject, content in mw_by_subject.items():
        words = distinctive_words(content)
        if not words:
            scores[subject] = 0
            continue
        scores[subject] = sum(1 for w in words if w in expanded)
    return scores


def confidence_band(scores: dict[str, int]) -> tuple[str | None, str]:
    """Pick the winning subject + a confidence label."""
    if not scores:
        return None, 'none'
    sorted_scores = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    top_subj, top_score = sorted_scores[0]
    second_score = sorted_scores[1][1] if len(sorted_scores) > 1 else 0

    if top_score == 0:
        return None, 'none'  # nothing matched anywhere
    if top_score >= 4 and top_score - second_score >= 2:
        return top_subj, 'high'
    if top_score >= 2 and top_score > second_score:
        return top_subj, 'medium'
    return top_subj, 'low'


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('folder', help='Folder containing audio files')
    ap.add_argument('memory_work_json', help='JSON file: {subject: memory_work_text}')
    ap.add_argument('--out', help='Write report here instead of stdout')
    ap.add_argument('--short-threshold', type=float, default=5.0,
                    help='Audio shorter than this many seconds is flagged (default 5)')
    args = ap.parse_args()

    if not Path(WHISPER_BIN).exists():
        print(f'ERROR: whisper-cli not found at {WHISPER_BIN}. Run scripts/setup.sh.', file=sys.stderr)
        return 2
    if not Path(MODEL_PATH).exists():
        print(f'ERROR: model not found at {MODEL_PATH}. Run scripts/setup.sh.', file=sys.stderr)
        return 2

    folder = Path(args.folder)
    if not folder.is_dir():
        print(f'ERROR: not a directory: {folder}', file=sys.stderr)
        return 2

    with open(args.memory_work_json) as f:
        mw = json.load(f)

    audio_files = sorted([
        p for p in folder.iterdir()
        if p.suffix.lower() in {'.m4a', '.mp3', '.wav', '.ogg', '.aac'}
    ])

    report = {}
    for audio in audio_files:
        entry = {'filename': audio.name, 'path': str(audio)}
        try:
            transcript, duration = transcribe(audio)
            entry['transcript'] = transcript
            entry['duration_seconds'] = round(duration, 2)
            if duration < args.short_threshold:
                entry['warning'] = (
                    f'Audio is only {duration:.1f}s — likely a test recording, '
                    f'not a real intro. Ask user before uploading.'
                )
            scores = score_against_subjects(transcript, mw)
            entry['match_counts'] = scores
            subject, confidence = confidence_band(scores)
            entry['subject'] = subject
            entry['confidence'] = confidence
        except subprocess.CalledProcessError as e:
            entry['error'] = f'Transcription failed: {e.stderr.decode()[:200] if e.stderr else e}'
        except Exception as e:
            entry['error'] = f'{type(e).__name__}: {e}'
        report[audio.name] = entry

    out_json = json.dumps(report, indent=2, ensure_ascii=False)
    if args.out:
        Path(args.out).write_text(out_json + '\n')
        print(f'Wrote {args.out}', file=sys.stderr)
    else:
        print(out_json)
    return 0


if __name__ == '__main__':
    sys.exit(main())
