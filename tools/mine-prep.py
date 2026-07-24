#!/usr/bin/env python3
"""mine-prep — turn a noisy ASR transcript into a compact candidate sheet.

A preserved video transcript is 20k-63k tokens of auto-caption text. Reading one
end to end burns an agent's whole context on filler. This script does the
mechanical pass instead: it extracts the four things the `mine-video` mining
checklist asks for — dated claims, proper nouns, numbers/statistics and quotable
attributed passages — each with a stable line/char OFFSET into the original file
and a short context window, so the agent verifies candidates and re-reads the
full source only where it matters.

Design goal (measured, see tools/README.md): on a large transcript the sheet is
roughly an ORDER OF MAGNITUDE smaller than the input.

It is agent-side analysis tooling: Python 3 stdlib only, never runs in CI, never
writes to a dataset. It only reads and reports.

ASR CAVEAT — enforced in the output header: every proper name and every quote
here is auto-caption text. Verify names and wording against the audio before
citing anything (the mine-video rule; sourcing-rules #5).
"""

import argparse
import bisect
import json
import os
import re
import sys
import unicodedata

# --------------------------------------------------------------------------
# locations
# --------------------------------------------------------------------------


def family_root():
    """Directory holding the sibling repos (core, archive, fsspx, ...)."""
    env = os.environ.get("CRONOLOGIA_HOME")
    if env:
        return env
    here = os.path.abspath(__file__)
    return os.path.dirname(os.path.dirname(os.path.dirname(here)))


def transcripts_dir():
    return os.path.join(family_root(), "archive", "transcripts")


def load_manifest(directory=None):
    """Return the list of manifest entries (empty list when unavailable)."""
    directory = directory or transcripts_dir()
    path = os.path.join(directory, "index.json")
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return []
    if isinstance(data, dict):
        for key in ("docs", "transcripts", "items"):
            if isinstance(data.get(key), list):
                return data[key]
        return []
    return data if isinstance(data, list) else []


def resolve_transcript(arg, docs, directory=None):
    """Resolve a path, an id or a file name to (path, manifest_entry_or_None).

    Pure lookup: does not read the transcript itself.
    """
    directory = directory or transcripts_dir()
    base = os.path.basename(arg)
    for doc in docs:
        if arg in (doc.get("id"), doc.get("file")) or base == doc.get("file"):
            return os.path.join(directory, doc["file"]), doc
    if os.path.exists(arg):
        for doc in docs:
            if doc.get("file") == base:
                return arg, doc
        return arg, None
    guess = os.path.join(directory, base)
    if os.path.exists(guess):
        return guess, None
    return arg, None


# --------------------------------------------------------------------------
# text flow: reflow caption lines while keeping original offsets
# --------------------------------------------------------------------------

SEPARATOR = re.compile(r"^=+\s*$")


def header_end(lines):
    """Index of the first body line (past the `====` banner), 0 when absent."""
    for i, line in enumerate(lines[:12]):
        if SEPARATOR.match(line):
            return i + 1
    return 0


def strip_speaker(line):
    """Blank out caption speaker markers, preserving character alignment."""
    return line.replace(">>", "  ")


class Flow(object):
    """Caption lines joined into one stream, with offsets back to the file.

    `text` is the reflowed body; `locate(pos)` maps a position in it to the
    1-based line number and the character offset in the original file.
    """

    def __init__(self, text, flow_starts, line_numbers, char_starts,
                 turn_starts=None):
        self.text = text
        self.turn_starts = turn_starts or set()
        self._flow_starts = flow_starts
        self._line_numbers = line_numbers
        self._char_starts = char_starts

    @classmethod
    def build(cls, raw):
        lines = raw.split("\n")
        start = header_end(lines)
        parts, flow_starts, line_numbers, char_starts = [], [], [], []
        turn_starts = set()
        cursor = 0  # char offset in the original file
        flow_len = 0
        for i, line in enumerate(lines):
            if i >= start:
                stripped = strip_speaker(line)  # same length as `line`
                body = stripped.strip()
                if body:
                    lead = len(stripped) - len(stripped.lstrip())
                    parts.append(body)
                    flow_starts.append(flow_len)
                    line_numbers.append(i + 1)
                    char_starts.append(cursor + lead)
                    if line.lstrip().startswith(">>"):
                        turn_starts.add(flow_len)
                    flow_len += len(body) + 1
            cursor += len(line) + 1
        return cls(" ".join(parts), flow_starts, line_numbers, char_starts,
                   turn_starts)

    def locate(self, pos):
        if not self._flow_starts:
            return (0, 0)
        idx = bisect.bisect_right(self._flow_starts, pos) - 1
        if idx < 0:
            idx = 0
        delta = pos - self._flow_starts[idx]
        return (self._line_numbers[idx], self._char_starts[idx] + delta)


