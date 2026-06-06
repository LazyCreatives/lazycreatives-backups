import argparse
from pathlib import Path

from ablebackup.catalog import Catalog
from ablebackup.scanner import scan_projects
from ablebackup.service import default_timestamp, run_backup


def _cmd_scan(args) -> int:
    projects = scan_projects([Path(s) for s in args.source])
    for p in projects:
        present = sum(1 for r in p.refs if r.exists)
        miss = len(p.missing)
        print(f"{p.name}: {present} files, {miss} missing  ({p.project_dir})")
    print(f"{len(projects)} project(s) found")
    return 0


def _cmd_backup(args) -> int:
    timestamp = args.timestamp or default_timestamp()
    cat = Catalog(Path(args.db))
    try:
        def progress(ev):
            if ev["type"] == "project_done":
                print(f"backed up {ev['project_name']}: "
                      f"{ev['file_count']} files, {ev['missing_count']} missing")
            elif ev["type"] == "project_error":
                print(f"ERROR backing up {ev['project_name']}: {ev['error']}")
        summary = run_backup([Path(s) for s in args.source], Path(args.dest),
                             cat, timestamp=timestamp, progress=progress)
    finally:
        cat.close()
    return 1 if summary["error_count"] else 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="ablebackup")
    sub = parser.add_subparsers(dest="command", required=True)

    scan_p = sub.add_parser("scan", help="list discovered projects")
    scan_p.add_argument("--source", action="append", required=True)
    scan_p.set_defaults(func=_cmd_scan)

    backup_p = sub.add_parser("backup", help="back up projects to destination")
    backup_p.add_argument("--source", action="append", required=True)
    backup_p.add_argument("--dest", required=True)
    backup_p.add_argument("--db", required=True)
    backup_p.add_argument("--timestamp", default=None)
    backup_p.set_defaults(func=_cmd_backup)

    return parser


def run(argv: list[str]) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    import sys
    raise SystemExit(run(sys.argv[1:]))
