#!/usr/bin/env python3
"""Offline checks of nash-manifest.py: the GitHub API is replaced by canned
answers. Run before the real generation, so a broken generator never
publishes a manifest.

Usage: test_nash_manifest.py
"""
import importlib.util
import json
import os
import sys
import tempfile

sys.dont_write_bytecode = True  # no __pycache__ next to the site's files
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("generator", os.path.join(HERE, "nash-manifest.py"))
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)


def asset(tag, name, digest="a"):
    return {"name": name, "state": "uploaded", "size": 1000,
            "digest": "sha256:" + digest * 64 if digest else None,
            "browser_download_url": "https://github.com/fourtexec/nash/releases/download/%s/%s" % (tag, name)}


def release(tag, names, **extra):
    data = {"tag_name": tag, "published_at": "2026-11-15T09:00:00Z",
            "html_url": "https://github.com/fourtexec/nash/releases/tag/" + tag,
            "assets": [asset(tag, name) for name in names]}
    data.update(extra)
    return data


def commit(sha, message):
    return {"sha": sha * 40, "commit": {"committer": {"date": "2026-11-14T10:00:00Z"}, "message": message}}


COMMITS = [
    commit("a", "Merge pull request #7 from fourtexec/branch\n\nThe title of the pull request"),
    commit("b", "Fix [click](javascript:alert(1)) and ![x](y) `code` | <b>\n\nDetails."),
    commit("c", "\n"),
]


def answers(releases):
    def fetch(url, accept=None):
        if "/releases?" in url:
            return json.dumps(releases if "page=1" in url else []).encode()
        if "/commits?" in url:
            return json.dumps(COMMITS).encode()
        if url.endswith("/SHA256SUMS"):
            return ("%s  nash-linux-aarch64\n%s *nash-macos-aarch64\nnot a line\n" % ("D" * 64, "e" * 64)).encode()
        raise AssertionError("unexpected request: " + url)
    return fetch


def generate_page(releases):
    generator.fetch = answers(releases)
    with tempfile.TemporaryDirectory() as folder:
        path = os.path.join(folder, "nash.md")
        sys.argv = ["nash-manifest.py", os.path.join(folder, "manifest.json"), path]
        generator.main()
        generator.main()  # a second run changes nothing
        with open(path, encoding="utf-8") as handle:
            return handle.read()


def generate(releases, existing=None):
    generator.fetch = answers(releases)
    with tempfile.TemporaryDirectory() as folder:
        path = os.path.join(folder, "manifest.json")
        if existing is not None:
            with open(path, "w", encoding="utf-8") as handle:
                handle.write(existing)
        sys.argv = ["nash-manifest.py", path]
        try:
            generator.main()
        except SystemExit as stop:
            if stop.code not in (None, 0):
                with open(path, encoding="utf-8") as handle:
                    return None, handle.read()
        with open(path, encoding="utf-8") as handle:
            text = handle.read()
        return json.loads(text), text


