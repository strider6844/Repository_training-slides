from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import io
import uuid
import secrets
import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, UploadFile, File, Form, Depends, Query
from fastapi.responses import StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr

from auth import (
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    set_auth_cookies,
    clear_auth_cookies,
    decode_token,
    get_current_user as auth_get_current_user,
)
from storage import init_storage, put_object, get_object
from link_preview import fetch_link_preview
from extract_text import extract_text
from anthropic import AsyncAnthropic

# Model used for both AI summary and deck chat. Bump in one place.
CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-5-20250929")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

# MongoDB
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

APP_NAME = os.environ.get("APP_NAME", "training-slides")

CATEGORIES = [
    {"id": "finance-accounting", "name": "Finance and Accounting", "group": "main", "color": "emerald"},
    {"id": "esg-sustainability", "name": "ESG and Sustainability", "group": "main", "color": "orange"},
    {"id": "claude-chat", "name": "Claude · Chat", "group": "claude", "color": "blue"},
    {"id": "claude-cowork", "name": "Claude · Co-work", "group": "claude", "color": "blue"},
    {"id": "claude-code", "name": "Claude · Code", "group": "claude", "color": "blue"},
]
CATEGORY_IDS = {c["id"] for c in CATEGORIES}

ALLOWED_EXTENSIONS = {
    "pdf": "application/pdf",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "ppt": "application/vnd.ms-powerpoint",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}

ROLE_RANK = {"viewer": 0, "editor": 1, "owner": 2}

app = FastAPI()
api_router = APIRouter(prefix="/api")


# ============== Models ==============
class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str = Field(min_length=1)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class FolderCreate(BaseModel):
    name: str
    category: str
    parent_id: Optional[str] = None


class FolderUpdate(BaseModel):
    name: Optional[str] = None
    parent_id: Optional[str] = None


class NoteCreate(BaseModel):
    title: str
    category: str
    folder_id: Optional[str] = None
    blocks: List[dict] = Field(default_factory=list)


class LinkCreate(BaseModel):
    url: str
    category: str
    folder_id: Optional[str] = None
    title: Optional[str] = None


class WorkspaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class WorkspaceUpdate(BaseModel):
    name: Optional[str] = None


class InviteRequest(BaseModel):
    email: EmailStr
    role: str = "editor"  # editor | viewer


class SwitchWorkspaceRequest(BaseModel):
    workspace_id: str


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)


# ============== Auth helpers ==============
async def get_current_user(request: Request):
    return await auth_get_current_user(request, db)


def _ensure_category(category: str):
    if category not in CATEGORY_IDS:
        raise HTTPException(status_code=400, detail="Unknown category")


# ============== Workspace helpers ==============
async def ensure_personal_workspace(user_id: str, user_email: str | None = None) -> str:
    ws = await db.workspaces.find_one({"owner_id": user_id, "is_personal": True})
    if ws:
        return ws["id"]
    ws_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    await db.workspaces.insert_one({
        "id": ws_id,
        "name": "Personal",
        "owner_id": user_id,
        "is_personal": True,
        "created_at": now,
    })
    await db.workspace_members.insert_one({
        "id": str(uuid.uuid4()),
        "workspace_id": ws_id,
        "user_id": user_id,
        "email": user_email,
        "role": "owner",
        "status": "active",
        "joined_at": now,
    })
    return ws_id


async def get_current_workspace_id(user: dict) -> str:
    ws_id = user.get("current_workspace_id")
    if ws_id:
        member = await db.workspace_members.find_one(
            {"workspace_id": ws_id, "user_id": user["id"], "status": "active"}
        )
        if member:
            return ws_id
    return await ensure_personal_workspace(user["id"], user.get("email"))


async def get_membership(workspace_id: str, user_id: str) -> dict | None:
    return await db.workspace_members.find_one(
        {"workspace_id": workspace_id, "user_id": user_id, "status": "active"},
        {"_id": 0},
    )


async def assert_workspace_role(workspace_id: str, user_id: str, min_role: str = "viewer") -> dict:
    member = await get_membership(workspace_id, user_id)
    if not member:
        raise HTTPException(status_code=403, detail="Not a member of this workspace")
    if ROLE_RANK.get(member["role"], 0) < ROLE_RANK.get(min_role, 0):
        raise HTTPException(status_code=403, detail=f"Requires {min_role} role")
    return member


async def activate_pending_invites(user_id: str, email: str):
    await db.workspace_members.update_many(
        {"email": email.lower(), "status": "pending"},
        {"$set": {
            "user_id": user_id,
            "status": "active",
            "joined_at": datetime.now(timezone.utc).isoformat(),
        }},
    )


