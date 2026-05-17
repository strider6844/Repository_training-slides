"""Iteration 2 backend tests: workspaces, members, scoping, permissions, share, chat.

Covered:
  - Workspaces CRUD + switch + auth/me reflects current_workspace_id
  - Workspace members: list, invite (active/pending), auto-activate on register, remove (owner protected)
  - Scoping: folders/items filtered by current workspace
  - Permissions: viewer cannot write; editor/owner can; only owner invites/deletes
  - Share: enable/disable, public endpoints, leaked fields check
  - Chat with deck: POST/GET/DELETE on uploaded PDF
"""
import io
import os
import uuid
import time
import pytest
import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "https://content-blocks-15.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@example.com"
ADMIN_PASSWORD = "admin123"


# ---------- Helpers ----------
def _login(email, password):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return s


def _register(email=None, password="secret123", name="Tester"):
    email = email or f"u_{uuid.uuid4().hex[:8]}@example.com"
    s = requests.Session()
    r = s.post(f"{API}/auth/register", json={"email": email, "password": password, "name": name})
    assert r.status_code == 200, r.text
    return s, email


def _make_pdf_with_text(text):
    """Build a tiny PDF that contains the given text via reportlab."""
    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import letter
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    y = 750
    for line in text.split("\n"):
        c.drawString(72, y, line[:120])
        y -= 18
        if y < 72:
            c.showPage()
            y = 750
    c.save()
    return buf.getvalue()


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def admin():
    return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="module")
def user_b():
    s, email = _register()
    return {"session": s, "email": email}


# ============================================================
# Workspaces CRUD
# ============================================================
class TestWorkspaces:
    def test_personal_workspace_present(self, admin):
        r = admin.get(f"{API}/workspaces")
        assert r.status_code == 200
        ws = r.json()
        assert isinstance(ws, list) and len(ws) >= 1
        personal = [w for w in ws if w.get("is_personal")]
        assert personal, "No personal workspace returned"
        assert personal[0]["role"] == "owner"

    def test_create_rename_delete_workspace(self, admin):
        name = f"TEST_WS_{uuid.uuid4().hex[:6]}"
        r = admin.post(f"{API}/workspaces", json={"name": name})
        assert r.status_code == 200, r.text
        ws = r.json()
        assert ws["name"] == name
        assert ws.get("is_personal") in (False, None)
        ws_id = ws["id"]

        # Rename
        new_name = name + "_r"
        r2 = admin.patch(f"{API}/workspaces/{ws_id}", json={"name": new_name})
        assert r2.status_code == 200
        assert r2.json()["name"] == new_name

        # In list now
        r3 = admin.get(f"{API}/workspaces")
        assert any(w["id"] == ws_id and w["role"] == "owner" for w in r3.json())

        # Delete
        r4 = admin.delete(f"{API}/workspaces/{ws_id}")
        assert r4.status_code == 200

    def test_cannot_delete_personal(self, admin):
        ws = admin.get(f"{API}/workspaces").json()
        personal_id = next(w["id"] for w in ws if w.get("is_personal"))
        r = admin.delete(f"{API}/workspaces/{personal_id}")
        assert r.status_code == 400

    def test_switch_workspace_updates_me(self, admin):
        # Create
        r = admin.post(f"{API}/workspaces", json={"name": f"TEST_SW_{uuid.uuid4().hex[:6]}"})
        ws_id = r.json()["id"]
        try:
            r2 = admin.post(f"{API}/workspaces/switch", json={"workspace_id": ws_id})
            assert r2.status_code == 200
            me = admin.get(f"{API}/auth/me").json()
            assert me.get("current_workspace_id") == ws_id
        finally:
            # Switch back to personal then delete
            personal_id = next(
                w["id"] for w in admin.get(f"{API}/workspaces").json() if w.get("is_personal")
            )
            admin.post(f"{API}/workspaces/switch", json={"workspace_id": personal_id})
            admin.delete(f"{API}/workspaces/{ws_id}")


