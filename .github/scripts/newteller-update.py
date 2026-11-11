#!/usr/bin/env python3
"""Regenerates newteller/update.json, the update data NewTeller reads from
https://fourtexec.site/newteller/update.json.

The file holds no builds, only where they are. Every push to main of
fourtexec/newteller publishes a release `commit-<sha>` with one archive per
target (newteller-commit-<sha>-<target>.zip). For each target this script
takes the newest release that carries its archive and writes down the commit,
its date, the download link and the archive's SHA-256. The NewTeller updater
downloads the archive from that link and checks it against the hash.

Next to it, changes.xml is an Atom feed of the same changes for feed readers.

Usage: newteller-update.py OUTPUT.json   (GITHUB_TOKEN is optional)
"""
import calendar
import json
import os
import re
import sys
import time
import urllib.request
from xml.sax.saxutils import escape

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


def describe(info):
    """(time, title) of a commit object of the API."""
    when = time.strptime(info["committer"]["date"], "%Y-%m-%dT%H:%M:%SZ")
    lines = [line.strip() for line in info["message"].splitlines() if line.strip()]
    # A merge commit's first line names the branch; the pull request's title
    # follows it and says what changed.
    if len(lines) > 1 and lines[0].startswith("Merge pull request"):
        lines = lines[1:]
    return calendar.timegm(when), lines[0][:200] if lines else ""


def atom_feed(changes):
    """The list of changes as an Atom feed (newest first, as in the data)."""
    def stamp(seconds):
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(seconds))
    lines = [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<feed xmlns="http://www.w3.org/2005/Atom">',
        "  <title>NewTeller: what changed</title>",
        '  <link href="https://fourtexec.site/newteller/"/>',
        '  <link rel="self" href="https://fourtexec.site/newteller/changes.xml"/>',
        "  <id>https://fourtexec.site/newteller/</id>",
        "  <author><name>fourtexec</name></author>",
        "  <updated>%s</updated>" % stamp(changes[0]["date"] if changes else 0),
    ]
    for change in changes:
        link = "https://github.com/%s/commit/%s" % (REPO, change["commit"])
        lines += [
            "  <entry>",
            "    <title>%s</title>" % escape(change["title"]),
            '    <link href="%s"/>' % link,
            "    <id>%s</id>" % link,
            "    <updated>%s</updated>" % stamp(change["date"]),
            "  </entry>",
        ]
    return "\n".join(lines + ["</feed>"]) + "\n"


def write_if_changed(path, text):
    try:
        with open(path, encoding="utf-8") as handle:
            if handle.read() == text:
                return False
    except FileNotFoundError:
        pass
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text)
    return True


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
                commits[commit] = describe(json.loads(fetch(API + "/commits/" + commit))["commit"])
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
    # What the builds bring: the newest commits of the project, newest
    # first. The updater shows the ones after the installed build. Only the
    # main line is listed (a merged pull request is one entry, not its
    # commits), and nothing newer than the newest build on offer.
    newest = max(targets.values(), key=lambda entry: entry["date"])["commit"]
    changes, parent, history = [], newest, {}
    for page in range(1, 6):
        listed = json.loads(fetch(API + "/commits?per_page=100&page=%d&sha=%s" % (page, newest)))
        history.update((item["sha"], item) for item in listed)
        while parent in history and len(changes) < 30:
            item = history[parent]
            date, title = describe(item["commit"])
            if title:
                changes.append({"commit": parent, "date": date, "title": title})
            parent = item["parents"][0]["sha"] if item["parents"] else None
        if not listed or parent is None or len(changes) >= 30:
            break
    manifest = {
        "schema": 1,
        "project": "newteller",
        "source": "https://github.com/" + REPO,
        "targets": dict(sorted(targets.items())),
        "changes": changes,
    }
    text = json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"
    feed = os.path.join(os.path.dirname(output) or ".", "changes.xml")
    feed_changed = write_if_changed(feed, atom_feed(changes))
    if not write_if_changed(output, text) and not feed_changed:
        print("%s is up to date" % output)
        return
    for target, entry in manifest["targets"].items():
        print("%s -> %s" % (target, entry["commit"][:10]))


if __name__ == "__main__":
    main()