# ============== Startup ==============
@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.folders.create_index([("workspace_id", 1), ("category", 1)])
    await db.folders.create_index("id", unique=True)
    await db.items.create_index([("workspace_id", 1), ("category", 1), ("folder_id", 1)])
    await db.items.create_index("id", unique=True)
    await db.items.create_index(
        "share_slug", unique=True, partialFilterExpression={"share_slug": {"$exists": True}}
    )
    await db.workspaces.create_index("id", unique=True)
    await db.workspace_members.create_index([("workspace_id", 1), ("user_id", 1)])
    await db.workspace_members.create_index([("email", 1), ("status", 1)])
    await db.deck_chats.create_index([("item_id", 1), ("user_id", 1)], unique=True)
    try:
        await db.items.create_index(
            [("title", "text"), ("search_text", "text"), ("link_description", "text")]
        )
    except Exception as e:
        logger.warning(f"Text index: {e}")

    try:
        init_storage()
        logger.info("Storage initialized")
    except Exception as e:
        logger.error(f"Storage init failed: {e}")

    # Seed admin: only if BOTH ADMIN_EMAIL and ADMIN_PASSWORD are explicitly set,
    # and only when no admin with that email exists yet. We never reset the password
    # on subsequent startups — that would be a permanent backdoor for anyone who
    # knows the env value.
    admin_email = os.environ.get("ADMIN_EMAIL")
    admin_password = os.environ.get("ADMIN_PASSWORD")
    if admin_email and admin_password:
        existing = await db.users.find_one({"email": admin_email})
        if existing is None:
            admin_id = str(uuid.uuid4())
            await db.users.insert_one({
                "id": admin_id,
                "email": admin_email,
                "password_hash": hash_password(admin_password),
                "name": "Admin",
                "role": "admin",
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            await ensure_personal_workspace(admin_id, admin_email)
            logger.info(f"Seeded admin: {admin_email}")
        else:
            logger.info(f"Admin {admin_email} already exists; not modifying password")
    else:
        logger.info("ADMIN_EMAIL / ADMIN_PASSWORD not set — skipping admin seed")

    # Migration: backfill workspace_id on legacy folders/items
    async for user in db.users.find({}, {"_id": 0, "id": 1, "email": 1}):
        ws_id = await ensure_personal_workspace(user["id"], user.get("email"))
        await db.folders.update_many(
            {"owner_id": user["id"], "workspace_id": {"$exists": False}},
            {"$set": {"workspace_id": ws_id}},
        )
        await db.items.update_many(
            {"owner_id": user["id"], "workspace_id": {"$exists": False}},
            {"$set": {"workspace_id": ws_id}},
        )


@app.on_event("shutdown")
async def shutdown():
    client.close()


# ============== Health ==============
@api_router.get("/")
async def root():
    return {"message": "Training Slides API", "status": "ok"}


# ============== Auth Endpoints ==============
def _user_public(user: dict) -> dict:
    return {
        "id": user["id"],
        "email": user["email"],
        "name": user["name"],
        "role": user.get("role", "user"),
        "current_workspace_id": user.get("current_workspace_id"),
    }


@api_router.post("/auth/register")
async def register(payload: RegisterRequest, response: Response):
    email = payload.email.lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = str(uuid.uuid4())
    await db.users.insert_one({
        "id": user_id,
        "email": email,
        "name": payload.name,
        "password_hash": hash_password(payload.password),
        "role": "user",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    ws_id = await ensure_personal_workspace(user_id, email)
    await db.users.update_one({"id": user_id}, {"$set": {"current_workspace_id": ws_id}})
    await activate_pending_invites(user_id, email)
    access = create_access_token(user_id, email)
    refresh = create_refresh_token(user_id)
    set_auth_cookies(response, access, refresh)
    return {"id": user_id, "email": email, "name": payload.name, "role": "user", "current_workspace_id": ws_id}


@api_router.post("/auth/login")
async def login(payload: LoginRequest, response: Response):
    email = payload.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    ws_id = await ensure_personal_workspace(user["id"], email)
    if not user.get("current_workspace_id"):
        await db.users.update_one({"id": user["id"]}, {"$set": {"current_workspace_id": ws_id}})
        user["current_workspace_id"] = ws_id
    await activate_pending_invites(user["id"], email)
    access = create_access_token(user["id"], email)
    refresh = create_refresh_token(user["id"])
    set_auth_cookies(response, access, refresh)
    return _user_public(user)


@api_router.post("/auth/logout")
async def logout(response: Response):
    clear_auth_cookies(response)
    return {"message": "Logged out"}


@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return _user_public(user)


@api_router.post("/auth/refresh")
async def refresh_token(request: Request, response: Response):
    rt = request.cookies.get("refresh_token")
    if not rt:
        raise HTTPException(status_code=401, detail="No refresh token")
    try:
        payload = decode_token(rt)
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        access = create_access_token(user["id"], user["email"])
        new_refresh = create_refresh_token(user["id"])
        set_auth_cookies(response, access, new_refresh)
        return {"message": "Refreshed"}
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid refresh token")


# ============== Workspaces ==============
@api_router.get("/workspaces")
async def list_workspaces(user: dict = Depends(get_current_user)):
    memberships = await db.workspace_members.find(
        {"user_id": user["id"], "status": "active"}, {"_id": 0}
    ).to_list(200)
    ws_ids = [m["workspace_id"] for m in memberships]
    wss = await db.workspaces.find({"id": {"$in": ws_ids}}, {"_id": 0}).to_list(200)
    role_by_ws = {m["workspace_id"]: m["role"] for m in memberships}
    out = []
    for w in wss:
        out.append({**w, "role": role_by_ws.get(w["id"], "viewer")})
    out.sort(key=lambda x: (not x.get("is_personal", False), x.get("name", "")))
    return out


@api_router.post("/workspaces")
async def create_workspace(payload: WorkspaceCreate, user: dict = Depends(get_current_user)):
    ws_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    await db.workspaces.insert_one({
        "id": ws_id,
        "name": payload.name.strip(),
        "owner_id": user["id"],
        "is_personal": False,
        "created_at": now,
    })
    await db.workspace_members.insert_one({
        "id": str(uuid.uuid4()),
        "workspace_id": ws_id,
        "user_id": user["id"],
        "email": user.get("email"),
        "role": "owner",
        "status": "active",
        "joined_at": now,
    })
    return {"id": ws_id, "name": payload.name.strip(), "owner_id": user["id"], "is_personal": False, "created_at": now, "role": "owner"}


@api_router.patch("/workspaces/{workspace_id}")
async def update_workspace(workspace_id: str, payload: WorkspaceUpdate, user: dict = Depends(get_current_user)):
    await assert_workspace_role(workspace_id, user["id"], "owner")
    update = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if not update:
        raise HTTPException(status_code=400, detail="Nothing to update")
    await db.workspaces.update_one({"id": workspace_id}, {"$set": update})
    ws = await db.workspaces.find_one({"id": workspace_id}, {"_id": 0})
    return ws


@api_router.delete("/workspaces/{workspace_id}")
async def delete_workspace(workspace_id: str, user: dict = Depends(get_current_user)):
    ws = await db.workspaces.find_one({"id": workspace_id})
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    if ws.get("is_personal"):
        raise HTTPException(status_code=400, detail="Cannot delete personal workspace")
    await assert_workspace_role(workspace_id, user["id"], "owner")
    # Soft-delete items, hard-delete folders/members
    await db.items.update_many({"workspace_id": workspace_id}, {"$set": {"is_deleted": True}})
    await db.folders.delete_many({"workspace_id": workspace_id})
    await db.workspace_members.delete_many({"workspace_id": workspace_id})
    await db.workspaces.delete_one({"id": workspace_id})
    # If users had this as current, reset to personal
    await db.users.update_many(
        {"current_workspace_id": workspace_id},
        {"$unset": {"current_workspace_id": ""}},
    )
    return {"deleted": workspace_id}


@api_router.post("/workspaces/switch")
async def switch_workspace(payload: SwitchWorkspaceRequest, user: dict = Depends(get_current_user)):
    await assert_workspace_role(payload.workspace_id, user["id"], "viewer")
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"current_workspace_id": payload.workspace_id}},
    )
    return {"current_workspace_id": payload.workspace_id}


@api_router.get("/workspaces/{workspace_id}/members")
async def list_members(workspace_id: str, user: dict = Depends(get_current_user)):
    await assert_workspace_role(workspace_id, user["id"], "viewer")
    members = await db.workspace_members.find(
        {"workspace_id": workspace_id}, {"_id": 0}
    ).to_list(200)
    user_ids = [m["user_id"] for m in members if m.get("user_id")]
    users = {
        u["id"]: u
        for u in await db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "name": 1, "email": 1}).to_list(200)
    }
    out = []
    for m in members:
        u = users.get(m.get("user_id"))
        out.append({
            **m,
            "name": u.get("name") if u else None,
            "user_email": u.get("email") if u else m.get("email"),
        })
    return out


