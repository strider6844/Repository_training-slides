from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import io
import uuid
import logging
from datetime import datetime, timezone
from typing import List, Optional, Literal

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
    extract_token_from_request,
    get_current_user as auth_get_current_user,
)
from storage import init_storage, put_object, get_object
from link_preview import fetch_link_preview

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

# MongoDB
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

APP_NAME = os.environ.get("APP_NAME", "training-slides")

# Static categories
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


class UserOut(BaseModel):
    id: str
    email: str
    name: str
    role: str


class FolderCreate(BaseModel):
    name: str
    category: str
    parent_id: Optional[str] = None


class FolderUpdate(BaseModel):
    name: Optional[str] = None
    parent_id: Optional[str] = None


class FolderOut(BaseModel):
    id: str
    name: str
    category: str
    parent_id: Optional[str]
    owner_id: str
    created_at: str


class Block(BaseModel):
    id: str
    type: str  # paragraph, h1, h2, h3, bullet, numbered, todo, quote, code, divider, callout, table, embed
    content: Optional[str] = ""
    checked: Optional[bool] = None
    language: Optional[str] = None  # for code
    rows: Optional[List[List[str]]] = None  # for table
    url: Optional[str] = None  # for embed


class NoteCreate(BaseModel):
    title: str
    category: str
    folder_id: Optional[str] = None
    blocks: List[dict] = Field(default_factory=list)


class NoteUpdate(BaseModel):
    title: Optional[str] = None
    blocks: Optional[List[dict]] = None
    folder_id: Optional[str] = None


class LinkCreate(BaseModel):
    url: str
    category: str
    folder_id: Optional[str] = None
    title: Optional[str] = None


class ItemUpdate(BaseModel):
    title: Optional[str] = None
    folder_id: Optional[str] = None


# ============== Auth helpers ==============
async def get_current_user(request: Request):
    return await auth_get_current_user(request, db)


# ============== Startup ==============
@app.on_event("startup")
async def startup():
    # Indexes
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.folders.create_index([("owner_id", 1), ("category", 1)])
    await db.folders.create_index("id", unique=True)
    await db.items.create_index([("owner_id", 1), ("category", 1), ("folder_id", 1)])
    await db.items.create_index("id", unique=True)
    # Text index for search
    try:
        await db.items.create_index(
            [("title", "text"), ("search_text", "text"), ("link_description", "text")]
        )
    except Exception as e:
        logger.warning(f"Text index: {e}")
    # Init storage
    try:
        init_storage()
        logger.info("Storage initialized")
    except Exception as e:
        logger.error(f"Storage init failed: {e}")
    # Seed admin
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@example.com")
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    existing = await db.users.find_one({"email": admin_email})
    if existing is None:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "email": admin_email,
            "password_hash": hash_password(admin_password),
            "name": "Admin",
            "role": "admin",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        logger.info(f"Seeded admin: {admin_email}")
    elif not verify_password(admin_password, existing["password_hash"]):
        await db.users.update_one(
            {"email": admin_email},
            {"$set": {"password_hash": hash_password(admin_password)}}
        )


@app.on_event("shutdown")
async def shutdown():
    client.close()


# ============== Health ==============
@api_router.get("/")
async def root():
    return {"message": "Training Slides API", "status": "ok"}