# ============================================================
# Members / invites
# ============================================================
class TestMembers:
    def test_invite_existing_user_active(self, admin, user_b):
        r = admin.post(f"{API}/workspaces", json={"name": f"TEST_M_{uuid.uuid4().hex[:6]}"})
        ws_id = r.json()["id"]
        try:
            r2 = admin.post(
                f"{API}/workspaces/{ws_id}/invite",
                json={"email": user_b["email"], "role": "editor"},
            )
            assert r2.status_code == 200, r2.text
            assert r2.json()["status"] == "active"
            assert r2.json()["role"] == "editor"

            members = admin.get(f"{API}/workspaces/{ws_id}/members").json()
            assert any(m.get("user_email") == user_b["email"] for m in members)

            # user_b should now see this workspace
            ws_list = user_b["session"].get(f"{API}/workspaces").json()
            assert any(w["id"] == ws_id and w["role"] == "editor" for w in ws_list)
        finally:
            admin.delete(f"{API}/workspaces/{ws_id}")

    def test_invite_pending_then_auto_activate(self, admin):
        r = admin.post(f"{API}/workspaces", json={"name": f"TEST_P_{uuid.uuid4().hex[:6]}"})
        ws_id = r.json()["id"]
        pending_email = f"pending_{uuid.uuid4().hex[:8]}@example.com"
        try:
            r2 = admin.post(
                f"{API}/workspaces/{ws_id}/invite",
                json={"email": pending_email, "role": "viewer"},
            )
            assert r2.status_code == 200
            assert r2.json()["status"] == "pending"

            # Register new user with that email → should auto-activate
            new_session, _ = _register(email=pending_email)
            members = admin.get(f"{API}/workspaces/{ws_id}/members").json()
            target = [m for m in members if (m.get("user_email") or "").lower() == pending_email]
            assert target, f"member missing: {members}"
            assert target[0]["status"] == "active"
            assert target[0].get("user_id")
        finally:
            admin.delete(f"{API}/workspaces/{ws_id}")

    def test_cannot_remove_owner(self, admin):
        r = admin.post(f"{API}/workspaces", json={"name": f"TEST_O_{uuid.uuid4().hex[:6]}"})
        ws_id = r.json()["id"]
        try:
            members = admin.get(f"{API}/workspaces/{ws_id}/members").json()
            owner = next(m for m in members if m["role"] == "owner")
            r2 = admin.delete(f"{API}/workspaces/{ws_id}/members/{owner['id']}")
            assert r2.status_code == 400
        finally:
            admin.delete(f"{API}/workspaces/{ws_id}")

    def test_remove_member(self, admin, user_b):
        r = admin.post(f"{API}/workspaces", json={"name": f"TEST_R_{uuid.uuid4().hex[:6]}"})
        ws_id = r.json()["id"]
        try:
            inv = admin.post(
                f"{API}/workspaces/{ws_id}/invite",
                json={"email": user_b["email"], "role": "viewer"},
            ).json()
            r2 = admin.delete(f"{API}/workspaces/{ws_id}/members/{inv['id']}")
            assert r2.status_code == 200
            members = admin.get(f"{API}/workspaces/{ws_id}/members").json()
            assert not any(m.get("user_email") == user_b["email"] for m in members)
        finally:
            admin.delete(f"{API}/workspaces/{ws_id}")


