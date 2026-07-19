#!/usr/bin/env bash
# yt-transcript.sh — fetch a YouTube video's captions and emit a clean text transcript.
#
# The exact incantation that works from sandboxed environments (July 2026):
# the tv/web_embedded/android player clients bypass the anonymous-bot check,
# and the subtitle endpoint is rate-limited, so we sleep between requests.
#
# Usage: ./yt-transcript.sh VIDEO_ID LANG OUT.txt "Header line for the transcript"
set -euo pipefail
VID="$1"; LANG="${2:-pt}"; OUT="$3"; HEADER="${4:-$VID}"
DIR="$(mktemp -d)"
trap 'rm -rf "$DIR"' EXIT

yt-dlp --skip-download --write-subs --write-auto-subs \
  --sub-langs "$LANG" --sub-format vtt --sleep-subtitles 15 \
  --extractor-args "youtube:player_client=tv,web_embedded,android" \
  -o "$DIR/%(id)s.%(ext)s" "https://www.youtube.com/watch?v=$VID"

VTT=$(ls "$DIR/$VID".*.vtt | head -1)
python3 "$(dirname "$0")/vtt2txt.py" "$VTT" "$OUT" "$HEADER"

# Fallback when the subtitle endpoint 429s persistently: pull the timedtext URL
# from the android client's metadata and curl it directly —
#   yt-dlp -J --extractor-args "youtube:player_client=android" URL \
#     | jq -r '.automatic_captions.en[] | select(.ext=="vtt") | .url' | head -1 | xargs curl -s -o sub.vtt