def main():
    everything = ["nash-linux-x86_64", "nash-linux-aarch64", "nash-macos-x86_64", "nash-macos-aarch64",
                  "nash-android-aarch64", "SHA256SUMS"]
    sums = release("dev12", [])
    sums["assets"] = [asset("dev12", "nash-linux-aarch64", digest=None),
                      asset("dev12", "nash-macos-aarch64", digest=None),
                      asset("dev12", "nash-linux-x86_64", digest=None),  # not in SHA256SUMS
                      asset("dev12", "SHA256SUMS")]
    releases = [
        # A draft is never offered, however new it is.
        release("v9.0.0", everything, draft=True),
        release("dev9", ["nash-linux-x86_64"]),
        sums,
        release("v0.1.0.7", ["nash-linux-x86_64", "nash-plan9-x86_64", "nash-linux-riscv64", "notes.txt"]),
        release("v0.1.1", everything),
        release("v0.1.0", ["nash-macos-aarch64"]),
        release("v.4", everything),          # not a version
        release("nightly", everything),
        release("v0.0.9", []),               # nothing uploaded
    ] + [release("dev%d" % n, ["nash-linux-x86_64"]) for n in range(100, 100 + generator.KEEP_DEV)]
    data, text = generate(releases)
    listed = [(r["channel"], r["version"]) for r in data["releases"]]
    # Stable first, each channel newest first by number (0.1.1 > 0.1.0.7, dev12 > dev9).
    assert listed[:3] == [("stable", "0.1.1"), ("stable", "0.1.0.7"), ("stable", "0.1.0")], listed
    assert listed[3] == ("dev", "dev%d" % (99 + generator.KEEP_DEV)), listed[3]
    # Only the newest development builds are offered.
    assert len(listed) == 3 + generator.KEEP_DEV and ("dev", "dev12") not in listed
    assert data["latest"] == {"stable": "0.1.1", "dev": "dev%d" % (99 + generator.KEEP_DEV)}
    by_version = {r["version"]: r for r in data["releases"]}
    tags = [b["tags"] for b in by_version["0.1.1"]["binaries"]]
    assert tags == [["android", "arm64"], ["linux", "arm64"], ["linux", "amd64"],
                    ["macos", "arm64"], ["macos", "amd64"]], tags
    # Unknown systems and other files are left out.
    assert [b["name"] for b in by_version["0.1.0.7"]["binaries"]] == ["nash-linux-x86_64"]
    first = by_version["0.1.1"]["binaries"][0]
    assert first["url"] == "https://github.com/fourtexec/nash/releases/download/v0.1.1/nash-android-aarch64"
    assert first["sha256"] == "a" * 64 and first["size"] == 1000
    assert data["schema"] == 1

    # No digest from GitHub: SHA256SUMS of the release is used; a binary
    # with no hash at all is not offered.
    data, _ = generate([sums])
    got = {b["name"]: b["sha256"] for b in data["releases"][0]["binaries"]}
    assert got == {"nash-linux-aarch64": "d" * 64, "nash-macos-aarch64": "e" * 64}, got
    assert data["latest"] == {"stable": None, "dev": "dev12"}

    # The same answers again produce the same bytes (no commit every run).
    again, text_again = generate(releases, existing=text)
    assert text_again == text

    # Nothing to offer: the published file is left as it is.
    nothing, kept = generate([release("v0.0.9", [])], existing=text)
    assert nothing is None and kept == text

    # The project page: the newest of each channel, downloads, changes.
    text = generate_page(releases)
    newest_dev = "dev%d" % (99 + generator.KEEP_DEV)
    assert "| stable | [0.1.1](https://github.com/fourtexec/nash/releases/tag/v0.1.1) | 2026-11-15 | `nash update` |" in text
    assert "| dev | [%s](" % newest_dev in text
    assert "## Download 0.1.1\n" in text and "## Development build %s\n" % newest_dev in text
    assert ("| Android (Termux) aarch64 | [nash-android-aarch64](https://github.com/fourtexec/nash/releases/"
            "download/v0.1.1/nash-android-aarch64) | 0.0 MB |") in text
    assert "- 2026-11-14 — The title of the pull request ([aaaaaaa](https://github.com/fourtexec/nash/commit/" in text
    # A commit title cannot bring links, images or markup to the page.
    assert "- 2026-11-14 — Fix click(javascript:alert(1)) and !x(y) code  b ([bbbbbbb](" in text, text
    assert "ccccccc" not in text
    assert "| [0.1.0.7](https://github.com/fourtexec/nash/releases/tag/v0.1.0.7) | stable | 2026-11-15 | Linux |" in text
    # Development builds only: the page has no stable part and still works.
    text = generate_page([sums])
    assert "| stable |" not in text and "## Download" not in text and "nash update dev12 " in text
    print("nash-manifest.py: all checks passed")


if __name__ == "__main__":
    main()
