#!/usr/bin/env python3
"""Regenerates nash/manifest.json, the release manifest `nash update` reads
from https://fourtexec.site/nash/manifest.json.

The file holds no binaries, only where they are. fourtexec/nash publishes a
release per version: `v0.1.1` is a stable release, `dev7` a development build
(one per push to main). A release carries one binary per platform, named
nash-<os>-<cpu>. For each release this script writes down its binaries with
the tags of the platform they are for, the download link and the SHA-256.

`nash update` takes the first release of the channel it was asked for
(stable, dev) that has a binary whose tags name its platform, so releases
are listed newest first; `nash update VERSION` takes that version.

Usage: nash-manifest.py OUTPUT.json   (GITHUB_TOKEN is optional)
"""
import json
import os
import re
import sys
import urllib.request

REPO = "fourtexec/nash"
API = "https://api.github.com/repos/" + REPO
STABLE = re.compile(r"^v(\d+(?:\.\d+)*)$")
DEV = re.compile(r"^dev(\d+)$")
BINARY = re.compile(r"^nash-([a-z0-9]+)-([a-z0-9_]+)$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
# Tags of the manifest by the names used in the binaries.
OS_TAGS = {"linux": "linux", "macos": "macos", "darwin": "macos", "android": "android"}
CPU_TAGS = {"x86_64": "amd64", "amd64": "amd64", "aarch64": "arm64", "arm64": "arm64"}
KEEP_DEV = 20  # development builds on offer; stable releases are all kept
PAGES = 3      # of 100 releases each


def fetch(url, accept="application/vnd.github+json"):
    request = urllib.request.Request(url, headers={"Accept": accept, "User-Agent": "fourtexec-site"})
    token = os.environ.get("GITHUB_TOKEN")
    # The token is for the API only; asset downloads redirect to other hosts.
    if token and url.startswith("https://api.github.com/"):
        request.add_header("Authorization", "Bearer " + token)
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def checksums(assets):
    """The SHA256SUMS file of a release as {name: hash}; read when needed."""
    cache = {}

    def lookup(name):
        if "sums" not in cache:
            cache["sums"] = {}
            if "SHA256SUMS" in assets:
                text = fetch(assets["SHA256SUMS"]["browser_download_url"], "application/octet-stream")
                for line in text.decode("ascii", "replace").splitlines():
                    parts = line.split()
                    if len(parts) == 2 and SHA256.match(parts[0].lower()):
                        cache["sums"][parts[1].lstrip("*")] = parts[0].lower()
        return cache["sums"].get(name)

    return lookup


def binaries(release):
    """The binaries of a release, in a fixed order."""
    assets = {asset["name"]: asset for asset in release.get("assets", [])}
    sums = checksums(assets)
    found = []
    for name, asset in sorted(assets.items()):
        match = BINARY.match(name)
        if not match or asset.get("state", "uploaded") != "uploaded":
            continue
        system, cpu = OS_TAGS.get(match.group(1)), CPU_TAGS.get(match.group(2))
        if not system or not cpu:
            continue
        # GitHub's own digest of the asset, or the SHA256SUMS of the release.
        digest = asset.get("digest") or ""
        sha256 = digest[7:] if digest.startswith("sha256:") and SHA256.match(digest[7:]) else sums(name)
        if not sha256:
            print("skipping %s of %s: no SHA-256" % (name, release["tag_name"]), file=sys.stderr)
            continue
        found.append({
            "tags": [system, cpu],
            "name": name,
            "url": asset["browser_download_url"],
            "sha256": sha256,
            "size": asset.get("size", 0),
        })
    return found


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    output = sys.argv[1]
    stable, dev = [], []
    for page in range(1, PAGES + 1):
        listed = json.loads(fetch(API + "/releases?per_page=100&page=%d" % page))
        for release in listed:
            tag = release.get("tag_name") or ""
            if release.get("draft"):
                continue
            if STABLE.match(tag):
                number = tuple(int(part) for part in STABLE.match(tag).group(1).split("."))
                stable.append((number, tag[1:], "stable", release))
            elif DEV.match(tag):
                dev.append((int(DEV.match(tag).group(1)), tag, "dev", release))
        if len(listed) < 100:
            break
    # Newest first, by version and not by date: a fix of an old version
    # published today is not the newest release.
    stable.sort(key=lambda item: item[0], reverse=True)
    dev.sort(key=lambda item: item[0], reverse=True)
    releases = []
    for _, version, channel, release in stable + dev[:KEEP_DEV]:
        found = binaries(release)
        if not found:
            continue
        releases.append({
            "version": version,
            "channel": channel,
            "date": release.get("published_at") or "",
            "page": release.get("html_url") or "",
            "binaries": found,
        })
    if not releases:
        # Never publish an empty list: every nash would see "no release".
        sys.exit("no release binaries found in %s; %s left as it is" % (REPO, output))
    manifest = {
        "schema": 1,
        "project": "nash",
        "source": "https://github.com/" + REPO,
        "latest": {channel: next((r["version"] for r in releases if r["channel"] == channel), None)
                   for channel in ("stable", "dev")},
        "releases": releases,
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
    for release in releases:
        print("%-7s %-10s %s" % (release["channel"], release["version"],
                                 " ".join("/".join(binary["tags"]) for binary in release["binaries"])))


if __name__ == "__main__":
    main()
