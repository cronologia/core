---
name: mine-video
description: Turn a YouTube video into a transcript, a mining ticket, and (after verification) dataset contributions for a Cronologia project. Use when the user shares video links for a project.
---

# Mine a video source

Load `sourcing-rules` first.

1. **Identify.** Get title/channel via the oembed endpoint (no auth):
   `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=ID&format=json`
   Decide which project the video belongs to.
2. **Transcript.** `tools/yt-transcript.sh ID <lang> out.txt "Header"` — use the
   ORIGINAL language track (not auto-translations). The tv/web_embedded/android
   player clients bypass the bot check; the subtitle endpoint rate-limits
   (429) — sleep 15s+ between videos; persistent 429s → the timedtext-URL
   fallback documented in the script. Deliver the transcript to the user.
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
