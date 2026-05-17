"""End-to-end backend tests for Training Slides app.

Tests covered:
  - Health
  - Auth (register, login, me, refresh, logout, unauthorized)
  - Categories
  - Folders CRUD + nesting + cascade delete + per-user isolation
  - Notes create + items list/get + patch
  - Links auto-preview
  - Upload (PDF/DOCX) + download
  - Search
  - Allowed extensions validation
"""
import io
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://content-blocks-15.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@example.com"
ADMIN_PASSWORD = "admin123"

# A tiny valid PDF (1 page, empty)
MINIMAL_PDF = (
    b"%PDF-1.4\n"
    b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n"
    b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n"
    b"xref\n0 4\n0000000000 65535 f \n0000000010 00000 n \n0000000054 00000 n \n0000000100 00000 n \n"
    b"trailer<</Size 4/Root 1 0 R>>\nstartxref\n160\n%%EOF\n"
)

# DOCX is just a ZIP file; create a minimal zip
import zipfile
def _make_docx_bytes():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("[Content_Types].xml", "<?xml version='1.0'?><Types/>")
    return buf.getvalue()


# ====== Fixtures ======
@pytest.fixture(scope="session")
def admin_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="session")
def second_user_session():
    """Create a separate user to test isolation."""
    s = requests.Session()
    email = f"test_{uuid.uuid4().hex[:8]}@example.com"
    r = s.post(f"{API}/auth/register", json={"email": email, "password": "secret123", "name": "Tester"})
    assert r.status_code == 200, f"Register failed: {r.status_code} {r.text}"
    return s


# ====== Health ======
class TestHealth:
    def test_root(self):
        r = requests.get(f"{API}/")
        assert r.status_code == 200
        assert r.json().get("status") == "ok"


# ====== Auth ======
class TestAuth:
    def test_login_admin(self):
        s = requests.Session()
        r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert r.status_code == 200
        body = r.json()
        assert body["email"] == ADMIN_EMAIL
        assert body["role"] == "admin"
        # Cookie set?
        assert "access_token" in s.cookies

    def test_login_invalid(self):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": "wrong"})
        assert r.status_code == 401

    def test_me_unauthenticated(self):
        r = requests.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_me_authenticated(self, admin_session):
        r = admin_session.get(f"{API}/auth/me")
        assert r.status_code == 200
        assert r.json()["email"] == ADMIN_EMAIL

    def test_refresh(self, admin_session):
        r = admin_session.post(f"{API}/auth/refresh")
        assert r.status_code == 200

    def test_register_duplicate(self, admin_session):
        r = requests.post(f"{API}/auth/register", json={"email": ADMIN_EMAIL, "password": "anything", "name": "x"})
        assert r.status_code == 400

    def test_register_and_login(self):
        s = requests.Session()
        email = f"reg_{uuid.uuid4().hex[:8]}@example.com"
        r = s.post(f"{API}/auth/register", json={"email": email, "password": "pw123456", "name": "Reggie"})
        assert r.status_code == 200
        # Reuse cookie - call me
        r2 = s.get(f"{API}/auth/me")
        assert r2.status_code == 200
        assert r2.json()["email"] == email

    def test_logout(self):
        s = requests.Session()
        s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        r = s.post(f"{API}/auth/logout")
        assert r.status_code == 200
        # After logout, /me should be 401
        s.cookies.clear()
        r2 = s.get(f"{API}/auth/me")
        assert r2.status_code == 401


# ====== Categories ======
class TestCategories:
    def test_categories_list(self):
        r = requests.get(f"{API}/categories")
        assert r.status_code == 200
        cats = r.json()
        ids = {c["id"] for c in cats}
        assert ids == {"finance-accounting", "esg-sustainability", "claude-chat", "claude-cowork", "claude-code"}


