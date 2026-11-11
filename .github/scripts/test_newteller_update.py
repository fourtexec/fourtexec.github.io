#!/usr/bin/env python3
"""Offline checks of newteller-update.py: the GitHub API is replaced by
canned answers. Run before the real generation, so a broken generator never
publishes update data.

Usage: test_newteller_update.py
"""
import calendar
import importlib.util
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("generator", os.path.join(HERE, "newteller-update.py"))
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)

NEW, OLD, DRAFT = "a" * 40, "b" * 40, "c" * 40


def asset(commit, target, digest=True):
    name = "newteller-commit-%s-%s.zip" % (commit, target)
    return {"name": name, "state": "uploaded", "size": 1000,
            "digest": "sha256:" + (commit[0] * 64) if digest else None,
            "browser_download_url": "https://github.com/fourtexec/newteller/releases/download/commit-%s/%s"
                                    % (commit, name)}


def commit_item(sha, parent, date, message):
    return {"sha": sha, "parents": [{"sha": parent}] if parent else [],
            "commit": {"committer": {"date": date}, "message": message}}


COMMITS = {
    NEW: commit_item(NEW, OLD, "2026-11-10T10:00:00Z",
                     "Merge pull request #2 from fourtexec/branch\n\nThe title of the pull request"),
    OLD: commit_item(OLD, None, "2026-11-01T10:00:00Z", "The first build\n\nDetails."),
}


def answers(releases):
    def fetch(url, accept=None):
        if "/releases?" in url:
            return json.dumps(releases).encode()
        if "/commits?" in url:
            return json.dumps([] if "page=2" in url else [COMMITS[NEW], COMMITS[OLD]]).encode()
        if "/commits/" in url:
            return json.dumps(COMMITS[url.rsplit("/", 1)[1]]).encode()
        if url.endswith(".sha256"):
            return ("%s  file.zip\n" % ("d" * 64)).encode()
        raise AssertionError("unexpected request: " + url)
    return fetch


def generate(releases, existing=None):
    generator.fetch = answers(releases)
    with tempfile.TemporaryDirectory() as folder:
        path = os.path.join(folder, "update.json")
        if existing is not None:
            with open(path, "w", encoding="utf-8") as handle:
                handle.write(existing)
        sys.argv = ["newteller-update.py", path]
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
    sidecar_zip = asset(NEW, "arch-x86_64", digest=False)
    releases = [
        # A draft is never offered, however new it is.
        {"tag_name": "commit-" + DRAFT, "draft": True, "assets": [asset(DRAFT, "debian13-x86_64")]},
        # The newest release: the Debian build has not been uploaded yet.
        {"tag_name": "commit-" + NEW, "assets": [
            asset(NEW, "ubuntu26.04-x86_64"), sidecar_zip,
            {"name": sidecar_zip["name"] + ".sha256", "state": "uploaded",
             "browser_download_url": sidecar_zip["browser_download_url"] + ".sha256"},
            {"name": "notes.txt", "state": "uploaded", "browser_download_url": "https://example.invalid/x"}]},
        {"tag_name": "commit-" + OLD, "assets": [asset(OLD, "debian13-x86_64"),
                                                  asset(OLD, "ubuntu26.04-x86_64")]},
        {"tag_name": "v1.0", "assets": [asset(OLD, "fedora45-x86_64")]},
    ]
    data, text = generate(releases)
    targets = data["targets"]
    assert sorted(targets) == ["arch-x86_64", "debian13-x86_64", "ubuntu26.04-x86_64"], sorted(targets)
    assert targets["ubuntu26.04-x86_64"]["commit"] == NEW
    assert targets["ubuntu26.04-x86_64"]["sha256"] == "a" * 64
    # Each system gets the newest release that has its archive.
    assert targets["debian13-x86_64"]["commit"] == OLD
    # No digest from GitHub: the .sha256 file next to the archive is used.
    assert targets["arch-x86_64"]["sha256"] == "d" * 64
    assert targets["ubuntu26.04-x86_64"]["notes"] == "The title of the pull request"
    assert targets["ubuntu26.04-x86_64"]["date"] == calendar.timegm((2026, 11, 10, 10, 0, 0))
    assert all(entry["url"].startswith("https://github.com/fourtexec/newteller/releases/download/")
               for entry in targets.values())
    assert [change["commit"] for change in data["changes"]] == [NEW, OLD]
    assert data["changes"][1]["title"] == "The first build"
    assert data["schema"] == 1

    # The same answers again produce the same bytes (no commit every run).
    again, text_again = generate(releases, existing=text)
    assert text_again == text

    # Nothing to offer: the published file is left as it is.
    nothing, kept = generate([{"tag_name": "commit-" + NEW, "assets": []}], existing=text)
    assert nothing is None and kept == text
    print("newteller-update.py: all checks passed")


if __name__ == "__main__":
    main()
