"""Fetch OpenGraph / Twitter preview for a web link."""
import ipaddress
import re
import socket
import requests
from html import unescape
from urllib.parse import urljoin, urlparse


ALLOWED_SCHEMES = {"http", "https"}
MAX_RESPONSE_BYTES = 2 * 1024 * 1024  # 2 MB cap on download


class UnsafeURLError(ValueError):
    """Raised when a URL points to a disallowed scheme or non-public address."""


def _resolve_public_ip(hostname: str) -> str:
    """Resolve hostname and require the IP to be globally routable.

    Blocks loopback, private, link-local, multicast, reserved, and unspecified ranges
    to prevent SSRF against cloud metadata services, internal networks, and localhost.
    """
    try:
        infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror as e:
        raise UnsafeURLError(f"DNS lookup failed for {hostname}: {e}")
    for info in infos:
        addr = info[4][0]
        ip = ipaddress.ip_address(addr)
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        ):
            raise UnsafeURLError(f"Host {hostname} resolves to non-public address {addr}")
    return infos[0][4][0]


def _assert_safe_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in ALLOWED_SCHEMES:
        raise UnsafeURLError(f"Scheme '{parsed.scheme}' not allowed")
    if not parsed.hostname:
        raise UnsafeURLError("URL has no host")
    _resolve_public_ip(parsed.hostname)


def _meta(html: str, prop_name: str, value: str) -> str | None:
    pattern = rf'<meta[^>]+(?:{prop_name})\s*=\s*["\']{re.escape(value)}["\'][^>]*>'
    m = re.search(pattern, html, re.IGNORECASE)
    if not m:
        return None
    tag = m.group(0)
    content_match = re.search(r'content\s*=\s*["\']([^"\']*)["\']', tag, re.IGNORECASE)
    if not content_match:
        return None
    return unescape(content_match.group(1)).strip()


def _title(html: str) -> str | None:
    m = re.search(r"<title[^>]*>([^<]+)</title>", html, re.IGNORECASE | re.DOTALL)
    return unescape(m.group(1)).strip() if m else None


def fetch_link_preview(url: str) -> dict:
    """Return {title, description, image} (any/all may be None).

    Validates URL is http(s) and resolves to a public IP before fetching, and
    re-validates after each redirect to defend against SSRF / DNS rebinding.
    """
    try:
        _assert_safe_url(url)

        # Follow redirects manually so we can re-check each hop's destination.
        session = requests.Session()
        current_url = url
        for _ in range(5):
            resp = session.get(
                current_url,
                timeout=8,
                headers={
                    "User-Agent": "Mozilla/5.0 (compatible; TrainingSlides/1.0; +https://example.com)"
                },
                allow_redirects=False,
                stream=True,
            )
            if resp.is_redirect or resp.is_permanent_redirect:
                next_url = resp.headers.get("Location")
                if not next_url:
                    break
                next_url = urljoin(current_url, next_url)
                _assert_safe_url(next_url)
                current_url = next_url
                resp.close()
                continue
            break
        else:
            return {"title": url, "description": None, "image": None}

        ctype = resp.headers.get("Content-Type", "")
        if "text/html" not in ctype.lower():
            resp.close()
            return {"title": url, "description": None, "image": None}

        # Cap bytes read to avoid pulling huge pages into memory.
        chunks = []
        read = 0
        for chunk in resp.iter_content(8192):
            chunks.append(chunk)
            read += len(chunk)
            if read >= MAX_RESPONSE_BYTES:
                break
        resp.close()
        html = b"".join(chunks).decode(resp.encoding or "utf-8", errors="replace")[:200_000]

        title = (
            _meta(html, "property", "og:title")
            or _meta(html, "name", "twitter:title")
            or _title(html)
            or url
        )
        description = (
            _meta(html, "property", "og:description")
            or _meta(html, "name", "twitter:description")
            or _meta(html, "name", "description")
        )
        image = (
            _meta(html, "property", "og:image")
            or _meta(html, "name", "twitter:image")
        )
        if image:
            image = urljoin(current_url, image)

        if not image:
            parsed = urlparse(current_url)
            image = f"{parsed.scheme}://{parsed.netloc}/favicon.ico"

        return {
            "title": (title or "")[:300],
            "description": (description or "")[:500] if description else None,
            "image": image,
        }
    except UnsafeURLError:
        return {"title": url, "description": None, "image": None}
    except Exception:
        return {"title": url, "description": None, "image": None}