# ====== Folders ======
class TestFolders:
    def test_folder_crud_and_nesting(self, admin_session):
        # Create root
        r = admin_session.post(f"{API}/folders", json={"name": "TEST_Root", "category": "finance-accounting"})
        assert r.status_code == 200, r.text
        root = r.json()
        # Create child
        r2 = admin_session.post(f"{API}/folders", json={"name": "TEST_Child", "category": "finance-accounting", "parent_id": root["id"]})
        assert r2.status_code == 200
        child = r2.json()
        assert child["parent_id"] == root["id"]
        # List - both should appear
        r3 = admin_session.get(f"{API}/folders", params={"category": "finance-accounting"})
        assert r3.status_code == 200
        ids = [f["id"] for f in r3.json()]
        assert root["id"] in ids and child["id"] in ids
        # Update child name
        r4 = admin_session.patch(f"{API}/folders/{child['id']}", json={"name": "TEST_Child_renamed"})
        assert r4.status_code == 200
        assert r4.json()["name"] == "TEST_Child_renamed"
        # Delete root (cascades)
        r5 = admin_session.delete(f"{API}/folders/{root['id']}")
        assert r5.status_code == 200
        deleted_ids = set(r5.json()["deleted"])
        assert root["id"] in deleted_ids and child["id"] in deleted_ids

    def test_folder_invalid_category(self, admin_session):
        r = admin_session.post(f"{API}/folders", json={"name": "TEST_Bad", "category": "nope"})
        assert r.status_code == 400

    def test_folder_unauthorized(self):
        r = requests.get(f"{API}/folders", params={"category": "finance-accounting"})
        assert r.status_code == 401

    def test_folder_isolation(self, admin_session, second_user_session):
        # User1 creates folder
        r = admin_session.post(f"{API}/folders", json={"name": "TEST_Private", "category": "claude-chat"})
        assert r.status_code == 200
        fid = r.json()["id"]
        # User2 lists claude-chat - should not see user1's folder
        r2 = second_user_session.get(f"{API}/folders", params={"category": "claude-chat"})
        assert r2.status_code == 200
        assert fid not in [f["id"] for f in r2.json()]
        # User2 cannot delete user1 folder (404 or 403 acceptable; workspace membership rejects with 403)
        r3 = second_user_session.delete(f"{API}/folders/{fid}")
        assert r3.status_code in (403, 404)
        # cleanup
        admin_session.delete(f"{API}/folders/{fid}")


# ====== Notes + Items ======
class TestNotesItems:
    def test_create_note_and_update(self, admin_session):
        blocks = [
            {"id": str(uuid.uuid4()), "type": "h1", "content": "Heading One"},
            {"id": str(uuid.uuid4()), "type": "paragraph", "content": "Hello unique_token_xyz"},
        ]
        r = admin_session.post(f"{API}/notes", json={"title": "TEST_Note", "category": "esg-sustainability", "blocks": blocks})
        assert r.status_code == 200, r.text
        note = r.json()
        assert note["type"] == "note"
        assert note["search_text"]
        # GET single
        r2 = admin_session.get(f"{API}/items/{note['id']}")
        assert r2.status_code == 200
        assert r2.json()["title"] == "TEST_Note"
        # PATCH title and blocks
        new_blocks = blocks + [{"id": str(uuid.uuid4()), "type": "todo", "content": "remember_search_term", "checked": False}]
        r3 = admin_session.patch(f"{API}/items/{note['id']}", json={"title": "TEST_Note_Renamed", "blocks": new_blocks})
        assert r3.status_code == 200
        assert r3.json()["title"] == "TEST_Note_Renamed"
        assert "remember_search_term" in r3.json()["search_text"]
        # LIST items
        r4 = admin_session.get(f"{API}/items", params={"category": "esg-sustainability"})
        assert r4.status_code == 200
        assert any(i["id"] == note["id"] for i in r4.json())
        # Soft delete
        r5 = admin_session.delete(f"{API}/items/{note['id']}")
        assert r5.status_code == 200
        # Verify gone
        r6 = admin_session.get(f"{API}/items/{note['id']}")
        assert r6.status_code == 404


