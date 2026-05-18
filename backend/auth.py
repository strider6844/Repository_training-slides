"""JWT authentication helpers."""
import os
import jwt
import bcrypt
from datetime import datetime, timezone, timedelta
from fastapi import HTTPException, Request

JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_MINUTES = 60 * 24  # 1 day (longer for convenience)
REFRESH_TOKEN_DAYS = 7


def get_jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


def hash_password(password: str) -> str:
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode("utf-8"), salt)
    return hashed.decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))


def create_access_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_MINUTES),
        "type": "access",
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_DAYS),
        "type": "refresh",
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def _cookie_secure() -> bool:
    # Secure by default; opt out only for local HTTP development.
    return os.environ.get("COOKIE_SECURE", "true").lower() not in ("false", "0", "no")


def _cookie_samesite() -> str:
    # When frontend and backend share a registrable domain ("lax" works).
    # When they don't (e.g. vercel.app frontend + onrender.com backend), the
    # browser drops cookies on cross-site requests unless SameSite=None + Secure.
    # Default to "lax" for the simple case; production cross-origin deployments
    # should set COOKIE_SAMESITE=none.
    val = os.environ.get("COOKIE_SAMESITE", "lax").lower()
    if val not in ("lax", "strict", "none"):
        val = "lax"
    return val


def set_auth_cookies(response, access_token: str, refresh_token: str):
    secure = _cookie_secure()
    samesite = _cookie_samesite()
    # Browsers reject SameSite=None without Secure — enforce it here so a
    # misconfigured env doesn't silently drop every cookie.
    if samesite == "none" and not secure:
        raise RuntimeError("COOKIE_SAMESITE=none requires COOKIE_SECURE=true")
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=secure,
        samesite=samesite,
        max_age=ACCESS_TOKEN_MINUTES * 60,
        path="/",
    )
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=secure,
        samesite=samesite,
        max_age=REFRESH_TOKEN_DAYS * 86400,
        path="/",
    )


def clear_auth_cookies(response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")


def decode_token(token: str) -> dict:
    return jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])


def extract_token_from_request(request: Request) -> str | None:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    return token


async def get_current_user(request: Request, db):
    token = extract_token_from_request(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user_id = payload["sub"]
        user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