@api_router.post("/workspaces/{workspace_id}/invite")
async def invite_member(workspace_id: str, payload: InviteRequest, user: dict = Depends(get_current_user)):
    await assert_workspace_role(workspace_id, user["id"], "owner")
    if payload.role not in ("editor", "viewer"):
        raise HTTPException(status_code=400, detail="Role must be editor or viewer")
    email = payload.email.lower()
    invited_user = await db.users.find_one({"email": email}, {"_id": 0})
    existing = None
    if invited_user:
        existing = await db.workspace_members.find_one(
            {"workspace_id": workspace_id, "user_id": invited_user["id"]}
        )
    else:
        existing = await db.workspace_members.find_one(
            {"workspace_id": workspace_id, "email": email, "user_id": None}
        )
    if existing:
        raise HTTPException(status_code=400, detail="Already a member or invited")
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "workspace_id": workspace_id,
        "user_id": invited_user["id"] if invited_user else None,
        "email": email,
        "role": payload.role,
        "status": "active" if invited_user else "pending",
        "invited_at": now,
        "joined_at": now if invited_user else None,
    }
    await db.workspace_members.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.delete("/workspaces/{workspace_id}/members/{member_id}")
async def remove_member(workspace_id: str, member_id: str, user: dict = Depends(get_current_user)):
    await assert_workspace_role(workspace_id, user["id"], "owner")
    member = await db.workspace_members.find_one({"id": member_id, "workspace_id": workspace_id})
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    if member.get("role") == "owner":
        raise HTTPException(status_code=400, detail="Cannot remove workspace owner")
    await db.workspace_members.delete_one({"id": member_id})
    if member.get("user_id"):
        await db.users.update_many(
            {"id": member["user_id"], "current_workspace_id": workspace_id},
            {"$unset": {"current_workspace_id": ""}},
        )
    return {"removed": member_id}


