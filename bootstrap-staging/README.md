# bootstrap-staging

Temporary parking for bootstrapped projects whose GitHub repositories do not
exist yet. Each `.bundle` is a complete `git bundle` of the project's `main`.

## medjugorje.bundle, aparecida.bundle, corcao.bundle (2026-08-11)

Three complete bootstraps (each gate-green 174/174, es/pt hand-authored,
Wayback caches seeded), awaiting the owner's creation of the empty repos
cronologia/{medjugorje,aparecida,corcao} (no README, no autoInit; Pages only
AFTER the first push of main). To publish each:

    git clone bootstrap-staging/<name>.bundle <name> && cd <name>
    git remote set-url origin https://github.com/cronologia/<name>.git
    git push -u origin main

Then DELETE this directory (staging, not storage), rebuild the portal (cards
for the three new projects still pending), and file each repo's follow-up
epic.
