import argparse
from datetime import datetime
from pathlib import Path

from ablebackup.backup_engine import backup_project
from ablebackup.catalog import Catalog
from ablebackup.scanner import scan_projects


def _default_timestamp() -> str:
    return datetime.now().strftime("%Y-%m-%d_%H%M")


def _cmd_scan(args) -> int:
    projects = scan_projects([Path(s) for s in args.source])
    for p in projects:
        present = sum(1 for r in p.refs if r.exists)
        miss = len(p.missing)
        print(f"{p.name}: {present} files, {miss} missing  ({p.project_dir})")
    print(f"{len(projects)} project(s) found")
    return 0


def _cmd_backup(args) -> int:
    dest_root = Path(args.dest) / "AbletonBackups"
    timestamp = args.timestamp or _default_timestamp()
    cat = Catalog(Path(args.db))
    projects = scan_projects([Path(s) for s in args.source])
    for p in projects:
        result = backup_project(p, dest_root, timestamp)
        cat.record_snapshot(
            project_name=result.project_name,
            timestamp=result.timestamp,
            total_size=result.total_size,
            file_count=result.file_count,
            status="ok",
            missing=result.missing,
        )
        print(f"backed up {result.project_name}: "
              f"{result.file_count} files, {len(result.missing)} missing")
    cat.close()
    return 0


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