# ====== Links + preview ======
class TestLinks:
    def test_link_preview_example(self, admin_session):
        r = admin_session.post(f"{API}/links", json={"url": "https://example.com", "category": "claude-chat"})
        assert r.status_code == 200, r.text
        item = r.json()
        assert item["type"] == "link"
        assert item["url"] == "https://example.com"
        # Title should come from preview ("Example Domain")
        assert item["title"]
        # cleanup
        admin_session.delete(f"{API}/items/{item['id']}")

    def test_link_preview_wikipedia(self, admin_session):
        r = admin_session.post(f"{API}/links", json={"url": "https://en.wikipedia.org/wiki/Sustainability", "category": "esg-sustainability"})
        assert r.status_code == 200, r.text
        item = r.json()
        # Wikipedia should have og: title/desc
        assert item.get("link_title") or item["title"]
        admin_session.delete(f"{API}/items/{item['id']}")


# ====== Upload + Download ======
class TestUploadDownload:
    def test_upload_pdf_and_download(self, admin_session):
        files = {"file": ("test.pdf", MINIMAL_PDF, "application/pdf")}
        data = {"category": "finance-accounting", "title": "TEST_PDF"}
        r = admin_session.post(f"{API}/upload", files=files, data=data)
        assert r.status_code == 200, r.text
        item = r.json()
        assert item["type"] == "file"
        assert item["ext"] == "pdf"
        assert item["storage_path"]
        assert item["size"] > 0
        # Download
        r2 = admin_session.get(f"{API}/files/{item['id']}/download")
        assert r2.status_code == 200
        assert r2.headers.get("content-type", "").startswith("application/pdf")
        assert r2.content[:4] == b"%PDF"
        admin_session.delete(f"{API}/items/{item['id']}")

    def test_upload_docx(self, admin_session):
        files = {"file": ("test.docx", _make_docx_bytes(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
        data = {"category": "claude-cowork"}
        r = admin_session.post(f"{API}/upload", files=files, data=data)
        assert r.status_code == 200, r.text
        item = r.json()
        assert item["ext"] == "docx"
        admin_session.delete(f"{API}/items/{item['id']}")

    def test_upload_rejects_txt(self, admin_session):
        files = {"file": ("test.txt", b"hello", "text/plain")}
        data = {"category": "claude-code"}
        r = admin_session.post(f"{API}/upload", files=files, data=data)
        assert r.status_code == 400

    def test_download_unauthenticated(self, admin_session):
        # Upload first
        files = {"file": ("test.pdf", MINIMAL_PDF, "application/pdf")}
        r = admin_session.post(f"{API}/upload", files=files, data={"category": "finance-accounting"})
        item = r.json()
        # Try download with no cookies
        r2 = requests.get(f"{API}/files/{item['id']}/download")
        assert r2.status_code == 401
        admin_session.delete(f"{API}/items/{item['id']}")


# ====== Search ======
class TestSearch:
    def test_search_unique_term(self, admin_session):
        # Create a note with very unique term
        token = f"zztoken{uuid.uuid4().hex[:6]}"
        blocks = [{"id": str(uuid.uuid4()), "type": "paragraph", "content": token}]
        r = admin_session.post(f"{API}/notes", json={"title": f"TEST_{token}", "category": "claude-code", "blocks": blocks})
        assert r.status_code == 200
        item = r.json()
        # Search
        r2 = admin_session.get(f"{API}/search", params={"q": token})
        assert r2.status_code == 200
        ids = [i["id"] for i in r2.json()["items"]]
        assert item["id"] in ids
        # Cleanup
        admin_session.delete(f"{API}/items/{item['id']}")

    def test_search_unauthorized(self):
        r = requests.get(f"{API}/search", params={"q": "any"})
        assert r.status_code == 401


# ====== Unauthorized endpoint guards ======
class TestAuthGuards:
    @pytest.mark.parametrize("path", [
        "/folders?category=claude-chat",
        "/items",
        "/notes",
        "/links",
        "/upload",
        "/search?q=test",
    ])
    def test_protected_endpoints_require_auth(self, path):
        method = "GET" if path.startswith(("/folders", "/items", "/search")) else "POST"
        r = requests.request(method, f"{API}{path}", json={})
        assert r.status_code == 401, f"Expected 401 for {method} {path}, got {r.status_code}"