# ============== Categories ==============
@api_router.get("/categories")
async def get_categories():
    return CATEGORIES


# ============== Folders ==============
@api_router.get("/folders")
async def list_folders(category: str = Query(...), user: dict = Depends(get_current_user)):
    _ensure_category(category)
    ws_id = await get_current_workspace_id(user)
    folders = await db.folders.find(
        {"workspace_id": ws_id, "category": category},
        {"_id": 0},
    ).to_list(2000)
    return folders


@api_router.post("/folders")
async def create_folder(payload: FolderCreate, user: dict = Depends(get_current_user)):
    _ensure_category(payload.category)
    ws_id = await get_current_workspace_id(user)
    await assert_workspace_role(ws_id, user["id"], "editor")
    if payload.parent_id:
        parent = await db.folders.find_one({"id": payload.parent_id, "workspace_id": ws_id})
        if not parent:
            raise HTTPException(status_code=404, detail="Parent folder not found")
    folder = {
        "id": str(uuid.uuid4()),
        "name": payload.name,
        "category": payload.category,
        "parent_id": payload.parent_id,
        "workspace_id": ws_id,
        "owner_id": user["id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.folders.insert_one(folder)
    folder.pop("_id", None)
    return folder


@api_router.patch("/folders/{folder_id}")
async def update_folder(folder_id: str, payload: FolderUpdate, user: dict = Depends(get_current_user)):
    folder = await db.folders.find_one({"id": folder_id}, {"_id": 0})
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    await assert_workspace_role(folder["workspace_id"], user["id"], "editor")
    update = {k: v for k, v in payload.model_dump(exclude_unset=True).items()}
    if not update:
        raise HTTPException(status_code=400, detail="Nothing to update")
    await db.folders.update_one({"id": folder_id}, {"$set": update})
    return await db.folders.find_one({"id": folder_id}, {"_id": 0})


@api_router.delete("/folders/{folder_id}")
async def delete_folder(folder_id: str, user: dict = Depends(get_current_user)):
    root = await db.folders.find_one({"id": folder_id}, {"_id": 0})
    if not root:
        raise HTTPException(status_code=404, detail="Folder not found")
    await assert_workspace_role(root["workspace_id"], user["id"], "editor")
    ws_id = root["workspace_id"]
    to_delete = {folder_id}
    frontier = [folder_id]
    while frontier:
        children = await db.folders.find(
            {"parent_id": {"$in": frontier}, "workspace_id": ws_id},
            {"id": 1, "_id": 0},
        ).to_list(5000)
        next_frontier = []
        for c in children:
            if c["id"] not in to_delete:
                to_delete.add(c["id"])
                next_frontier.append(c["id"])
        frontier = next_frontier
    await db.items.update_many(
        {"folder_id": {"$in": list(to_delete)}, "workspace_id": ws_id},
        {"$set": {"is_deleted": True}},
    )
    await db.folders.delete_many({"id": {"$in": list(to_delete)}, "workspace_id": ws_id})
    return {"deleted": list(to_delete)}


# ============== Items ==============
@api_router.get("/items")
async def list_items(
    category: Optional[str] = None,
    folder_id: Optional[str] = Query(default=None),
    type: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    ws_id = await get_current_workspace_id(user)
    q: dict = {"workspace_id": ws_id, "is_deleted": {"$ne": True}}
    if category:
        _ensure_category(category)
        q["category"] = category
    if folder_id in ("null", ""):
        q["folder_id"] = None
    elif folder_id is not None:
        q["folder_id"] = folder_id
    if type:
        q["type"] = type
    items = await db.items.find(q, {"_id": 0, "blocks": 0, "search_text": 0}).sort("updated_at", -1).to_list(2000)
    return items


@api_router.get("/items/{item_id}")
async def get_item(item_id: str, user: dict = Depends(get_current_user)):
    item = await db.items.find_one({"id": item_id, "is_deleted": {"$ne": True}}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    await assert_workspace_role(item["workspace_id"], user["id"], "viewer")
    return item


@api_router.patch("/items/{item_id}")
async def update_item(item_id: str, payload: dict, user: dict = Depends(get_current_user)):
    item = await db.items.find_one({"id": item_id, "is_deleted": {"$ne": True}}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    await assert_workspace_role(item["workspace_id"], user["id"], "editor")
    allowed = {"title", "folder_id", "blocks", "url"}
    update = {k: v for k, v in payload.items() if k in allowed}
    if not update:
        raise HTTPException(status_code=400, detail="Nothing to update")
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    if "blocks" in update:
        update["search_text"] = _blocks_to_text(update["blocks"])
    await db.items.update_one({"id": item_id}, {"$set": update})
    return await db.items.find_one({"id": item_id}, {"_id": 0})


@api_router.delete("/items/{item_id}")
async def delete_item(item_id: str, user: dict = Depends(get_current_user)):
    item = await db.items.find_one({"id": item_id}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    await assert_workspace_role(item["workspace_id"], user["id"], "editor")
    await db.items.update_one({"id": item_id}, {"$set": {"is_deleted": True}})
    return {"deleted": item_id}


def _blocks_to_text(blocks: list) -> str:
    parts = []
    for b in blocks or []:
        if isinstance(b, dict):
            c = b.get("content", "")
            if c:
                parts.append(str(c))
            rows = b.get("rows")
            if rows:
                for r in rows:
                    parts.extend([str(x) for x in r])
    return " ".join(parts)


# ============== Notes ==============
@api_router.post("/notes")
async def create_note(payload: NoteCreate, user: dict = Depends(get_current_user)):
    _ensure_category(payload.category)
    ws_id = await get_current_workspace_id(user)
    await assert_workspace_role(ws_id, user["id"], "editor")
    if payload.folder_id:
        parent = await db.folders.find_one({"id": payload.folder_id, "workspace_id": ws_id})
        if not parent:
            raise HTTPException(status_code=404, detail="Folder not found")
    now = datetime.now(timezone.utc).isoformat()
    blocks = payload.blocks or [{"id": str(uuid.uuid4()), "type": "paragraph", "content": ""}]
    doc = {
        "id": str(uuid.uuid4()),
        "type": "note",
        "title": payload.title or "Untitled",
        "category": payload.category,
        "folder_id": payload.folder_id,
        "workspace_id": ws_id,
        "owner_id": user["id"],
        "blocks": blocks,
        "search_text": _blocks_to_text(blocks),
        "created_at": now,
        "updated_at": now,
        "is_deleted": False,
    }
    await db.items.insert_one(doc)
    doc.pop("_id", None)
    return doc


# ============== Web Links ==============
@api_router.post("/links")
async def create_link(payload: LinkCreate, user: dict = Depends(get_current_user)):
    _ensure_category(payload.category)
    ws_id = await get_current_workspace_id(user)
    await assert_workspace_role(ws_id, user["id"], "editor")
    if payload.folder_id:
        parent = await db.folders.find_one({"id": payload.folder_id, "workspace_id": ws_id})
        if not parent:
            raise HTTPException(status_code=404, detail="Folder not found")
    preview = fetch_link_preview(payload.url)
    title = payload.title or preview.get("title") or payload.url
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "type": "link",
        "title": title,
        "url": payload.url,
        "link_title": preview.get("title"),
        "link_description": preview.get("description"),
        "link_image": preview.get("image"),
        "category": payload.category,
        "folder_id": payload.folder_id,
        "workspace_id": ws_id,
        "owner_id": user["id"],
        "created_at": now,
        "updated_at": now,
        "is_deleted": False,
    }
    await db.items.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.post("/link-preview")
async def link_preview_endpoint(payload: dict, user: dict = Depends(get_current_user)):
    url = payload.get("url")
    if not url:
        raise HTTPException(status_code=400, detail="url required")
    return fetch_link_preview(url)


# ============== File Upload ==============
@api_router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    category: str = Form(...),
    folder_id: Optional[str] = Form(None),
    title: Optional[str] = Form(None),
    user: dict = Depends(get_current_user),
):
    _ensure_category(category)
    ws_id = await get_current_workspace_id(user)
    await assert_workspace_role(ws_id, user["id"], "editor")
    if folder_id:
        parent = await db.folders.find_one({"id": folder_id, "workspace_id": ws_id})
        if not parent:
            raise HTTPException(status_code=404, detail="Folder not found")
    filename = file.filename or "upload"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Allowed: pdf, doc, docx, ppt, pptx"
        )
    data = await file.read()
    if len(data) > 50 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 50MB)")
    content_type = file.content_type or ALLOWED_EXTENSIONS[ext]
    storage_path = f"{APP_NAME}/uploads/{ws_id}/{uuid.uuid4()}.{ext}"
    try:
        result = put_object(storage_path, data, content_type)
    except Exception as e:
        logger.error(f"Storage upload failed: {e}")
        raise HTTPException(status_code=500, detail="Storage upload failed")
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "type": "file",
        "title": title or filename,
        "category": category,
        "folder_id": folder_id,
        "workspace_id": ws_id,
        "owner_id": user["id"],
        "storage_path": result["path"],
        "original_filename": filename,
        "content_type": content_type,
        "size": result.get("size", len(data)),
        "ext": ext,
        "created_at": now,
        "updated_at": now,
        "is_deleted": False,
    }
    await db.items.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/files/{item_id}/download")
async def download_file(item_id: str, user: dict = Depends(get_current_user)):
    # Authenticated via httpOnly cookie or Authorization header. We deliberately
    # do NOT accept a token via query string — tokens in URLs leak to access logs,
    # browser history, and Referer headers.
    item = await db.items.find_one({"id": item_id, "type": "file", "is_deleted": {"$ne": True}})
    if not item:
        raise HTTPException(status_code=404, detail="File not found")
    member = await get_membership(item["workspace_id"], user["id"])
    if not member:
        raise HTTPException(status_code=403, detail="Not a member of this workspace")
    data, _ = get_object(item["storage_path"])
    return StreamingResponse(
        io.BytesIO(data),
        media_type=item.get("content_type", "application/octet-stream"),
        headers={
            "Content-Disposition": f'inline; filename="{item.get("original_filename", "file")}"'
        },
    )


# ============== AI Summary ==============
async def _get_or_extract_text(item: dict) -> str:
    if item.get("extracted_text"):
        return item["extracted_text"]
    try:
        data, _ = get_object(item["storage_path"])
    except Exception as e:
        logger.error(f"Storage fetch failed: {e}")
        raise HTTPException(status_code=500, detail="Could not read file from storage")
    text = extract_text(data, item.get("ext", ""))
    if text:
        await db.items.update_one({"id": item["id"]}, {"$set": {"extracted_text": text[:80000]}})
    return text or ""


@api_router.post("/items/{item_id}/summarize")
async def summarize_item(item_id: str, user: dict = Depends(get_current_user)):
    item = await db.items.find_one(
        {"id": item_id, "type": "file", "is_deleted": {"$ne": True}}, {"_id": 0}
    )
    if not item:
        raise HTTPException(status_code=404, detail="File not found")
    await assert_workspace_role(item["workspace_id"], user["id"], "viewer")
    if item.get("ai_summary"):
        return {"summary": item["ai_summary"], "cached": True}

    text = await _get_or_extract_text(item)
    if not text or len(text.strip()) < 20:
        raise HTTPException(
            status_code=400,
            detail=f"No extractable text in this {item.get('ext','file').upper()}. Summaries work best with PDF/DOCX/PPTX containing real text (not scanned images).",
        )
    text = text[:40000]

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")

    system = (
        "You are a senior training-content analyst. Summarise the provided slide deck / "
        "training document. Produce concise, structured Markdown with the following sections:\n"
        "## TL;DR\n(2–3 sentences)\n\n"
        "## Key Topics\n(bulleted list, max 8)\n\n"
        "## Main Takeaways\n(numbered list, 3–6 items, action-oriented)\n\n"
        "## Glossary\n(only if domain-specific terms appear; otherwise omit)\n\n"
        "Be precise. Do not invent facts. Quote sparingly."
    )
    try:
        client = AsyncAnthropic(api_key=api_key)
        response = await client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=2048,
            system=system,
            messages=[{
                "role": "user",
                "content": (
                    f"Title: {item.get('title')}\n"
                    f"Filename: {item.get('original_filename')}\n\n"
                    f"--- Document text ---\n{text}"
                ),
            }],
        )
        summary = "".join(b.text for b in response.content if getattr(b, "type", None) == "text")
    except Exception as e:
        logger.error(f"LLM call failed: {e}")
        raise HTTPException(status_code=500, detail="AI summary failed. Please try again.")

    summary = (summary or "").strip()
    await db.items.update_one(
        {"id": item_id},
        {"$set": {"ai_summary": summary, "summarized_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"summary": summary, "cached": False}


@api_router.delete("/items/{item_id}/summary")
async def clear_summary(item_id: str, user: dict = Depends(get_current_user)):
    item = await db.items.find_one({"id": item_id}, {"_id": 0, "workspace_id": 1})
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    await assert_workspace_role(item["workspace_id"], user["id"], "editor")
    await db.items.update_one(
        {"id": item_id},
        {"$unset": {"ai_summary": "", "summarized_at": ""}},
    )
    return {"cleared": True}


# ============== Chat with deck ==============
@api_router.get("/items/{item_id}/chat")
async def get_chat(item_id: str, user: dict = Depends(get_current_user)):
    item = await db.items.find_one({"id": item_id, "is_deleted": {"$ne": True}}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    await assert_workspace_role(item["workspace_id"], user["id"], "viewer")
    chat = await db.deck_chats.find_one(
        {"item_id": item_id, "user_id": user["id"]}, {"_id": 0}
    )
    return {"messages": chat["messages"] if chat else []}


@api_router.post("/items/{item_id}/chat")
async def post_chat(item_id: str, payload: ChatRequest, user: dict = Depends(get_current_user)):
    item = await db.items.find_one({"id": item_id, "type": "file", "is_deleted": {"$ne": True}}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="File not found")
    await assert_workspace_role(item["workspace_id"], user["id"], "viewer")
    text = await _get_or_extract_text(item)
    if not text or len(text.strip()) < 20:
        raise HTTPException(
            status_code=400,
            detail=f"No extractable text in this {item.get('ext','file').upper()} to chat with.",
        )
    text = text[:40000]

    chat_doc = await db.deck_chats.find_one(
        {"item_id": item_id, "user_id": user["id"]}, {"_id": 0}
    )
    history = chat_doc["messages"] if chat_doc else []

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")

    system = (
        "You are an expert tutor and analyst answering questions about a specific training document. "
        "Use ONLY the document text provided below as the source of truth. If the answer isn't in the document, "
        "say so plainly. Cite slide/section numbers when possible. Keep answers tight and clear in Markdown.\n\n"
        f"--- Document: {item.get('title')} ({item.get('original_filename')}) ---\n{text}\n--- End document ---"
    )

    # Replay the last few turns directly via the Anthropic messages array.
    # No server-side session state — every request is self-contained.
    recent_turns = [
        {"role": m["role"], "content": m["content"]}
        for m in history[-10:]
        if m.get("role") in ("user", "assistant")
    ]
    api_messages = recent_turns + [{"role": "user", "content": payload.message}]

    try:
        client = AsyncAnthropic(api_key=api_key)
        completion = await client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=1024,
            system=system,
            messages=api_messages,
        )
        response = "".join(
            b.text for b in completion.content if getattr(b, "type", None) == "text"
        )
    except Exception as e:
        logger.error(f"Chat LLM call failed: {e}")
        raise HTTPException(status_code=500, detail="Chat failed. Please try again.")

    now = datetime.now(timezone.utc).isoformat()
    new_messages = history + [
        {"role": "user", "content": payload.message, "ts": now},
        {"role": "assistant", "content": (response or "").strip(), "ts": now},
    ]
    # Cap stored history to last 40 messages
    new_messages = new_messages[-40:]
    await db.deck_chats.update_one(
        {"item_id": item_id, "user_id": user["id"]},
        {"$set": {"item_id": item_id, "user_id": user["id"], "messages": new_messages, "updated_at": now}},
        upsert=True,
    )
    return {"messages": new_messages}


@api_router.delete("/items/{item_id}/chat")
async def clear_chat(item_id: str, user: dict = Depends(get_current_user)):
    await db.deck_chats.delete_one({"item_id": item_id, "user_id": user["id"]})
    return {"cleared": True}


# ============== Share Links ==============
@api_router.post("/items/{item_id}/share")
async def enable_share(item_id: str, user: dict = Depends(get_current_user)):
    item = await db.items.find_one({"id": item_id, "is_deleted": {"$ne": True}}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    await assert_workspace_role(item["workspace_id"], user["id"], "editor")
    slug = item.get("share_slug")
    if not slug:
        slug = secrets.token_urlsafe(10)
        await db.items.update_one(
            {"id": item_id},
            {"$set": {"share_slug": slug, "share_enabled": True}},
        )
    else:
        await db.items.update_one(
            {"id": item_id}, {"$set": {"share_enabled": True}}
        )
    return {"slug": slug, "share_enabled": True}


@api_router.delete("/items/{item_id}/share")
async def disable_share(item_id: str, user: dict = Depends(get_current_user)):
    item = await db.items.find_one({"id": item_id}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    await assert_workspace_role(item["workspace_id"], user["id"], "editor")
    await db.items.update_one(
        {"id": item_id}, {"$set": {"share_enabled": False}}
    )
    return {"share_enabled": False}


@api_router.get("/public/items/{slug}")
async def public_get_item(slug: str):
    item = await db.items.find_one(
        {"share_slug": slug, "share_enabled": True, "is_deleted": {"$ne": True}},
        {"_id": 0, "owner_id": 0, "workspace_id": 0, "search_text": 0, "extracted_text": 0, "ai_summary": 0},
    )
    if not item:
        raise HTTPException(status_code=404, detail="Not found or no longer shared")
    return item


@api_router.get("/public/items/{slug}/download")
async def public_download(slug: str):
    item = await db.items.find_one(
        {"share_slug": slug, "share_enabled": True, "type": "file", "is_deleted": {"$ne": True}}
    )
    if not item:
        raise HTTPException(status_code=404, detail="Not found")
    data, _ = get_object(item["storage_path"])
    return StreamingResponse(
        io.BytesIO(data),
        media_type=item.get("content_type", "application/octet-stream"),
        headers={
            "Content-Disposition": f'inline; filename="{item.get("original_filename", "file")}"'
        },
    )


# ============== Search ==============
@api_router.get("/search")
async def search(q: str = Query(...), user: dict = Depends(get_current_user)):
    if not q.strip():
        return {"folders": [], "items": []}
    ws_id = await get_current_workspace_id(user)
    import re as _re
    safe = _re.escape(q.strip())
    folders = await db.folders.find(
        {"workspace_id": ws_id, "name": {"$regex": safe, "$options": "i"}},
        {"_id": 0},
    ).limit(20).to_list(20)
    items = await db.items.find(
        {
            "workspace_id": ws_id,
            "is_deleted": {"$ne": True},
            "$or": [
                {"title": {"$regex": safe, "$options": "i"}},
                {"search_text": {"$regex": safe, "$options": "i"}},
                {"link_description": {"$regex": safe, "$options": "i"}},
                {"url": {"$regex": safe, "$options": "i"}},
                {"original_filename": {"$regex": safe, "$options": "i"}},
            ],
        },
        {"_id": 0, "blocks": 0, "search_text": 0, "extracted_text": 0},
    ).limit(40).to_list(40)
    return {"folders": folders, "items": items}


# ============== Mount ==============
# CORS must be added before include_router so the middleware wraps the routes.
# Origins come from the CORS_ORIGINS env var (comma-separated). Defaults to
# localhost:3000 so the dev server works out of the box; production must set
# this to the real frontend origin(s). Never use "*" with credentials — browsers
# block that combination and it disables CSRF protection for cookie auth.
_cors_origins_env = os.environ.get("CORS_ORIGINS", "http://localhost:3000")
CORS_ORIGINS = [o.strip() for o in _cors_origins_env.split(",") if o.strip()]
if "*" in CORS_ORIGINS:
    raise RuntimeError("CORS_ORIGINS must not contain '*' when cookie auth is in use")

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

app.include_router(api_router)
