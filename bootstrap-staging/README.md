# bootstrap-staging

Temporary parking for bootstrapped projects whose GitHub repository does not
exist yet. Each `.bundle` is a complete `git bundle` of the new project's
`main` — commit history, message and authorship intact.

## kofc.bundle (2026-08-10)

The complete Knights of Columbus bootstrap (51 events, 10 figures, 47
references, en/es/pt, gate green 174/174, Wayback cache seeded), built in a
session that could not reach `cronologia/kofc`: the GitHub App cannot create
org repositories (403) and the session's repo-attach was denied. Once the
owner creates `cronologia/kofc` (EMPTY — no README, no autoInit; Pages
enabled only AFTER the first push of `main`, per bootstrap-project step 6):

```
git clone bootstrap-staging/kofc.bundle kofc && cd kofc
git remote set-url origin https://github.com/cronologia/kofc.git
git push -u origin main
```

Then DELETE this directory (it is staging, not storage) and rebuild the
portal, whose kofc card is parked on this branch in cronologia.github.io.
