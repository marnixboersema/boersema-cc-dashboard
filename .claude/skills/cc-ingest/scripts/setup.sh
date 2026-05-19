#!/usr/bin/env bash
# Eenmalige opstel vir die cc-ingest skill.
# Hardloop hierdie een keer op 'n nuwe rekenaar voor jy die skill gebruik.
#
# Installeer:
#   - whisper-cpp via brew (vir transkripsie van intro-audios)
#   - Whisper se base.en model (~141MB)
#   - 'n Python venv met pypdf (vir Sandbox-PDF splitsing)
#
# Alles leef in ~/.cache/cc-ingest/ sodat dit nie /tmp besoedel nie en
# nie verlore gaan oor herlaai nie.

set -euo pipefail

CACHE_DIR="$HOME/.cache/cc-ingest"
MODEL_DIR="$CACHE_DIR/whisper-models"
MODEL_PATH="$MODEL_DIR/ggml-base.en.bin"
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"
VENV_DIR="$CACHE_DIR/venv"

mkdir -p "$CACHE_DIR"

echo "=== cc-ingest setup ==="
echo

if command -v whisper-cli >/dev/null 2>&1; then
    echo "✓ whisper-cli already installed: $(which whisper-cli)"
else
    if ! command -v brew >/dev/null 2>&1; then
        echo "✗ Homebrew not found. Install brew first: https://brew.sh"
        exit 1
    fi
    echo "Installing whisper-cpp via brew..."
    brew install whisper-cpp
fi

if [ -f "$MODEL_PATH" ]; then
    SIZE=$(du -h "$MODEL_PATH" | cut -f1)
    echo "✓ Whisper model already present: $MODEL_PATH ($SIZE)"
else
    echo "Downloading Whisper base.en model (~141MB)..."
    mkdir -p "$MODEL_DIR"
    curl -fL --progress-bar -o "$MODEL_PATH" "$MODEL_URL"
    echo "✓ Model saved: $MODEL_PATH"
fi

if [ -f "$VENV_DIR/bin/python" ]; then
    echo "✓ Python venv already present: $VENV_DIR"
else
    echo "Creating Python venv at $VENV_DIR..."
    python3 -m venv "$VENV_DIR"
fi

echo "Installing/updating pypdf in venv..."
"$VENV_DIR/bin/pip" install --quiet --upgrade pip pypdf

# Sanity checks
echo
echo "=== Verifying ==="
"$VENV_DIR/bin/python" -c "import pypdf; print(f'✓ pypdf {pypdf.__version__}')"
whisper-cli --help >/dev/null 2>&1 && echo "✓ whisper-cli runs"
[ -f "$MODEL_PATH" ] && echo "✓ Model file readable ($(du -h "$MODEL_PATH" | cut -f1))"

echo
echo "✓ cc-ingest setup complete"
echo "  Whisper bin:    $(which whisper-cli)"
echo "  Whisper model:  $MODEL_PATH"
echo "  Python venv:    $VENV_DIR/bin/python"
