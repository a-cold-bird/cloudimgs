#!/usr/bin/env python3
"""
Recover CloudImgs albums/files records from uploads directory.

This script only imports image files (including GIF) and skips all other file types.
It is designed for partial recovery when SQLite metadata is missing.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import os
import re
import sqlite3
import sys
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set, Tuple


ALLOWED_EXTENSIONS: Set[str] = {
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".avif",
    ".bmp",
    ".svg",
}


IGNORED_DIR_NAMES: Set[str] = {
    ".cache",
    ".trash",
    "config",
    "logs",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def log(message: str) -> None:
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {message}")


def detect_default_uploads() -> str:
    candidates = [
        Path("uploads"),
        Path("packages/server/uploads"),
    ]
    for item in candidates:
        if item.exists() and item.is_dir():
            return str(item)
    return str(candidates[0])


def detect_default_db() -> str:
    candidates = [
        Path("data/cloudimgs.db"),
        Path("packages/server/data/cloudimgs.db"),
    ]
    for item in candidates:
        if item.exists() and item.is_file():
            return str(item)
    return str(candidates[0])


def slugify(text: str) -> str:
    lowered = text.strip().lower()
    lowered = re.sub(r"[^\w\u4e00-\u9fff]+", "-", lowered, flags=re.UNICODE)
    lowered = lowered.strip("-_")
    return lowered or "album"


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
CREATE TABLE IF NOT EXISTS albums (
    id text PRIMARY KEY NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    parent_id text,
    password text,
    is_public integer DEFAULT false,
    cover_file_id text,
    path text DEFAULT '/' NOT NULL,
    created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
    id text PRIMARY KEY NOT NULL,
    key text NOT NULL,
    original_name text NOT NULL,
    size integer NOT NULL,
    mime_type text NOT NULL,
    width integer,
    height integer,
    thumbhash text,
    tags text DEFAULT '[]',
    caption text,
    semantic_description text,
    aliases text DEFAULT '[]',
    annotation_updated_at text,
    exif_data text,
    album_id text,
    created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
    id text PRIMARY KEY NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    color text DEFAULT '#6366f1',
    created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key text PRIMARY KEY NOT NULL,
    value text
);

CREATE UNIQUE INDEX IF NOT EXISTS files_key_unique ON files (key);
CREATE UNIQUE INDEX IF NOT EXISTS albums_slug_unique ON albums (slug);
CREATE UNIQUE INDEX IF NOT EXISTS tags_name_unique ON tags (name);
CREATE UNIQUE INDEX IF NOT EXISTS tags_slug_unique ON tags (slug);
"""
    )

    required_file_columns = {
        "tags": "ALTER TABLE files ADD COLUMN tags text DEFAULT '[]'",
        "caption": "ALTER TABLE files ADD COLUMN caption text",
        "semantic_description": "ALTER TABLE files ADD COLUMN semantic_description text",
        "aliases": "ALTER TABLE files ADD COLUMN aliases text DEFAULT '[]'",
        "annotation_updated_at": "ALTER TABLE files ADD COLUMN annotation_updated_at text",
    }
    existing_columns = {
        row[1] for row in conn.execute("PRAGMA table_info(files)").fetchall()
    }
    for col, ddl in required_file_columns.items():
        if col not in existing_columns:
            conn.execute(ddl)


def is_image_file(path: Path) -> bool:
    suffix = path.suffix.lower()
    if suffix in ALLOWED_EXTENSIONS:
        return True
    mime_type, _ = mimetypes.guess_type(str(path))
    return bool(mime_type and mime_type.startswith("image/"))


def guess_mime(path: Path) -> str:
    mime_type, _ = mimetypes.guess_type(str(path))
    if mime_type and mime_type.startswith("image/"):
        return mime_type
    suffix = path.suffix.lower()
    fallback_map = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".avif": "image/avif",
        ".bmp": "image/bmp",
        ".svg": "image/svg+xml",
    }
    return fallback_map.get(suffix, "application/octet-stream")