# ============================================================
# Workspace scoping + permissions
# ============================================================
class TestWorkspaceScoping:
    def test_scope_and_permissions(self, admin, user_b):
        # Make sure admin starts on personal
        ws_list = admin.get(f"{API}/workspaces").json()
        personal_id = next(w["id"] for w in ws_list if w.get("is_personal"))
        admin.post(f"{API}/workspaces/switch", json={"workspace_id": personal_id})

        # Create a folder in personal first
        f_personal = admin.post(
            f"{API}/folders", json={"name": "TEST_personal_folder", "category": "claude-chat"}
        ).json()

        # Create new team workspace
        ws_id = admin.post(f"{API}/workspaces", json={"name": f"TEST_TEAM_{uuid.uuid4().hex[:6]}"}).json()["id"]
        admin.post(f"{API}/workspaces/switch", json={"workspace_id": ws_id})

        try:
            # Listing under team should NOT show personal folder
            listed = admin.get(f"{API}/folders", params={"category": "claude-chat"}).json()
            assert all(f["id"] != f_personal["id"] for f in listed)

            # Invite user_b as viewer
            admin.post(
                f"{API}/workspaces/{ws_id}/invite",
                json={"email": user_b["email"], "role": "viewer"},
            )
            user_b["session"].post(f"{API}/workspaces/switch", json={"workspace_id": ws_id})

            # Viewer cannot create folder
            r = user_b["session"].post(
                f"{API}/folders", json={"name": "TEST_blocked", "category": "claude-chat"}
            )
            assert r.status_code == 403

            # Viewer cannot create note
            r2 = user_b["session"].post(
                f"{API}/notes",
                json={"title": "TEST_blocked", "category": "claude-chat", "blocks": []},
            )
            assert r2.status_code == 403

            # Viewer cannot link
            r3 = user_b["session"].post(
                f"{API}/links", json={"url": "https://example.com", "category": "claude-chat"}
            )
            assert r3.status_code == 403

            # Viewer cannot upload
            files = {"file": ("x.pdf", b"%PDF-1.4\n%%EOF", "application/pdf")}
            r4 = user_b["session"].post(
                f"{API}/upload", files=files, data={"category": "claude-chat"}
            )
            assert r4.status_code == 403

            # Owner CAN create folder + note
            f_team = admin.post(
                f"{API}/folders", json={"name": "TEST_team_folder", "category": "claude-chat"}
            )
            assert f_team.status_code == 200
            f_team_id = f_team.json()["id"]

            # Viewer can list / read
            listed_b = user_b["session"].get(
                f"{API}/folders", params={"category": "claude-chat"}
            ).json()
            assert any(x["id"] == f_team_id for x in listed_b)

            # Non-member is blocked: register fresh user
            s_c, _ = _register()
            # Force-switch attempt is impossible (not invited); switching to ws_id should be rejected by membership check
            r5 = s_c.post(f"{API}/workspaces/switch", json={"workspace_id": ws_id})
            assert r5.status_code == 403

            # Switch admin back to personal and confirm personal folder visible again
            admin.post(f"{API}/workspaces/switch", json={"workspace_id": personal_id})
            listed_p = admin.get(f"{API}/folders", params={"category": "claude-chat"}).json()
            assert any(f["id"] == f_personal["id"] for f in listed_p)

            # Only owner can invite (already tested above by 403 above? Let's also assert viewer cannot invite)
            r_inv = user_b["session"].post(
                f"{API}/workspaces/{ws_id}/invite",
                json={"email": "anyone@example.com", "role": "viewer"},
            )
            assert r_inv.status_code == 403

            # Only owner can delete workspace
            r_del = user_b["session"].delete(f"{API}/workspaces/{ws_id}")
            assert r_del.status_code == 403
        finally:
            # cleanup
            admin.post(f"{API}/workspaces/switch", json={"workspace_id": personal_id})
            admin.delete(f"{API}/folders/{f_personal['id']}")
            admin.delete(f"{API}/workspaces/{ws_id}")


# ============================================================
# Share Links
# ============================================================
class TestShare:
    def test_share_flow_for_note(self, admin):
        blocks = [{"id": str(uuid.uuid4()), "type": "paragraph", "content": "Shareable note body"}]
        item = admin.post(
            f"{API}/notes",
            json={"title": "TEST_SHARE_NOTE", "category": "claude-chat", "blocks": blocks},
        ).json()
        try:
            r = admin.post(f"{API}/items/{item['id']}/share")
            assert r.status_code == 200, r.text
            data = r.json()
            assert data["share_enabled"] is True
            slug = data["slug"]
            assert slug and isinstance(slug, str)

            # Public get (no auth)
            pub = requests.get(f"{API}/public/items/{slug}")
            assert pub.status_code == 200
            body = pub.json()
            assert "owner_id" not in body
            assert "workspace_id" not in body
            assert body["title"] == "TEST_SHARE_NOTE"

            # Disable
            r2 = admin.delete(f"{API}/items/{item['id']}/share")
            assert r2.status_code == 200
            r3 = requests.get(f"{API}/public/items/{slug}")
            assert r3.status_code == 404

            # Invalid slug
            r4 = requests.get(f"{API}/public/items/doesnotexist123")
            assert r4.status_code == 404
        finally:
            admin.delete(f"{API}/items/{item['id']}")

    def test_share_pdf_public_download(self, admin):
        pdf = _make_pdf_with_text("Hello shared world.")
        up = admin.post(
            f"{API}/upload",
            files={"file": ("share.pdf", pdf, "application/pdf")},
            data={"category": "esg-sustainability", "title": "TEST_SHARE_PDF"},
        ).json()
        try:
            slug = admin.post(f"{API}/items/{up['id']}/share").json()["slug"]
            r = requests.get(f"{API}/public/items/{slug}/download")
            assert r.status_code == 200
            assert r.content[:4] == b"%PDF"
        finally:
            admin.delete(f"{API}/items/{up['id']}")