# ============== Auth Endpoints ==============
@api_router.post("/auth/register")
async def register(payload: RegisterRequest, response: Response):
    email = payload.email.lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = str(uuid.uuid4())
    user_doc = {
        "id": user_id,
        "email": email,
        "name": payload.name,
        "password_hash": hash_password(payload.password),
        "role": "user",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(user_doc)
    access = create_access_token(user_id, email)
    refresh = create_refresh_token(user_id)
    set_auth_cookies(response, access, refresh)
    return {"id": user_id, "email": email, "name": payload.name, "role": "user"}


@api_router.post("/auth/login")
async def login(payload: LoginRequest, response: Response):
    email = payload.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    access = create_access_token(user["id"], email)
    refresh = create_refresh_token(user["id"])
    set_auth_cookies(response, access, refresh)
    return {"id": user["id"], "email": user["email"], "name": user["name"], "role": user.get("role", "user")}


@api_router.post("/auth/logout")
async def logout(response: Response):
    clear_auth_cookies(response)
    return {"message": "Logged out"}


@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return {"id": user["id"], "email": user["email"], "name": user["name"], "role": user.get("role", "user")}


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


# ============== Categories ==============
@api_router.get("/categories")
async def get_categories():
    return CATEGORIES


def _ensure_category(category: str):
    if category not in CATEGORY_IDS:
        raise HTTPException(status_code=400, detail="Unknown category")


# ============== Folders ==============
@api_router.get("/folders")
async def list_folders(
    category: str = Query(...),
    user: dict = Depends(get_current_user),
):
    _ensure_category(category)
    folders = await db.folders.find(
        {"owner_id": user["id"], "category": category},
        {"_id": 0},
    ).to_list(2000)
    return folders


@api_router.post("/folders")
async def create_folder(payload: FolderCreate, user: dict = Depends(get_current_user)):
    _ensure_category(payload.category)
    if payload.parent_id:
        parent = await db.folders.find_one({"id": payload.parent_id, "owner_id": user["id"]})
        if not parent:
            raise HTTPException(status_code=404, detail="Parent folder not found")
    folder = {
        "id": str(uuid.uuid4()),
        "name": payload.name,
        "category": payload.category,
        "parent_id": payload.parent_id,
        "owner_id": user["id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.folders.insert_one(folder)
    folder.pop("_id", None)
    return folder


@api_router.patch("/folders/{folder_id}")
async def update_folder(folder_id: str, payload: FolderUpdate, user: dict = Depends(get_current_user)):
    update = {k: v for k, v in payload.model_dump(exclude_unset=True).items()}
    if not update:
        raise HTTPException(status_code=400, detail="Nothing to update")
    res = await db.folders.update_one(
        {"id": folder_id, "owner_id": user["id"]},
        {"$set": update},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Folder not found")
    folder = await db.folders.find_one({"id": folder_id}, {"_id": 0})
    return folder


@api_router.delete("/folders/{folder_id}")
async def delete_folder(folder_id: str, user: dict = Depends(get_current_user)):
    # Recursively delete child folders and items
    async def collect_descendants(fid: str, acc: set):
        acc.add(fid)
        children = await db.folders.find({"parent_id": fid, "owner_id": user["id"]}, {"id": 1, "_id": 0}).to_list(1000)
        for c in children:
            await collect_descendants(c["id"], acc)
    to_delete = set()
    await collect_descendants(folder_id, to_delete)
    if not to_delete:
        raise HTTPException(status_code=404, detail="Folder not found")
    # Mark items as deleted
    await db.items.update_many(
        {"folder_id": {"$in": list(to_delete)}, "owner_id": user["id"]},
        {"$set": {"is_deleted": True}},
    )
    await db.folders.delete_many({"id": {"$in": list(to_delete)}, "owner_id": user["id"]})
    return {"deleted": list(to_delete)}


# ============== Items ==============
@api_router.get("/items")
async def list_items(
    category: Optional[str] = None,
    folder_id: Optional[str] = Query(default=None),
    type: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    q: dict = {"owner_id": user["id"], "is_deleted": {"$ne": True}}
    if category:
        _ensure_category(category)
        q["category"] = category
    if folder_id == "null" or folder_id == "":
        q["folder_id"] = None
    elif folder_id is not None:
        q["folder_id"] = folder_id
    if type:
        q["type"] = type
    items = await db.items.find(q, {"_id": 0}).sort("updated_at", -1).to_list(2000)
    # Don't expose blocks in list view for notes (saves bandwidth)
    return items


@api_router.get("/items/{item_id}")
async def get_item(item_id: str, user: dict = Depends(get_current_user)):
    item = await db.items.find_one({"id": item_id, "owner_id": user["id"], "is_deleted": {"$ne": True}}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


@api_router.patch("/items/{item_id}")
async def update_item(item_id: str, payload: dict, user: dict = Depends(get_current_user)):
    allowed = {"title", "folder_id", "blocks", "url"}
    update = {k: v for k, v in payload.items() if k in allowed}
    if not update:
        raise HTTPException(status_code=400, detail="Nothing to update")
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    # rebuild search_text for notes
    if "blocks" in update:
        update["search_text"] = _blocks_to_text(update["blocks"])
    res = await db.items.update_one(
        {"id": item_id, "owner_id": user["id"]},
        {"$set": update},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Item not found")
    item = await db.items.find_one({"id": item_id}, {"_id": 0})
    return item


@api_router.delete("/items/{item_id}")
async def delete_item(item_id: str, user: dict = Depends(get_current_user)):
    res = await db.items.update_one(
        {"id": item_id, "owner_id": user["id"]},
        {"$set": {"is_deleted": True}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Item not found")
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
    if payload.folder_id:
        parent = await db.folders.find_one({"id": payload.folder_id, "owner_id": user["id"]})
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
    if payload.folder_id:
        parent = await db.folders.find_one({"id": payload.folder_id, "owner_id": user["id"]})
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
    if folder_id:
        parent = await db.folders.find_one({"id": folder_id, "owner_id": user["id"]})
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
    storage_path = f"{APP_NAME}/uploads/{user['id']}/{uuid.uuid4()}.{ext}"
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
async def download_file(item_id: str, request: Request, auth: Optional[str] = Query(None)):
    # Try cookie/header first
    token = extract_token_from_request(request) or auth
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token")
        user_id = payload["sub"]
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")
    item = await db.items.find_one({"id": item_id, "owner_id": user_id, "type": "file", "is_deleted": {"$ne": True}})
    if not item:
        raise HTTPException(status_code=404, detail="File not found")
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
    # Folders: regex name match
    import re as _re
    safe = _re.escape(q.strip())
    folders = await db.folders.find(
        {"owner_id": user["id"], "name": {"$regex": safe, "$options": "i"}},
        {"_id": 0},
    ).limit(20).to_list(20)
    # Items: regex on title + search_text + link_description + url
    items = await db.items.find(
        {
            "owner_id": user["id"],
            "is_deleted": {"$ne": True},
            "$or": [
                {"title": {"$regex": safe, "$options": "i"}},
                {"search_text": {"$regex": safe, "$options": "i"}},
                {"link_description": {"$regex": safe, "$options": "i"}},
                {"url": {"$regex": safe, "$options": "i"}},
                {"original_filename": {"$regex": safe, "$options": "i"}},
            ],
        },
        {"_id": 0, "blocks": 0, "search_text": 0},
    ).limit(40).to_list(40)
    return {"folders": folders, "items": items}


# ============== Mount ==============
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],  # adjust for prod
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)