SENT_END = re.compile(r"[.!?…]")


def context_window(text, pos, width=200):
    """~`width` chars around `pos`, snapped to sentence then word boundaries."""
    half = max(20, width // 2)
    lo, hi = max(0, pos - half), min(len(text), pos + half)
    chunk = text[lo:hi]
    # snap left to a sentence boundary when punctuation is available
    left = chunk[: pos - lo]
    marks = [m.end() for m in SENT_END.finditer(left)]
    if marks and marks[-1] < len(left):
        lo += marks[-1]
    elif lo > 0:
        space = text.find(" ", lo)
        if 0 <= space < pos:
            lo = space + 1
    right = text[pos:hi]
    m = SENT_END.search(right)
    if m:
        hi = pos + m.end()
    elif hi < len(text):
        space = text.rfind(" ", pos, hi)
        if space > pos:
            hi = space
    out = " ".join(text[lo:hi].split())
    if lo > 0:
        out = "…" + out
    if hi < len(text):
        out = out + "…"
    return out


# --------------------------------------------------------------------------
# language
# --------------------------------------------------------------------------

PT_MONTHS = ("janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|"
             "setembro|outubro|novembro|dezembro")
ES_MONTHS = ("enero|febrero|marzo|abril|mayo|junio|julio|agosto|"
             "septiembre|setiembre|octubre|noviembre|diciembre")
EN_MONTHS = ("january|february|march|april|may|june|july|august|september|"
             "october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|"
             "oct|nov|dec")
# months safe to match on their own: 'may'/'mar'/'sept' are ordinary words or
# abbreviations and only count when a day or year sits next to them
EN_MONTHS_STRICT = ("january|february|april|june|july|august|september|"
                    "october|november|december")

PT_MARKERS = (" que ", " não ", " uma ", " para ", " com ", " isso ", " então ")
ES_MARKERS = (" que ", " los ", " pero ", " está ", " porque ", " también ")
EN_MARKERS = (" the ", " and ", " that ", " with ", " you ", " it's ")


def detect_language(text):
    """Cheap stopword vote: 'pt', 'es' or 'en'."""
    sample = (" " + text[:20000].lower() + " ")
    scores = {
        "pt": sum(sample.count(w) for w in PT_MARKERS),
        "es": sum(sample.count(w) for w in ES_MARKERS),
        "en": sum(sample.count(w) for w in EN_MARKERS),
    }
    # PT and ES share markers; break the tie on exclusive words
    scores["pt"] += 3 * (sample.count(" você ") + sample.count(" são ") +
                         sample.count(" muito ") + sample.count(" ele "))
    scores["es"] += 3 * (sample.count(" usted ") + sample.count(" muy ") +
                         sample.count(" hacia ") + sample.count(" ellos "))
    return max(sorted(scores), key=lambda k: scores[k])


def months_for(lang, strict=False):
    if lang == "en":
        return EN_MONTHS_STRICT if strict else EN_MONTHS
    if lang == "es":
        return ES_MONTHS
    return PT_MONTHS


# --------------------------------------------------------------------------
# section 1 — dated claims
# --------------------------------------------------------------------------

YEAR = r"\b(?:1[89]\d{2}|20\d{2})\b"
NUMERIC_DATE = r"\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b"
CENTURY = r"\b(?:s[eé]culo|siglo|century)\s+[IVXLCivxlc]+\b|\b\d{1,2}(?:st|nd|rd|th)\s+century\b"
# speech says "de 88", "em 62" far more often than "1988" — catch two-digit
# year references, but not when the number is really a quantity ("de 50 anos")
NOT_A_YEAR = (r"(?!\s*(?:%|anos?|a[nñ]os?|years?|pessoas|people|mil|reais|"
              r"d[oó]lares|dollars|euros|por\s+cento|per\s?cent|minutos|"
              r"horas|dias|d[ií]as|meses|km|mm|padres|priests|membros|"
              r"members|fi[eé]is|faithful|vezes|times|mi[l]?h[oõ]es))")
SHORT_YEAR_PT = r"\b(?:em|de|desde|at[eé]|ano de|de\s+ano)\s+'?[2-9]\d\b" + NOT_A_YEAR
SHORT_YEAR_EN = r"\b(?:in|since|of|until|by)\s+'[2-9]\d\b"


def dated_pattern(lang):
    months = months_for(lang)
    strict = months_for(lang, strict=True)
    decade = (r"\banos\s+(?:\d{2}|\d{4})\b" if lang != "en"
              else r"\b(?:19|20)?\d0s\b")
    short = SHORT_YEAR_EN if lang == "en" else SHORT_YEAR_PT
    with_day = (r"\b\d{1,2}\s+de\s+(?:%s)\b"                    # 30 de junho
                r"|\b(?:%s)\s+\d{1,2}(?:st|nd|rd|th)?\b"        # June 30
                r"|\b(?:%s)\s+(?:19|20)\d{2}\b" % (months, months, months))
    return re.compile(
        r"(?:%s)|(?:%s)|(?:%s)|(?:\b(?:%s)\b)|(?:%s)|(?:%s)|(?:%s)"
        % (YEAR, NUMERIC_DATE, with_day, strict, decade, CENTURY, short),
        re.IGNORECASE,
    )


def find_dated(flow, lang, context=200):
    return _scan(flow, dated_pattern(lang), "dated", context)


# --------------------------------------------------------------------------
# section 2 — proper nouns (ASR-unreliable)
# --------------------------------------------------------------------------

NAME_STOPWORDS = set("""
a as o os e ou mas que se de da do das dos em no na nos nas um uma por para com
não sim então aí ele ela eles elas eu você vocês nós isso isto aquilo já também
bem muito quando como onde porque qual quais ser estar foi era são está tá né
olha veja bom ok obrigado deus senhor igreja padre papa
the and but that this these those there here they them you your we our it its
is was were are be been so then when where what which who how why yes no okay
well oh yeah right just like god lord church father pope i i'm i've i'd i'll
we're we've they're it's don't didn't can't churches fathers popes bishop
bishops priest priests cardinal cardinals saint saints mass masses
el la los las pero por para con muy también cuando donde porque
""".split())

# conversational fillers ASR capitalizes because they open a turn — never names
FILLERS = set("""
exatamente exato exatamente. entendi entendeu certo claro perfeito verdade
nossa gente tipo enfim olha opa valeu beleza óbvio obvio pois cadê cade
tá ta sim uhum ah eh ó pronto legal massa bacana show inclusive aliás alias
puxa caramba pera peraí calma vamo vamos vem veja pois é
exactly right correct absolutely sure indeed anyway yep nope wow sorry please
thanks thank ok okay hmm huh alright cool great
exactamente claro cierto vale bueno pues oye vaya
""".split())
NAME_STOPWORDS |= FILLERS

HONORIFICS = set("""
dr dr. dra sr sr. sra pe pe. pe padre frei dom monsenhor mons mons. bispo
arcebispo cardeal papa são santa santo professor prof prof. fr fr. mr mr. mrs
ms bishop archbishop cardinal saint st st. father pope reverend rev rev.
""".split())

CONNECTORS = {"de", "da", "do", "das", "dos", "del", "della", "di", "du", "van",
              "von", "y", "e", "al", "el", "bin", "ibn", "of", "the"}

TOKEN = re.compile(r"[A-Za-zÀ-ÖØ-öø-ÿ][\w'’\-]*", re.UNICODE)


def deaccent(s):
    return "".join(c for c in unicodedata.normalize("NFD", s)
                   if unicodedata.category(c) != "Mn")


def name_key(name):
    """Fold an ASR-mangled name to a clustering key.

    Lowercase, de-accent, drop honorifics, then a light phonetic fold so that
    'Lefebvre', 'Lefevre' and 'Lefébre' land on one key.
    """
    words = []
    for tok in deaccent(name).lower().replace("-", " ").split():
        tok = tok.strip(".,;:'’\"")
        if not tok or tok in HONORIFICS or tok in CONNECTORS:
            continue
        words.append(tok)
    folded = []
    for w in words:
        w = re.sub(r"ph", "f", w)
        w = re.sub(r"th", "t", w)
        w = re.sub(r"ck|qu|q", "k", w)
        w = re.sub(r"c([ei])", r"s\1", w)
        w = re.sub(r"c", "k", w)
        w = re.sub(r"[zç]", "s", w)
        w = re.sub(r"[yj]", "i", w)
        w = re.sub(r"w", "v", w)
        w = re.sub(r"b(?=[vw])", "", w)  # Lefebvre / Lefevre
        w = re.sub(r"h", "", w)
        w = re.sub(r"(.)\1+", r"\1", w)
        w = re.sub(r"[^a-z]", "", w)
        if w:
            folded.append(w)
    return " ".join(folded)


def _is_sentence_initial(text, start, turn_starts=()):
    """True when the capitalized token at `start` merely opens a sentence."""
    if start in turn_starts:
        return True
    i = start - 1
    while i >= 0 and text[i] in " \t":
        i -= 1
    if i < 0:
        return True
    return text[i] in ".!?…:;\"'“”)("


def lowercase_counts(text):
    """Frequency of each token that occurs lowercase somewhere in the text.

    ASR capitalizes sentence openers, so 'Exatamente' looks like a name. A word
    that also appears lowercased more often than capitalized is ordinary
    vocabulary, not a proper noun — this map is the filter.
    """
    counts = {}
    for m in TOKEN.finditer(text):
        w = m.group(0)
        if w[:1].islower():
            key = deaccent(w).lower()
            counts[key] = counts.get(key, 0) + 1
    return counts


def extract_proper_nouns(flow, min_count=2, max_items=40):
    """Cluster capitalized token sequences by folded key, with counts.

    Sequences that only ever appear sentence-initially are dropped unless they
    recur often enough to be a real name rather than a sentence opener, and a
    single word that is commoner in lowercase is dropped as vocabulary.
    """
    text = flow.text
    lower = lowercase_counts(text)
    clusters = {}
    pos = 0
    while pos < len(text):
        m = TOKEN.search(text, pos)
        if not m:
            break
        if (not m.group(0)[0].isupper() or m.group(0).lower() in NAME_STOPWORDS
                or text[m.start() - 1:m.start()] == "["):  # [Music], [Applause]
            pos = m.end()
            continue
        start, end = m.start(), m.end()
        words = [m.group(0)]
        cursor = end
        while True:
            nxt = TOKEN.search(text, cursor)
            if not nxt or text[cursor:nxt.start()].strip(" ") not in ("", ","):
                break
            if nxt.start() - cursor > 2:
                break
            word = nxt.group(0)
            low = word.lower()
            if word[0].isupper() and low not in NAME_STOPWORDS:
                words.append(word)
                cursor = end = nxt.end()
                continue
            if low in CONNECTORS:
                after = TOKEN.search(text, nxt.end())
                if (after and after.start() - nxt.end() <= 2
                        and after.group(0)[0].isupper()
                        and after.group(0).lower() not in NAME_STOPWORDS):
                    words.extend([word, after.group(0)])
                    cursor = end = after.end()
                    continue
            break
        surface = " ".join(words)
        key = name_key(surface)
        if key and len(key) > 2:
            initial = _is_sentence_initial(text, start, flow.turn_starts)
            c = clusters.setdefault(
                key, {"key": key, "count": 0, "free": 0, "variants": {},
                      "first_pos": start})
            c["count"] += 1
            c["free"] += 0 if initial else 1
            c["variants"][surface] = c["variants"].get(surface, 0) + 1
        pos = end
    out = []
    for c in clusters.values():
        if c["free"] == 0 and c["count"] < 3:
            continue
        if c["count"] < min_count:
            continue
        variants = sorted(c["variants"].items(), key=lambda kv: (-kv[1], kv[0]))
        top = variants[0][0]
        if " " not in top and lower.get(deaccent(top).lower(), 0) >= c["count"]:
            continue  # commoner in lowercase → ordinary word, not a name
        line, char = flow.locate(c["first_pos"])
        out.append({
            "kind": "name",
            "name": variants[0][0],
            "key": c["key"],
            "count": c["count"],
            "free": c["free"],
            "spellings": ["%s(%d)" % (v, n) for v, n in variants],
            "line": line,
            "char": char,
        })
    out.sort(key=lambda d: (-d["count"], d["name"]))
    return out[:max_items], len(out)


# --------------------------------------------------------------------------
# section 3 — numbers / statistics
# --------------------------------------------------------------------------

UNIT_WORDS = ("padres|sacerdotes|semin[aá]ristas|semin[aá]rios|fi[eé]is|membros|"
              "bispos|capelas|igrejas|parr[oó]quias|escolas|pessoas|almas|"
              "irm[aã]os|monges|casas|distritos|anos|d[eé]cadas|"
              "priests|seminarians|seminaries|faithful|members|bishops|chapels|"
              "churches|parishes|schools|people|souls|brothers|monks|years|"
              "sacerdotes|feligreses|miembros|obispos|capillas|iglesias|a[ñn]os")

MAGNITUDE = (r"mil|milh[oõ]es|milh[aã]o|milhares|bilh[oõ]es|bilh[aã]o|"
             r"thousand|thousands|million|millions|billion|billions|hundred|"
             r"hundreds|mill[oó]n|millones|miles")

NUM = r"\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d+)?|\d+"


def numbers_pattern():
    return re.compile(
        r"(?:%s)\s*%%"                                   # 40%
        r"|(?:R\$|US\$|\$|€|£)\s*(?:%s)"                 # R$ 1.000
        r"|(?:%s)\s+(?:%s)"                              # 2 mil / 3 million
        r"|(?:%s)\s+(?:%s)"                              # 600 padres
        r"|(?:%s)\s+(?:de\s+)?(?:%s)"                    # mil de fiéis
        r"|(?:%s)\s+(?:por\s+cento|per\s?cent)"          # 40 por cento
        % (NUM, NUM, NUM, MAGNITUDE, NUM, UNIT_WORDS, MAGNITUDE, UNIT_WORDS,
           NUM),
        re.IGNORECASE,
    )


BARE_YEAR = re.compile(r"^(?:1[89]\d{2}|20\d{2})$")


def find_numbers(flow, context=200):
    items = _scan(flow, numbers_pattern(), "number", context)
    return [it for it in items if not BARE_YEAR.match(it["match"].strip())]


# --------------------------------------------------------------------------
# section 4 — quotable / attributed passages
# --------------------------------------------------------------------------

CLAIM_VERBS = {
    "pt": (r"afirm(?:a|ou|ava|am)|diss(?:e|eram)|dizia|declar(?:a|ou|aram)|"
           r"aleg(?:a|ou)|sustent(?:a|ou)|defend(?:e|eu)|argument(?:a|ou)|"
           r"acus(?:a|ou)|garantiu|contou|escrev(?:e|eu)|"
           r"neg(?:a|ou)|admit(?:e|iu)|reconhec(?:e|eu)|explic(?:a|ou)|"
           r"segundo|de acordo com"),
    "es": (r"afirm(?:a|ó)|dic(?:e|en)|dijo|declar(?:a|ó)|aleg(?:a|ó)|"
           r"sostiene|defiende|acus(?:a|ó)|escrib(?:e|ió)|nieg(?:a)|negó|"
           r"seg[uú]n|de acuerdo con"),
    "en": (r"says|said|claims|claimed|argues|argued|alleges|alleged|states|"
           r"stated|denies|denied|writes|wrote|insists|insisted|told|"
           r"according to|admits|admitted|acknowledges"),
}

FIRST_PERSON = {
    "pt": (r"eu (?:vi|estava|fui|era|lembro|me lembro|conheci|ouvi|falei|"
           r"presenciei|sei|acho|acredito|posso dizer)|na minha experi[eê]ncia|"
           r"quando eu (?:estava|fui|era|entrei|sa[ií])"),
    "es": (r"yo (?:vi|estaba|fui|era|recuerdo|conoc[ií]|o[ií]|s[eé]|creo)|"
           r"en mi experiencia|cuando yo (?:estaba|fui|era)"),
    "en": (r"I (?:saw|was|remember|met|heard|know|believe|think|witnessed|"
           r"can tell you|used to)|in my experience|when I (?:was|joined|left)"),
}


def quotes_pattern(lang):
    lang = lang if lang in CLAIM_VERBS else "pt"
    return re.compile(r"\b(?:%s)\b|\b(?:%s)\b"
                      % (CLAIM_VERBS[lang], FIRST_PERSON[lang]), re.IGNORECASE)


def find_quotes(flow, lang, context=200):
    return _scan(flow, quotes_pattern(lang), "quote", context)


# --------------------------------------------------------------------------
# shared scanner + dedup
# --------------------------------------------------------------------------


def dedup_key(s):
    return re.sub(r"[^a-z0-9 ]", "", deaccent(s).lower()).strip()[:90]


def _scan(flow, pattern, kind, context):
    """Collect non-overlapping, de-duplicated matches in reading order."""
    text = flow.text
    out, seen, last = [], set(), -10 ** 9
    gap = max(40, context // 2)
    for m in pattern.finditer(text):
        if m.start() < last + gap:
            continue
        window = context_window(text, m.start(), context)
        key = dedup_key(window)
        if not key or key in seen:
            continue
        seen.add(key)
        last = m.start()
        line, char = flow.locate(m.start())
        out.append({"kind": kind, "line": line, "char": char,
                    "match": m.group(0).strip(), "context": window})
    return out


# --------------------------------------------------------------------------
# report
# --------------------------------------------------------------------------


def cap_items(items, limit):
    """Cap a section, sampling EVENLY across the file rather than truncating.

    Reading-order truncation would hand the agent only the first minutes of a
    two-hour video (usually sponsor reads); an even stride keeps the whole
    transcript represented and is deterministic.
    """
    if limit <= 0 or len(items) <= limit:
        return list(items)
    if limit == 1:
        return [items[0]]
    step = (len(items) - 1) / float(limit - 1)
    picked = [items[int(round(i * step))] for i in range(limit)]
    out, seen = [], set()
    for it in picked:
        marker = (it.get("line"), it.get("char"))
        if marker not in seen:
            seen.add(marker)
            out.append(it)
    return out


def build_sheet(path, raw, doc, lang, max_per_section=40, context=200):
    """Pure: raw transcript text -> the candidate sheet as a dict."""
    flow = Flow.build(raw)
    if lang == "auto":
        lang = (doc or {}).get("language") or detect_language(flow.text)
    dated = find_dated(flow, lang, context)
    numbers = find_numbers(flow, context)
    quotes = find_quotes(flow, lang, context)
    names, names_total = extract_proper_nouns(flow, max_items=max_per_section)
    sections = [
        ("dated", cap_items(dated, max_per_section), len(dated)),
        ("names", names, names_total),
        ("numbers", cap_items(numbers, max_per_section), len(numbers)),
        ("quotes", cap_items(quotes, max_per_section), len(quotes)),
    ]
    doc = doc or {}
    return {
        "file": os.path.basename(path),
        "id": doc.get("id", ""),
        "title": doc.get("title", ""),
        "language": lang,
        "words": doc.get("words") or len(flow.text.split()),
        "chars": len(raw),
        "context": context,
        "maxPerSection": max_per_section,
        "sections": {
            name: {"shown": len(items), "total": total, "items": items}
            for name, items, total in sections
        },
    }


ASR_NOTE = ("! ASR: every proper name and every quote below is auto-caption "
            "text — verify against the audio before citing (mine-video rule).")


def render(sheet):
    s, out = sheet["sections"], []
    out.append("# mine-prep candidate sheet")
    out.append("file=%s id=%s lang=%s words=%d chars=%d context=%d"
               % (sheet["file"], sheet["id"] or "-", sheet["language"],
                  sheet["words"], sheet["chars"], sheet["context"]))
    if sheet["title"]:
        out.append("title=%s" % sheet["title"])
    out.append("counts dated=%d/%d names=%d/%d numbers=%d/%d quotes=%d/%d "
               "(shown/found, cap=%d)"
               % (s["dated"]["shown"], s["dated"]["total"],
                  s["names"]["shown"], s["names"]["total"],
                  s["numbers"]["shown"], s["numbers"]["total"],
                  s["quotes"]["shown"], s["quotes"]["total"],
                  sheet["maxPerSection"]))
    out.append(ASR_NOTE)
    out.append("! offsets are L<line> C<char> into the original file; items are "
               "in reading order (names by frequency), sampled evenly across "
               "the file when capped — raise --max-per-section for the rest. "
               "Nothing here is a fact yet: corroborate independently before it "
               "touches a dataset.")

    out.append("")
    out.append("## DATED CLAIMS (%d/%d)" % (s["dated"]["shown"],
                                            s["dated"]["total"]))
    for it in s["dated"]["items"]:
        out.append("L%d C%d | %s | %s" % (it["line"], it["char"], it["match"],
                                          it["context"]))

    out.append("")
    out.append("## PROPER NOUNS — ASR-UNRELIABLE (%d/%d)"
               % (s["names"]["shown"], s["names"]["total"]))
    for it in s["names"]["items"]:
        out.append("n=%d L%d C%d | %s | spellings: %s"
                   % (it["count"], it["line"], it["char"], it["name"],
                      ", ".join(it["spellings"][:5])))

    out.append("")
    out.append("## NUMBERS (%d/%d)" % (s["numbers"]["shown"],
                                       s["numbers"]["total"]))
    for it in s["numbers"]["items"]:
        out.append("L%d C%d | %s | %s" % (it["line"], it["char"], it["match"],
                                          it["context"]))

    out.append("")
    out.append("## QUOTABLE / ATTRIBUTED (%d/%d)" % (s["quotes"]["shown"],
                                                     s["quotes"]["total"]))
    for it in s["quotes"]["items"]:
        out.append("L%d C%d | %s | %s" % (it["line"], it["char"], it["match"],
                                          it["context"]))
    return "\n".join(out)


def main(argv=None):
    ap = argparse.ArgumentParser(
        prog="mine-prep.py",
        description="Extract a compact candidate sheet (dated claims, proper "
                    "nouns, numbers, quotable passages) from an ASR "
                    "transcript. Reads only; never writes a dataset.",
        epilog="Accepts a path, a manifest id or a file name from "
               "archive/transcripts/index.json.")
    ap.add_argument("transcript", help="path, transcript id, or file name")
    ap.add_argument("--lang", default="auto", choices=["pt", "en", "es", "auto"],
                    help="language patterns (default: auto — manifest, then "
                         "stopword detection)")
    ap.add_argument("--max-per-section", type=int, default=40, metavar="N",
                    help="cap items per section (default 40)")
    ap.add_argument("--context", type=int, default=200, metavar="N",
                    help="context window in characters (default 200)")
    ap.add_argument("--json", metavar="OUT",
                    help="also write the sheet as JSON ('-' for stdout)")
    args = ap.parse_args(argv)

    docs = load_manifest()
    path, doc = resolve_transcript(args.transcript, docs)
    try:
        with open(path, encoding="utf-8") as fh:
            raw = fh.read()
    except OSError as exc:
        sys.stderr.write("mine-prep: cannot read %s: %s\n" % (path, exc))
        return 1

    sheet = build_sheet(path, raw, doc, args.lang, args.max_per_section,
                        args.context)
    if args.json == "-":
        print(json.dumps(sheet, ensure_ascii=False, indent=1))
        return 0
    print(render(sheet))
    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(sheet, fh, ensure_ascii=False, indent=1)
        sys.stderr.write("wrote %s\n" % args.json)
    return 0


if __name__ == "__main__":
    sys.exit(main())
