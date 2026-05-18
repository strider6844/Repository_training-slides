"""Object storage backend.

Two implementations, picked at runtime by the STORAGE_BACKEND env var:

  STORAGE_BACKEND=local  (default) — files written under STORAGE_DIR
  STORAGE_BACKEND=r2              — files stored in a Cloudflare R2 bucket

The local backend is convenient for development. R2 (S3-compatible) is what we
use in production because most cheap PaaS hosts wipe local disk on every restart.

Public interface (same for both backends so server.py doesn't care):
  init_storage()        — call once on startup, raises if misconfigured
  put_object(path, data, content_type) -> {"path": str, "size": int}
  get_object(path) -> (bytes, content_type)
  delete_object(path) -> bool
"""
from __future__ import annotations

import logging
import mimetypes
import os
from pathlib import Path

logger = logging.getLogger(__name__)

BACKEND = os.environ.get("STORAGE_BACKEND", "local").lower()


# ============================================================
# Local-filesystem backend
# ============================================================
_DEFAULT_DIR = Path(__file__).parent / "data" / "uploads"
STORAGE_ROOT: Path = Path(os.environ.get("STORAGE_DIR", str(_DEFAULT_DIR))).resolve()


def _local_resolve_safe(path: str) -> Path:
    if not path:
        raise ValueError("Empty storage path")
    candidate = (STORAGE_ROOT / path).resolve()
    try:
        candidate.relative_to(STORAGE_ROOT)
    except ValueError:
        raise ValueError(f"Storage path escapes root: {path}")
    return candidate


def _local_init() -> None:
    STORAGE_ROOT.mkdir(parents=True, exist_ok=True)
    logger.info(f"[storage:local] ready at {STORAGE_ROOT}")


def _local_put(path: str, data: bytes, content_type: str) -> dict:
    full = _local_resolve_safe(path)
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_bytes(data)
    return {"path": path, "size": len(data)}


def _local_get(path: str) -> tuple[bytes, str]:
    full = _local_resolve_safe(path)
    if not full.is_file():
        raise FileNotFoundError(f"Storage object not found: {path}")
    guessed, _ = mimetypes.guess_type(full.name)
    return full.read_bytes(), guessed or "application/octet-stream"


def _local_delete(path: str) -> bool:
    full = _local_resolve_safe(path)
    if full.is_file():
        full.unlink()
        return True
    return False


# ============================================================
# Cloudflare R2 backend (S3-compatible)
# ============================================================
# Lazy imports so the local backend doesn't require boto3 to be installed.
_r2_client = None
_r2_bucket: str | None = None


def _r2_endpoint() -> str:
    # Allow an explicit override (e.g. for tests against MinIO) or build from
    # the Cloudflare account ID — both work.
    endpoint = os.environ.get("R2_ENDPOINT_URL")
    if endpoint:
        return endpoint
    account_id = os.environ.get("R2_ACCOUNT_ID")
    if not account_id:
        raise RuntimeError("STORAGE_BACKEND=r2 requires R2_ENDPOINT_URL or R2_ACCOUNT_ID")
    return f"https://{account_id}.r2.cloudflarestorage.com"


def _r2_init() -> None:
    global _r2_client, _r2_bucket
    if _r2_client is not None:
        return
    import boto3
    from botocore.config import Config

    bucket = os.environ.get("R2_BUCKET_NAME")
    access_key = os.environ.get("R2_ACCESS_KEY_ID")
    secret_key = os.environ.get("R2_SECRET_ACCESS_KEY")
    missing = [
        name for name, val in [
            ("R2_BUCKET_NAME", bucket),
            ("R2_ACCESS_KEY_ID", access_key),
            ("R2_SECRET_ACCESS_KEY", secret_key),
        ] if not val
    ]
    if missing:
        raise RuntimeError(f"STORAGE_BACKEND=r2 missing env vars: {', '.join(missing)}")

    _r2_client = boto3.client(
        "s3",
        endpoint_url=_r2_endpoint(),
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="auto",  # R2 ignores region but boto3 demands one
        config=Config(signature_version="s3v4", retries={"max_attempts": 3}),
    )
    _r2_bucket = bucket
    logger.info(f"[storage:r2] ready (bucket={bucket})")


def _r2_put(path: str, data: bytes, content_type: str) -> dict:
    if _r2_client is None:
        _r2_init()
    _r2_client.put_object(
        Bucket=_r2_bucket,
        Key=path,
        Body=data,
        ContentType=content_type or "application/octet-stream",
    )
    return {"path": path, "size": len(data)}


def _r2_get(path: str) -> tuple[bytes, str]:
    if _r2_client is None:
        _r2_init()
    from botocore.exceptions import ClientError
    try:
        resp = _r2_client.get_object(Bucket=_r2_bucket, Key=path)
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code in ("NoSuchKey", "404"):
            raise FileNotFoundError(f"Storage object not found: {path}")
        raise
    return resp["Body"].read(), resp.get("ContentType", "application/octet-stream")


def _r2_delete(path: str) -> bool:
    if _r2_client is None:
        _r2_init()
    _r2_client.delete_object(Bucket=_r2_bucket, Key=path)
    return True


# ============================================================
# Public dispatch
# ============================================================
def init_storage() -> str:
    if BACKEND == "r2":
        _r2_init()
        return f"r2://{_r2_bucket}"
    _local_init()
    return str(STORAGE_ROOT)


def put_object(path: str, data: bytes, content_type: str) -> dict:
    if BACKEND == "r2":
        return _r2_put(path, data, content_type)
    return _local_put(path, data, content_type)


def get_object(path: str) -> tuple[bytes, str]:
    if BACKEND == "r2":
        return _r2_get(path)
    return _local_get(path)


def delete_object(path: str) -> bool:
    if BACKEND == "r2":
        return _r2_delete(path)
    return _local_delete(path)
