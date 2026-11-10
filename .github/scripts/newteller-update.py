#!/usr/bin/env python3
"""Regenerates newteller/update.json, the update data NewTeller reads from
https://fourtexec.site/newteller/update.json.

The file holds no builds, only where they are. Every push to main of
fourtexec/newteller publishes a release `commit-<sha>` with one archive per
target (newteller-commit-<sha>-<target>.zip). For each target this script
takes the newest release that carries its archive and writes down the commit,
its date, the download link and the archive's SHA-256. The NewTeller updater
downloads the archive from that link and checks it against the hash.

Usage: newteller-update.py OUTPUT.json   (GITHUB_TOKEN is optional)
"""
import calendar
import json
import os
import re
import sys
import time
import urllib.request

REPO = "fourtexec/newteller"
API = "https://api.github.com/repos/" + REPO
TAG = re.compile(r"^commit-([0-9a-f]{40})$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")


def fetch(url, accept="application/vnd.github+json"):
    request = urllib.request.Request(url, headers={"Accept": accept, "User-Agent": "fourtexec-site"})
    token = os.environ.get("GITHUB_TOKEN")
    # The token is for the API only; asset downloads redirect to other hosts.
    if token and url.startswith("https://api.github.com/"):
        request.add_header("Authorization", "Bearer " + token)
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def archive_hash(asset, assets):
    """The SHA-256 of a release archive: GitHub's own digest of the asset,
    or the .sha256 file the build uploads next to it."""
    digest = asset.get("digest") or ""
    if digest.startswith("sha256:") and SHA256.match(digest[7:]):
        return digest[7:]
    sidecar = assets.get(asset["name"] + ".sha256")
    if sidecar:
        text = fetch(sidecar["browser_download_url"], "application/octet-stream").decode("ascii", "replace")
        value = text.split()[0].lower() if text.split() else ""
        if SHA256.match(value):
            return value
    return None


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    output = sys.argv[1]
    releases = json.loads(fetch(API + "/releases?per_page=30"))
    targets, commits = {}, {}
    for release in releases:  # newest first
        tag = TAG.match(release.get("tag_name") or "")
        if not tag or release.get("draft"):
            continue
        commit = tag.group(1)
        assets = {asset["name"]: asset for asset in release.get("assets", [])}
        pattern = re.compile(r"^newteller-commit-%s-([a-z0-9.]+-x86_64)\.zip$" % commit)
        for name, asset in sorted(assets.items()):
            found = pattern.match(name)
            if not found or found.group(1) in targets or asset.get("state", "uploaded") != "uploaded":
                continue
            sha256 = archive_hash(asset, assets)
            if not sha256:
                print("skipping %s: no SHA-256" % name, file=sys.stderr)
                continue
            if commit not in commits:
                info = json.loads(fetch(API + "/commits/" + commit))["commit"]
                when = time.strptime(info["committer"]["date"], "%Y-%m-%dT%H:%M:%SZ")
                lines = [line.strip() for line in info["message"].splitlines() if line.strip()]
                # A merge commit's first line names the branch; the pull
                # request's title follows it and says what changed.
                if len(lines) > 1 and lines[0].startswith("Merge pull request"):
                    lines = lines[1:]
                commits[commit] = (calendar.timegm(when), lines[0][:200] if lines else "")
            date, notes = commits[commit]
            targets[found.group(1)] = {
                "commit": commit,
                "date": date,  # the commit's time; BUILDINFO of the build carries the same number
                "notes": notes,
                "url": asset["browser_download_url"],
                "sha256": sha256,
                "size": asset.get("size", 0),
            }
    if not targets:
        # Never publish an empty list: the installed systems would see
        # "no build for this system".
        sys.exit("no release archives found in %s; %s left as it is" % (REPO, output))
    manifest = {
        "schema": 1,
        "project": "newteller",
        "source": "https://github.com/" + REPO,
        "targets": dict(sorted(targets.items())),
    }
    text = json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"
    try:
        with open(output, encoding="utf-8") as handle:
            if handle.read() == text:
                print("%s is up to date" % output)
                return
    except FileNotFoundError:
        pass
    with open(output, "w", encoding="utf-8") as handle:
        handle.write(text)
    for target, entry in manifest["targets"].items():
        print("%s -> %s" % (target, entry["commit"][:10]))


if __name__ == "__main__":
    main()
