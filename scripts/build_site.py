#!/usr/bin/env python3
"""Build the Pages artifact; expired builds contain no portfolio files.

The optional repository-root site-expiry.json accepts an ``expires_at`` ISO-8601
timestamp with a timezone. --now is for deterministic local testing only; the
deployment workflow always uses the GitHub runner's UTC clock.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import sys


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_EXPIRY = "2026-11-16T15:10:00Z"
PUBLIC_FILES = ("index.html", "robots.txt", "Kai_Xiao_Simulation_Resume.pdf")
PUBLIC_DIRECTORIES = ("assets",)
OUTPUT_NAMES = frozenset((*PUBLIC_FILES, *PUBLIC_DIRECTORIES, "404.html"))
EXPIRED_HTML = """<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>展示链接已到期</title>
<style>body{margin:0;background:#f6f7f9;color:#17202a;font:18px/1.8 system-ui,sans-serif}
main{max-width:34rem;margin:18vh auto;padding:2rem}h1{font-size:2rem;line-height:1.3}
p{color:#536170}</style></head>
<body><main><h1>此展示链接已到期</h1>
<p>本次分享已结束，原页面和附件不再通过此地址提供。</p>
</main></body></html>
"""


def timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Timestamps must include a timezone (Z or an explicit offset).")
    return parsed.astimezone(timezone.utc)


def expiry() -> datetime:
    config = ROOT / "site-expiry.json"
    if not config.exists():
        return timestamp(DEFAULT_EXPIRY)
    data = json.loads(config.read_text(encoding="utf-8"))
    return timestamp(data["expires_at"])


def prepare_output(requested: Path) -> Path:
    # Only the explicitly selected artifact directory is cleared. Never permit
    # a repository/source directory, an ancestor, or a symlink as the target.
    output = requested if requested.is_absolute() else ROOT / requested
    if output.is_symlink():
        raise ValueError("Output must not be a symlink.")
    output = output.resolve()
    if output == ROOT or output in ROOT.parents:
        raise ValueError("Output must not replace the repository or an ancestor.")
    if output.is_relative_to(ROOT) and output != ROOT / "_site":
        raise ValueError("Inside this repository, only _site may be a build output.")
    if output.exists():
        if not output.is_dir():
            raise ValueError("Output exists and is not a directory.")
        unexpected = {entry.name for entry in output.iterdir()} - OUTPUT_NAMES
        if unexpected:
            raise ValueError("Refusing to clear a directory containing non-artifact files.")
        shutil.rmtree(output)
    output.mkdir(parents=True)
    return output


def verify_public_sources() -> None:
    for name in PUBLIC_FILES:
        source = ROOT / name
        if not source.is_file() or source.is_symlink():
            raise ValueError(f"Missing or unsafe public file: {name}")
    for name in PUBLIC_DIRECTORIES:
        source = ROOT / name
        if not source.is_dir() or source.is_symlink():
            raise ValueError(f"Missing or unsafe public directory: {name}")
        if any(item.is_symlink() for item in source.rglob("*")):
            raise ValueError(f"Public directory must not contain symlinks: {name}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--now", help="Test with an explicit timezone-aware timestamp.")
    parser.add_argument("--output-dir", type=Path, default=Path("_site"))
    args = parser.parse_args()
    now = timestamp(args.now) if args.now else datetime.now(timezone.utc)
    expires_at = expiry()
    expired = now >= expires_at
    if not expired:
        verify_public_sources()
    output = prepare_output(args.output_dir)
    if expired:
        for name in ("index.html", "404.html"):
            (output / name).write_text(EXPIRED_HTML, encoding="utf-8")
        (output / "robots.txt").write_text("User-agent: *\nDisallow: /\n", encoding="utf-8")
    else:
        for name in PUBLIC_FILES:
            shutil.copy2(ROOT / name, output / name)
        for name in PUBLIC_DIRECTORIES:
            shutil.copytree(ROOT / name, output / name)
    print(json.dumps({
        "mode": "expired" if expired else "active",
        "now": now.isoformat(),
        "expires_at": expires_at.isoformat(),
        "output_dir": str(output),
        "files": sum(item.is_file() for item in output.rglob("*")),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, KeyError, OSError) as error:
        print(f"Build failed: {error}", file=sys.stderr)
        raise SystemExit(1)
