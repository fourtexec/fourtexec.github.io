# NewTeller update data (`https://fourtexec.site/newteller/`)

`update.json` is what the NewTeller updater (Settings → Updates,
`newteller --check-update`) reads. It holds **no builds, only links**: for
every target the newest commit, its date, the link to the release archive on
GitHub and the archive's SHA-256. NewTeller downloads the archive from that
link, checks the hash and installs it.

```json
{
  "schema": 1,
  "targets": {
    "debian13-x86_64": {
      "commit": "<40 hex>",
      "date": 1793943937,
      "notes": "what changed (first line of the commit)",
      "url": "https://github.com/fourtexec/newteller/releases/download/commit-<sha>/newteller-commit-<sha>-debian13-x86_64.zip",
      "sha256": "<64 hex>",
      "size": 9384700
    }
  }
}
```

Do not edit `update.json` by hand: `.github/workflows/newteller-update.yml`
regenerates it twice an hour (and on **Run workflow**) with
`.github/scripts/newteller-update.py` from the `commit-<sha>` releases of
`fourtexec/newteller`, taking for every target the newest release that has
its archive.

To hold an update back, disable the workflow and put the previous entry back;
installed systems only move to what this file offers.

`index.html` (<https://fourtexec.site/newteller/>) is the download page: it
reads the same `update.json` and shows one card per system, plus the list of
recent changes (`"changes"` in the file, which the updater shows as "What is
new").
