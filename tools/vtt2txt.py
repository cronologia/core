import re, sys, html

def vtt_to_text(path):
    lines = open(path, encoding='utf-8').read().splitlines()
    out, prev = [], None
    for ln in lines:
        if not ln.strip() or ln.startswith(('WEBVTT', 'Kind:', 'Language:', 'NOTE')) or '-->' in ln or re.match(r'^\d+$', ln.strip()):
            continue
        # strip inline timing/karaoke tags and cue tags
        txt = re.sub(r'<[^>]+>', '', ln).strip()
        txt = html.unescape(txt)
        if not txt or txt == prev:
            continue
        out.append(txt); prev = txt
    # collapse rolling-caption duplication: drop a line if it equals the previous line's tail
    clean = []
    for t in out:
        if clean and (clean[-1].endswith(t) or t == clean[-1]):
            continue
        clean.append(t)
    return '\n'.join(clean)

if __name__ == '__main__':
    src, dst, header = sys.argv[1], sys.argv[2], sys.argv[3]
    body = vtt_to_text(src)
    with open(dst, 'w', encoding='utf-8') as f:
        f.write(header + '\n' + '=' * 78 + '\n\n' + body + '\n')
    print(dst, len(body.split()), 'words')
