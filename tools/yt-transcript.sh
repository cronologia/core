#!/usr/bin/env bash
# yt-transcript.sh — fetch a YouTube video's ORIGINAL captions and emit a clean
# text transcript.
#
# The source track is DETECTED, never assumed. YouTube serves one ASR track plus
# auto-translations of it into every language it supports; a translation's
# timedtext URL carries a `tlang` parameter and the original's does not. Fetching
# by language code therefore risks vaulting a machine translation of a machine
# transcription — which is exactly what happened to the True Outspeak intake
# (cronologia/archive #39 and its ADR-0002): `en` was listed first, but the audio
# is Portuguese. tools/pick-source-track.py applies the structural test.
#
# LANG is consequently an ASSERTION, not a request: it states the language you
# believe the audio is in, and the script aborts (exit 2) if detection disagrees
# rather than quietly handing you a translation. Pass "auto" — or omit it — to
# accept whatever the source track turns out to be.
#
# The exact incantation that works from sandboxed environments (July 2026): the
# tv/web_embedded/android player clients bypass the anonymous-bot check, and the
# subtitle endpoint is rate-limited, so the timedtext URL already present in the
# metadata is curled directly and the (sleeping) yt-dlp subtitle download is kept
# only as a fallback.
#
# Dependencies: yt-dlp, python3, curl. Nothing else.
#
# Usage: ./yt-transcript.sh VIDEO_ID [LANG|auto] OUT.txt "Header line"
set -euo pipefail

if [ "$#" -lt 3 ] || [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  cat >&2 <<'EOF'
Usage: yt-transcript.sh VIDEO_ID [LANG|auto] OUT.txt "Header line"

  LANG is an assertion about the language of the AUDIO, not a request for a
  caption track. The original track is detected structurally (a translation's
  timedtext URL carries `tlang`); if the detected source is a different
  language this exits 2 rather than fetching a machine translation of a
  machine transcription. Pass "auto", or omit it, to accept the detected one.
EOF
  exit 2
fi

VID="$1"; WANT="${2:-auto}"; OUT="$3"; HEADER="${4:-$VID}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIR="$(mktemp -d)"
trap 'rm -rf "$DIR"' EXIT

CLIENTS="youtube:player_client=tv,web_embedded,android"
WATCH="https://www.youtube.com/watch?v=$VID"
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

# 1. Metadata only — one request, no captions fetched yet.
yt-dlp -J --skip-download --extractor-args "$CLIENTS" "$WATCH" > "$DIR/meta.json"

# 2. Which track is the original? Also checks the caller's assertion against it.
#    Exit 1 = no source track identifiable; exit 2 = the assertion failed.
set +e
PICK="$(python3 "$HERE/pick-source-track.py" --expect "$WANT" < "$DIR/meta.json")"
RC=$?
set -e
[ "$RC" -eq 0 ] || exit "$RC"

IFS=$'\t' read -r SRC KIND TRACK_URL <<<"$PICK"
echo "yt-transcript: $VID — source track $SRC ($KIND)" >&2

# 3. Fetch it. The metadata already holds the timedtext URL, so the rate-limited
#    subtitle endpoint is only touched again if the direct fetch comes back empty.
VTT="$DIR/$VID.$SRC.vtt"
fetched=0
if curl -sSL --compressed -A "$UA" -o "$VTT" "$TRACK_URL"; then
  read -r first < "$VTT" || first=""
  case "$first" in WEBVTT*) fetched=1 ;; esac
fi

if [ "$fetched" -eq 0 ]; then
  echo "yt-transcript: direct timedtext fetch empty — falling back to yt-dlp" >&2
  yt-dlp --skip-download --write-subs --write-auto-subs \
    --sub-langs "$SRC" --sub-format vtt --sleep-subtitles 15 \
    --extractor-args "$CLIENTS" \
    -o "$DIR/%(id)s.%(ext)s" "$WATCH"
  VTT="$(ls "$DIR/$VID".*.vtt | head -1)"
fi

python3 "$HERE/vtt2txt.py" "$VTT" "$OUT" "$HEADER"
