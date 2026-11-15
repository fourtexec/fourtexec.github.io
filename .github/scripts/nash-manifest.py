#!/usr/bin/env python3
"""Regenerates what the site says about nash:

  nash/manifest.json  the releases and their binaries as data, at
                      https://fourtexec.site/nash/manifest.json (older builds
                      of nash update themselves from it; newer ones
                      ask GitHub directly)
  projects/nash.md    the project page: the newest releases, their downloads
                      and the latest changes

The file holds no binaries, only where they are. fourtexec/nash publishes a
release per version: `v0.1.1` is a stable release, `dev7` a development build
(one per push to main). A release carries one binary per platform, named
nash-<os>-<cpu>. For each release this script writes down its binaries with
the tags of the platform they are for, the download link and the SHA-256.

Releases are listed newest first within a channel (stable, dev): a reader
takes the first one that has a binary whose tags name its platform.

Run by the release workflow of fourtexec/nash after every release, and by a
workflow of this repository twice an hour.

Usage: nash-manifest.py MANIFEST.json [PAGE.md]   (GITHUB_TOKEN is optional)
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
CHANGES = 10   # commits listed on the project page
SYSTEMS = {"linux": "Linux", "macos": "macOS", "android": "Android (Termux)"}
CPUS = {"amd64": "x86_64", "arm64": "aarch64"}


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


def plain(text):
    """Text of a commit for the page: one line with no markdown of its own
    (the site would render links and images written into a commit title)."""
    line = next((line.strip() for line in text.splitlines() if line.strip()), "")
    return re.sub(r"[\[\]`*~|<>]", "", line)[:120].strip()


def changes():
    """The newest commits of main as (date, title, sha). A merged pull
    request is listed by its title, not by "Merge pull request"."""
    found = []
    for item in json.loads(fetch(API + "/commits?per_page=%d" % CHANGES)):
        lines = [line.strip() for line in item["commit"]["message"].splitlines() if line.strip()]
        if len(lines) > 1 and lines[0].startswith("Merge pull request"):
            lines = lines[1:]
        title = plain(lines[0]) if lines else ""
        if title:
            found.append((item["commit"]["committer"]["date"][:10], title, item["sha"]))
    return found


def downloads(release):
    rows = ["| platform | file | size |", "| --- | --- | --- |"]
    for binary in release["binaries"]:
        system, cpu = binary["tags"]
        rows.append("| %s %s | [%s](%s) | %.1f MB |" % (SYSTEMS[system], CPUS[cpu], binary["name"], binary["url"],
                                                    binary["size"] / 1e6))
    return rows


def project_page(manifest, commits):
    """projects/nash.md: written for the site's own markdown renderer."""
    releases = manifest["releases"]
    newest = {channel: next((r for r in releases if r["channel"] == channel), None) for channel in ("stable", "dev")}
    out = [
        "<!-- Generated by .github/scripts/nash-manifest.py from the releases of fourtexec/nash. Do not edit. -->",
        "# nash",
        "",
        "nash is a modern descendant of `sh`, written in Rust. It runs your existing",
        "sh/bash scripts, takes the best interactive ideas from zsh and adds a few of",
        "its own. The only dependency is `libc`.",
        "",
        "## Latest",
        "",
        "| channel | version | released | get it |",
        "| --- | --- | --- | --- |",
    ]
    commands = {"stable": "nash update", "dev": "nash update dev"}
    for channel, release in newest.items():
        if release:
            out.append("| %s | [%s](%s) | %s | `%s` |" % (channel, release["version"], release["page"],
                                                         release["date"][:10], commands[channel]))
    out += [
        "",
        "## Install",
        "",
        "```sh",
        "curl -fsSL https://raw.githubusercontent.com/fourtexec/nash/main/install.sh | sh",
        "```",
        "",
        "## Update",
        "",
        "nash updates itself straight from its [GitHub releases](https://github.com/%s/releases):" % REPO,
        "it takes the binary named after your system and CPU from the release, checks",
        "its SHA-256 and replaces itself.",
        "",
        "```sh",
        "nash update          # the newest stable release",
        "nash update dev      # the newest development build",
        "nash update %-8s # exactly that release" % (newest["stable"] or newest["dev"])["version"],
        "nash update --list   # what there is for your system",
        "```",
    ]
    for channel, title in (("stable", "Download %s"), ("dev", "Development build %s")):
        release = newest[channel]
        if release:
            out += ["", "## " + title % release["version"], ""] + downloads(release)
    if commits:
        out += ["", "## Latest changes", ""]
        out += ["- %s — %s ([%s](https://github.com/%s/commit/%s))" % (date, title, sha[:7], REPO, sha)
                for date, title, sha in commits]
    out += ["", "## All releases", "", "| version | channel | released | systems |", "| --- | --- | --- | --- |"]
    for release in releases:
        systems = sorted({SYSTEMS[binary["tags"][0]] for binary in release["binaries"]})
        out.append("| [%s](%s) | %s | %s | %s |" % (release["version"], release["page"], release["channel"],
                                                   release["date"][:10], ", ".join(systems)))
    out += ["", "Source code and issues: [github.com/%s](https://github.com/%s)." % (REPO, REPO)]
    return "\n".join(out) + "\n"


def write(path, text):
    """Write a file only if it changes; True if it did."""
    try:
        with open(path, encoding="utf-8") as handle:
            if handle.read() == text:
                print("%s is up to date" % path)
                return False
    except FileNotFoundError:
        pass
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text)
    return True


def main():
    if len(sys.argv) not in (2, 3):
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
    changed = write(output, json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    if len(sys.argv) == 3:
        changed = write(sys.argv[2], project_page(manifest, changes())) or changed
    if changed:
        for release in releases:
            print("%-7s %-10s %s" % (release["channel"], release["version"],
                                     " ".join("/".join(binary["tags"]) for binary in release["binaries"])))


if __name__ == "__main__":
    main()