def looks_like_sharded_upload(relative_key: str) -> bool:
    # Current uploader stores keys like: YYYY/MM/uuid.ext
    parts = relative_key.split("/")
    if len(parts) < 3:
        return False
    if not re.fullmatch(r"\d{4}", parts[0]):
        return False
    if not re.fullmatch(r"\d{1,2}", parts[1]):
        return False
    return True


def normalize_rel_key(path: Path, base: Path) -> str:
    return path.relative_to(base).as_posix()


def iter_files(base: Path, include_hidden: bool) -> Iterable[Path]:
    for root, dirnames, filenames in os.walk(base):
        root_path = Path(root)

        kept_dirs: List[str] = []
        for d in dirnames:
            if d in IGNORED_DIR_NAMES:
                continue
            if not include_hidden and d.startswith("."):
                continue
            kept_dirs.append(d)
        dirnames[:] = kept_dirs

        for filename in filenames:
            if not include_hidden and filename.startswith("."):
                continue
            yield root_path / filename


def ensure_unique_slug(
    conn: sqlite3.Connection,
    base_slug: str,
    album_path: str,
    slug_cache: Set[str],
) -> str:
    candidate = base_slug
    if candidate in slug_cache:
        digest = hashlib.sha1(album_path.encode("utf-8")).hexdigest()[:6]
        candidate = f"{base_slug}-{digest}"

    counter = 1
    while True:
        exists = conn.execute(
            "SELECT 1 FROM albums WHERE slug = ? LIMIT 1",
            (candidate,),
        ).fetchone()
        if not exists and candidate not in slug_cache:
            slug_cache.add(candidate)
            return candidate
        counter += 1
        candidate = f"{base_slug}-{counter}"


@dataclass
class RecoveryContext:
    conn: sqlite3.Connection
    dry_run: bool
    public_albums: bool
    album_cache: Dict[str, str]
    slug_cache: Set[str]
    album_ids: Set[str]
    created_albums: int = 0


@dataclass
class ExistingFileRow:
    id: str
    album_id: Optional[str]
    original_name: str
    size: int
    mime_type: str


def ensure_album_chain(ctx: RecoveryContext, album_path: str) -> Optional[str]:
    if not album_path or album_path == "/":
        return None

    normalized = "/" + "/".join([p for p in album_path.strip("/").split("/") if p])
    if normalized in ctx.album_cache:
        return ctx.album_cache[normalized]

    parent_id: Optional[str] = None
    current = ""
    for segment in normalized.strip("/").split("/"):
        current = f"{current}/{segment}" if current else f"/{segment}"
        existing = ctx.album_cache.get(current)
        if existing:
            parent_id = existing
            continue

        album_id = str(uuid.uuid4())
        slug = ensure_unique_slug(ctx.conn, slugify(segment), current, ctx.slug_cache)
        ts = now_iso()

        if not ctx.dry_run:
            ctx.conn.execute(
                """
                INSERT INTO albums (
                    id, name, slug, parent_id, password, is_public, cover_file_id, path, created_at, updated_at
                ) VALUES (?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?)
                """,
                (
                    album_id,
                    segment,
                    slug,
                    parent_id,
                    1 if ctx.public_albums else 0,
                    current,
                    ts,
                    ts,
                ),
            )

        ctx.album_cache[current] = album_id
        ctx.album_ids.add(album_id)
        parent_id = album_id
        ctx.created_albums += 1

    return ctx.album_cache.get(normalized)


def decide_album_path(rel_key: str, mode: str) -> Optional[str]:
    parent = str(Path(rel_key).parent).replace("\\", "/")
    if parent == ".":
        return None
    if mode == "none":
        return None
    if mode == "by-dir":
        return "/" + parent.strip("/")
    if mode == "auto":
        if looks_like_sharded_upload(rel_key):
            return None
        return "/" + parent.strip("/")
    raise ValueError(f"Unsupported mode: {mode}")


