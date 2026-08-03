#!/usr/bin/env python3
"""pick-source-track.py — identify a YouTube video's ORIGINAL caption track.

YouTube serves exactly ONE machine-transcribed (ASR) track, in the language of
the audio, plus auto-translations of that track into every language it
supports. The difference is structural, not nominal: the timedtext URL of an
auto-translation carries a `tlang` parameter, and the source track carries
none. The language code alone tells you nothing about which is which, and the
order YouTube lists the tracks in tells you less.

Asking for a language code instead of applying that test is how a machine
translation of a machine transcription gets vaulted as if it were an original
source. The archive recorded that failure once already (`cronologia/archive`
#39, ADR-0002) and the written warning did not prevent the repeat: the True
Outspeak intake (2026-08-03) found `en` listed first for a programme whose
audio is Portuguese, and three episodes were captured as fluent English —
"Boa noite, amigo" arriving as "Goodnight friend" — before anyone noticed and
discarded them. This script is the mechanical fix: the trap can no longer recur
by forgetting a flag.

Reads yt-dlp JSON on stdin and prints one line for the source track:

    yt-dlp -J --skip-download URL | pick-source-track.py [--expect LANG]
    pt<TAB>asr<TAB>https://www.youtube.com/api/timedtext?...&lang=pt

A human-made subtitle wins over ASR when one exists: it is a transcription of
the audio, never an auto-translation of another track.

`--expect` is an ASSERTION, not a request. It states the language the caller
believes the audio is in and fails when detection disagrees, instead of
fetching whatever was asked for. Base subtags match, so `--expect pt` accepts a
detected `pt-BR`.

Exit codes:
  0  a source track was identified; the line is on stdout
  1  none could be identified — no captions, or every track is a translation.
     Record the failure. Do not fall back to a guess.
  2  the `--expect` assertion failed; the detected source is reported on stderr
"""

import argparse
import json
import sys
import urllib.parse as up


def _base(lang):
    """'pt-BR' -> 'pt'. Language tags are compared on their primary subtag."""
    return str(lang or "").replace("_", "-").split("-")[0].lower()


def _candidates(data):
    """Yield (is_manual, lang, formats) with human subtitles offered first."""
    for pool, is_manual in ((data.get("subtitles") or {}, True),
                            (data.get("automatic_captions") or {}, False)):
        if not isinstance(pool, dict):
            continue
        for lang, formats in pool.items():
            yield is_manual, lang, (formats or [])


def source_track(data):
    """Return (lang, kind, url) for the original track, or None.

    The test is the presence of `tlang` on the timedtext URL — a track that has
    one is an auto-translation of some other track and is skipped, whatever
    language it claims and wherever it sits in the listing.
    """
    for is_manual, lang, formats in _candidates(data):
        for fmt in formats:
            if not isinstance(fmt, dict) or fmt.get("ext") != "vtt":
                continue
            url = fmt.get("url") or ""
            query = up.parse_qs(up.urlparse(url).query)
            if query.get("tlang"):
                continue  # an auto-translation, not the original
            if not url:
                continue
            src = (query.get("lang") or [lang])[0]
            kind = "manual" if is_manual else (query.get("kind") or ["asr"])[0]
            return src, kind, url
    return None


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Print LANG<TAB>KIND<TAB>URL for a video's original "
                    "caption track, reading yt-dlp JSON on stdin.")
    parser.add_argument("--expect", metavar="LANG", default="",
                        help="assert the source language; exit 2 on mismatch. "
                             "'auto' or empty accepts whatever is detected.")
    args = parser.parse_args(argv)

    try:
        data = json.load(sys.stdin)
    except Exception:
        print("pick-source-track: stdin is not yt-dlp JSON "
              "(expected `yt-dlp -J --skip-download URL`).", file=sys.stderr)
        return 1

    found = source_track(data)
    if found is None:
        print("pick-source-track: no source track identifiable — the video has "
              "no VTT captions, or every track carries a tlang parameter and is "
              "therefore an auto-translation.", file=sys.stderr)
        return 1

    lang, kind, url = found
    want = args.expect.strip()
    if want and want.lower() != "auto" and _base(want) != _base(lang):
        print("pick-source-track: asserted source language %r, but the "
              "detected source track is %r (%s)." % (want, lang, kind),
              file=sys.stderr)
        print("  A %r track, if the video offers one, would be an "
              "auto-translation of it — a machine translation of a machine "
              "transcription. Refusing." % want, file=sys.stderr)
        print("  Re-run without the assertion (or with --expect %s) if %r is "
              "genuinely the language of the audio." % (lang, lang),
              file=sys.stderr)
        return 2

    print("%s\t%s\t%s" % (lang, kind, url))
    return 0


if __name__ == "__main__":
    sys.exit(main())
