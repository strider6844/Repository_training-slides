"""Fetch OpenGraph / Twitter preview for a web link."""
import re
import requests
from html import unescape
from urllib.parse import urljoin, urlparse


def _meta(html: str, prop_name: str, value: str) -> str | None:
    # Match <meta property/name="..." content="...">
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
    """Return {title, description, image} (any/all may be None)."""
    try:
        resp = requests.get(
            url,
            timeout=8,
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; TrainingSlides/1.0; +https://example.com)"
            },
            allow_redirects=True,
        )
        # Only parse if HTML
        ctype = resp.headers.get("Content-Type", "")
        if "text/html" not in ctype.lower():
            return {"title": url, "description": None, "image": None}
        html = resp.text[:200_000]  # cap

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
            image = urljoin(resp.url, image)

        # Fallback favicon
        if not image:
            parsed = urlparse(resp.url)
            image = f"{parsed.scheme}://{parsed.netloc}/favicon.ico"

        return {
            "title": (title or "")[:300],
            "description": (description or "")[:500] if description else None,
            "image": image,
        }
    except Exception:
        return {"title": url, "description": None, "image": None}