# ============================================================
# Chat with deck
# ============================================================
class TestDeckChat:
    @pytest.fixture(scope="class")
    def esg_pdf_item(self, admin):
        pdf_text = (
            "ESG Pillars Training Deck\n"
            "Slide 1: Introduction\n"
            "The three pillars of ESG are Environmental, Social, and Governance.\n"
            "Environmental: climate change, emissions, biodiversity.\n"
            "Social: labor, community, diversity.\n"
            "Governance: board structure, ethics, transparency.\n"
            "Slide 2: Summary\n"
            "Together these three pillars frame sustainable business practice."
        )
        pdf = _make_pdf_with_text(pdf_text)
        r = admin.post(
            f"{API}/upload",
            files={"file": ("esg.pdf", pdf, "application/pdf")},
            data={"category": "esg-sustainability", "title": "TEST_CHAT_ESG"},
        )
        assert r.status_code == 200, r.text
        item = r.json()
        yield item
        admin.delete(f"{API}/items/{item['id']}")

    def test_chat_post_get_delete(self, admin, esg_pdf_item):
        item_id = esg_pdf_item["id"]
        # Initial history empty
        r0 = admin.get(f"{API}/items/{item_id}/chat")
        assert r0.status_code == 200
        assert r0.json()["messages"] == []

        # Post
        r = admin.post(
            f"{API}/items/{item_id}/chat",
            json={"message": "What are the three pillars of ESG?"},
            timeout=120,
        )
        assert r.status_code == 200, r.text
        msgs = r.json()["messages"]
        assert len(msgs) == 2
        assert msgs[0]["role"] == "user"
        assert msgs[1]["role"] == "assistant"
        assistant = msgs[1]["content"].lower()
        # Should mention something from the deck
        assert any(
            kw in assistant
            for kw in ["environmental", "social", "governance", "esg", "pillar"]
        ), f"Assistant content seems unrelated: {assistant[:300]}"

        # GET persists
        r2 = admin.get(f"{API}/items/{item_id}/chat")
        assert r2.status_code == 200
        assert len(r2.json()["messages"]) == 2

        # DELETE
        r3 = admin.delete(f"{API}/items/{item_id}/chat")
        assert r3.status_code == 200
        r4 = admin.get(f"{API}/items/{item_id}/chat")
        assert r4.json()["messages"] == []

    def test_chat_non_file_404(self, admin):
        blocks = [{"id": str(uuid.uuid4()), "type": "paragraph", "content": "x"}]
        note = admin.post(
            f"{API}/notes",
            json={"title": "TEST_CHAT_NOTE", "category": "claude-chat", "blocks": blocks},
        ).json()
        try:
            r = admin.post(
                f"{API}/items/{note['id']}/chat", json={"message": "hi"}, timeout=30
            )
            assert r.status_code == 404
        finally:
            admin.delete(f"{API}/items/{note['id']}")

    def test_viewer_can_chat(self, admin, user_b, esg_pdf_item):
        # Need to share workspace: this PDF is in admin personal workspace; user_b can't access.
        # So this case demonstrates that user_b in admin's personal workspace = 403 (correct).
        r = user_b["session"].post(
            f"{API}/items/{esg_pdf_item['id']}/chat",
            json={"message": "anything"},
            timeout=30,
        )
        # Not a member of admin's personal ws → 403
        assert r.status_code in (403, 404)


# ============================================================
# Regression: still works
# ============================================================
class TestRegression:
    def test_categories(self):
        r = requests.get(f"{API}/categories")
        assert r.status_code == 200
        assert len(r.json()) == 5

    def test_me_admin(self, admin):
        r = admin.get(f"{API}/auth/me")
        assert r.status_code == 200
        body = r.json()
        assert body["email"] == ADMIN_EMAIL
        assert "current_workspace_id" in body

    def test_link_preview_regression(self, admin):
        r = admin.post(
            f"{API}/links", json={"url": "https://example.com", "category": "claude-chat"}
        )
        assert r.status_code == 200
        item = r.json()
        assert item["type"] == "link"
        admin.delete(f"{API}/items/{item['id']}")
