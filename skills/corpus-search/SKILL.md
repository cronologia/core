---
name: corpus-search
description: Search the vaulted transcript corpora with one index over every collection. Load before answering any question of the form "does he ever say X", before reporting that something is absent from a corpus, and before writing a regex sweep over transcripts by hand.
---

# Search the vault

One FTS5 index over **every** collection in `cronologia/archive` — the COF
transcriptions, the `olavo-video` captures, and the general transcripts. The
tool lives in core and reads the vault; it never writes there (archive ADR-0004).

```bash
python3 core/tools/corpus-index.py build                    # ~12s, needed once per session
python3 core/tools/corpus-index.py search "<query>"
python3 core/tools/corpus-index.py search "<q>" --reviewed  # reviewed transcriptions only
python3 core/tools/corpus-index.py search "<q>" --collection cof
python3 core/tools/corpus-index.py stats
```

`--vault PATH` if the archive checkout is not a sibling; `$CRONOLOGIA_HOME`
also works. The database is derived, gitignored, and rebuilt from the
transcripts, which are the source of record.

## Why this exists, in one story

A search for the book `O Profeta da Paz` returned zero across the 589 COF files
and the honest-looking conclusion was drawn: not in the corpus. It was in the
corpus — in True Outspeak, a collection that search had never been pointed at.
And the passage calls the book only *"um livro sobre o Islam"*, so the right
collection alone would still not have matched.

Two failures, and only one of them is fixed by tooling.

## The rules

1. **Search the CLAIM, not the NAME.** These are ASR transcriptions of spoken
   Portuguese and the manglings are severe: Jouvenel is `do jogo né`, Husserl is
   `Russel`, Ibn Khaldun is `Weven Caldono`, Al-Azhar is `Universidade de
   Lázaro` — which reads as a real institution, so nothing looks wrong. A name
   that returns nothing has told you nothing. The sentence attached to it is
   usually transcribed well enough to find, and carries the correct spelling
   somewhere else in the corpus.
2. **A zero is not an absence.** The tool prints the scope it searched with
   every result; quote that scope when you report a zero, or the zero is not a
   finding. Pair it with a positive control from the same corpus and the same
   method — and make the control test the property your claim depends on. A term
   found everywhere proves the SEARCH ran; it does not prove the corpus is
   entire.
3. **Carry the trust level into whatever you write.** Every hit prints its date,
   whether that date is verified, and its review status. A hit from
   `revisao_pendente` is a lead; a hit from `revisada` is a source. Never let
   the first become the second by paraphrase.
4. **Quotation still requires audio.** The corpus is transcription, not
   recording. Paraphrase with an attributed date; mark anything quotable as
   REQUIRES-AUDIO.

## What it cannot do

It is **lexical**. Query expansion covers known manglings — and reports every
expansion it applied, so you can discount a hit that only matched a garble — but
no expansion turns `O Profeta da Paz` into `um livro sobre o Islam`. When a
lexical search comes back empty and you still believe the thing is there,
rephrase as the claim, or as the argument it sits inside, and search again.

**Expansion matches a whole canonical name, so a surname alone does not fire
it.** `Eric Voegelin` pulls in five manglings and returns ten hits; `Voegelin`
returns one. The tool now prints a `hint:` line when your query is part of a
name it knows — take it, because that hit count is not a measure of the name.
Where a surname is ambiguous it lists every candidate rather than picking one:
expanding `Burckhardt` would silently merge Titus with Jacob, and a false hit
that reads as corroboration is the failure these rules exist to prevent.

New manglings you find go in the project's `KEYWORDS.md`; the tool reads that
file, so the next search gets them for free.

Record the **collection** any zero was measured in. A mangling is often
confined to one: `Dugin` returns nothing in `olavo-video` and matches fine in
the human-corrected COF files, and that zero was once written down as
corpus-wide — a note that told readers not to bother searching.
