"""Print one version's "What's new" section from CHANGELOG.md.

    python .github/scripts/release_notes.py 0.1.6           # print the notes
    python .github/scripts/release_notes.py 0.1.6 --check   # fail if there are none

The release job puts the printed notes on the version's download page, and the
checks on a version-bump pull request use --check so no release goes out without them.
"""
import pathlib
import re
import sys

CHANGELOG = pathlib.Path(__file__).resolve().parents[2] / "CHANGELOG.md"


def section(version: str, text: str) -> str:
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    out, inside = [], False
    for line in text.splitlines():
        if line.startswith("## "):
            if inside:
                break
            # "## 0.1.6 (2 October 2026)" or just "## 0.1.6"
            inside = line[3:].split(" ", 1)[0].lstrip("v") == version
            continue
        if inside:
            out.append(line)
    return "\n".join(out).strip()


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__, file=sys.stderr)
        return 2
    version = argv[0].lstrip("v")
    notes = section(version, CHANGELOG.read_text(encoding="utf-8"))
    if "--check" in argv:
        if not notes:
            print(f"CHANGELOG.md has no notes for {version}: rename 'Unreleased' to "
                  f"'{version} (<date>)' and make sure it lists what changed.", file=sys.stderr)
            return 1
        print(f"CHANGELOG.md has notes for {version}.")
        return 0
    print(notes)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
