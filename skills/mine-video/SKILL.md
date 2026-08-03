---
name: mine-video
description: Turn a YouTube video into a transcript, a mining ticket, and (after verification) dataset contributions for a Cronologia project. Use when the user shares video links for a project.
---

# Mine a video source

Load `sourcing-rules` first. Before searching a corpus or a transcript for a
name, read the project's `KEYWORDS.md`: the naming variants and the known dead
terms are there (in the COF corpus, "FSSPX" and "SSPX" return **zero** files —
it writes "Sociedade de São Pio X" and "Monsenhor Lefebvre"). Regenerate its
mechanical half with `python3 core/tools/build-keywords.py <repo> --out
KEYWORDS.md`, and put the spellings this video taught you — auto-caption
manglings included — in the hand-written half.

1. **Identify.** Get title/channel via the oembed endpoint (no auth):
   `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=ID&format=json`
   Decide which project the video belongs to.
2. **Transcript.** `tools/yt-transcript.sh ID <lang|auto> out.txt "Header"`. It
   fetches the ORIGINAL track, detected structurally by
   `tools/pick-source-track.py`: YouTube auto-translations carry `tlang` on the
   timedtext URL and the source track does not, so a language code is never the
   test. The `<lang>` argument is an **assertion** — the script aborts if the
   detected source disagrees, instead of handing you a machine translation of a
   machine transcription. Pass `auto` when you do not already know the language
   of the audio. No source track identifiable → it exits 1; log the failure
   rather than fetching a translation. The tv/web_embedded/android player
   clients bypass the bot check; the subtitle endpoint rate-limits (429) — sleep
   15s+ between videos. Deliver the transcript to the user.
3. **Ticket.** One issue per video in the project repo: link, channel, word
   count, the regeneration command, what the video is, why it matters to this
   project, and a mining checklist:
   - extract dated factual claims → verify independently → only corroborated
     facts touch `data/chronology.json`
   - log characterizations as attributed positions (who, where, when)
   - identify the speaker's cited bibliography (often the stronger citation)
   - assess adding the video to `references[]`, perspective-labeled; archive it
   - auto-caption caveat: verify proper names against audio before quoting
4. **Classify the source type** and say so in the ticket: official statement,
   academic analysis, canonical commentary, partisan commentary (label the
   side), or testimony (ex-member accounts get the strictest corroboration
   bar — they are adversarial by construction).