def repair_existing_file(
    ctx: RecoveryContext,
    existing: ExistingFileRow,
    full_path: Path,
    rel_key: str,
    target_album_id: Optional[str],
) -> bool:
    # In auto mode, sharded keys map to None; do not clear existing album_id in this case.
    if target_album_id is None:
        target_album_id = existing.album_id

    expected_size = int(full_path.stat().st_size)
    expected_name = full_path.name
    expected_mime = guess_mime(full_path)
    existing_album_id_valid = (
        existing.album_id is None or existing.album_id in ctx.album_ids
    )

    needs_update = (
        existing.album_id != target_album_id
        or existing.size != expected_size
        or existing.original_name != expected_name
        or not str(existing.mime_type).startswith("image/")
        or (existing.mime_type and existing.mime_type != expected_mime)
        or (existing.album_id and not existing_album_id_valid)
    )

    if not needs_update:
        return False

    if not ctx.dry_run:
        ctx.conn.execute(
            """
            UPDATE files
            SET
                album_id = ?,
                original_name = ?,
                size = ?,
                mime_type = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (
                target_album_id,
                expected_name,
                expected_size,
                expected_mime,
                now_iso(),
                existing.id,
            ),
        )

    return True


def load_existing_state(
    conn: sqlite3.Connection,
) -> Tuple[Dict[str, str], Set[str], Set[str], Dict[str, ExistingFileRow], Set[str]]:
    album_cache: Dict[str, str] = {}
    slug_cache: Set[str] = set()
    existing_keys: Set[str] = set()
    existing_files: Dict[str, ExistingFileRow] = {}
    album_ids: Set[str] = set()

    for row in conn.execute("SELECT id, path, slug FROM albums").fetchall():
        album_id, album_path, slug = row
        if album_path:
            album_cache[str(album_path)] = str(album_id)
        if slug:
            slug_cache.add(str(slug))
        if album_id:
            album_ids.add(str(album_id))

    for row in conn.execute(
        "SELECT id, key, album_id, original_name, size, mime_type FROM files"
    ).fetchall():
        key = str(row[1])
        existing_keys.add(key)
        existing_files[key] = ExistingFileRow(
            id=str(row[0]),
            album_id=str(row[2]) if row[2] else None,
            original_name=str(row[3]) if row[3] else "",
            size=int(row[4]) if row[4] is not None else 0,
            mime_type=str(row[5]) if row[5] else "",
        )

    return album_cache, slug_cache, existing_keys, existing_files, album_ids


def recover(args: argparse.Namespace) -> int:
    uploads_dir = Path(args.uploads).resolve()
    db_path = Path(args.db).resolve()
    scan_root = uploads_dir

    if args.subdir:
        scan_root = (uploads_dir / args.subdir).resolve()
        if not str(scan_root).startswith(str(uploads_dir)):
            log("ERROR: --subdir must be inside uploads directory.")
            return 2

    if not uploads_dir.exists() or not uploads_dir.is_dir():
        log(f"ERROR: uploads directory not found: {uploads_dir}")
        return 2
    if not scan_root.exists() or not scan_root.is_dir():
        log(f"ERROR: scan directory not found: {scan_root}")
        return 2

    db_path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        ensure_schema(conn)
        album_cache, slug_cache, existing_keys, existing_files, album_ids = load_existing_state(conn)
        ctx = RecoveryContext(
            conn=conn,
            dry_run=args.dry_run,
            public_albums=args.public_albums,
            album_cache=album_cache,
            slug_cache=slug_cache,
            album_ids=album_ids,
        )

        scanned = 0
        skipped_non_image = 0
        skipped_existing = 0
        repaired_existing = 0
        inserted_files = 0
        failed_files = 0

        log(f"Uploads root: {uploads_dir}")
        log(f"Scan root:    {scan_root}")
        log(f"Database:     {db_path}")
        log(f"Album mode:   {args.album_mode}")
        log(f"Dry run:      {args.dry_run}")
        log(f"Repair mode:  {args.repair_existing}")

        if not args.dry_run:
            conn.execute("BEGIN")

        for full_path in iter_files(scan_root, include_hidden=args.include_hidden):
            scanned += 1
            rel_key = normalize_rel_key(full_path, uploads_dir)

            if not is_image_file(full_path):
                skipped_non_image += 1
                continue

            album_path = decide_album_path(rel_key, args.album_mode)
            album_id = ensure_album_chain(ctx, album_path) if album_path else None

            if rel_key in existing_keys:
                skipped_existing += 1
                if args.repair_existing:
                    existing = existing_files.get(rel_key)
                    if existing:
                        try:
                            if repair_existing_file(ctx, existing, full_path, rel_key, album_id):
                                repaired_existing += 1
                        except Exception as exc:  # noqa: BLE001
                            failed_files += 1
                            log(f"WARN: failed to repair '{rel_key}': {exc}")
                continue

            try:
                stat = full_path.stat()
                file_id = str(uuid.uuid4())
                ts = now_iso()
                mime_type = guess_mime(full_path)

                if not args.dry_run:
                    conn.execute(
                        """
                        INSERT INTO files (
                            id, key, original_name, size, mime_type, width, height, thumbhash,
                            tags, caption, semantic_description, aliases, annotation_updated_at,
                            exif_data, album_id, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, NULL, ?, NULL, NULL, ?, ?, ?)
                        """,
                        (
                            file_id,
                            rel_key,
                            full_path.name,
                            int(stat.st_size),
                            mime_type,
                            json.dumps([], ensure_ascii=False),
                            json.dumps([], ensure_ascii=False),
                            album_id,
                            ts,
                            ts,
                        ),
                    )
                existing_keys.add(rel_key)
                inserted_files += 1
            except Exception as exc:  # noqa: BLE001
                failed_files += 1
                log(f"WARN: failed to recover '{rel_key}': {exc}")

        if args.dry_run:
            log("Dry run finished (no database changes written).")
        else:
            conn.commit()
            log("Recovery committed.")

        log("Summary:")
        log(f"  scanned files:        {scanned}")
        log(f"  inserted files:       {inserted_files}")
        log(f"  repaired existing:    {repaired_existing}")
        log(f"  created albums:       {ctx.created_albums}")
        log(f"  skipped non-images:   {skipped_non_image}")
        log(f"  skipped existing key: {skipped_existing}")
        log(f"  failed operations:    {failed_files}")
        return 0
    except Exception as exc:  # noqa: BLE001
        if not args.dry_run:
            conn.rollback()
        log(f"ERROR: recovery failed: {exc}")
        return 1
    finally:
        conn.close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Recover CloudImgs files/albums metadata from uploads directory."
    )
    parser.add_argument(
        "--uploads",
        default=detect_default_uploads(),
        help="Uploads directory path (default: auto-detect).",
    )
    parser.add_argument(
        "--db",
        default=detect_default_db(),
        help="SQLite database file path (default: auto-detect).",
    )
    parser.add_argument(
        "--subdir",
        default="",
        help="Only recover this sub-directory inside uploads (for partial recovery).",
    )
    parser.add_argument(
        "--album-mode",
        choices=["auto", "by-dir", "none"],
        default="auto",
        help="How to assign albums from folders: auto|by-dir|none (default: auto).",
    )
    parser.add_argument(
        "--public-albums",
        action="store_true",
        help="Mark newly created recovered albums as public.",
    )
    parser.add_argument(
        "--include-hidden",
        action="store_true",
        help="Include hidden files/directories (default excludes hidden/cache/trash/config).",
    )
    parser.add_argument(
        "--repair-existing",
        action="store_true",
        help="Repair existing file rows (album_id/name/size/mime) by current uploads structure.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview recovery result without writing database.",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return recover(args)


if __name__ == "__main__":
    sys.exit(main())
