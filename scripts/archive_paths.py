"""Explicit inputs for offline rebuilds; outputs always belong to this checkout."""
import os
from pathlib import Path

APP = Path(__file__).resolve().parents[1]


def archive_root():
    """Return the explicitly selected archive containing work/, never a parent."""
    value = os.environ.get("ATLAS_SOURCE_ROOT")
    if not value:
        raise SystemExit(
            "This offline rebuild needs the original source archive. Set "
            "ATLAS_SOURCE_ROOT to the directory containing its work/ folder; "
            "see scripts/README.md. Bundled runtime data is unchanged."
        )
    root = Path(value).expanduser().resolve()
    if not root.is_dir():
        raise SystemExit(f"ATLAS_SOURCE_ROOT is not a directory: {root}")
    return root


def require_files(paths):
    missing = [str(path) for path in paths if not Path(path).is_file()]
    if missing:
        raise SystemExit(
            "Missing original rebuild inputs (no substitute data was fetched):\n"
            + "\n".join(missing)
            + "\nSee scripts/README.md for the archive layout."
        )


def source_label(path, root):
    """Stable provenance labels, with checkout-local inputs relative to APP."""
    path = Path(path).resolve()
    if path.is_relative_to(APP):
        return path.relative_to(APP).as_posix()
    if path.is_relative_to(root):
        return path.relative_to(root).as_posix()
    raise SystemExit(f"Input is outside the checkout and ATLAS_SOURCE_ROOT: {path}")
