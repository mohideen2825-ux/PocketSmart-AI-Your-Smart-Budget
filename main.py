from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from pathlib import Path
from typing import Any
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr, Field

load_dotenv()

ROOT = Path(__file__).resolve().parent
app = FastAPI(title="PocketSmart AI", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8000", "http://127.0.0.1:8000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")

bearer = HTTPBearer(auto_error=False)
users: dict[str, dict[str, str]] = {}
recommendation_history: dict[str, list[dict[str, Any]]] = {}
recommendations_by_id: dict[str, dict[str, Any]] = {}

PLANNERS = {"home", "party", "jewelry"}
PRODUCT_PHOTOS = {
    "home": "https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?auto=format&fit=crop&w=800&q=80",
    "party": "https://images.unsplash.com/photo-1511795409834-ef04bbd61622?auto=format&fit=crop&w=800&q=80",
    "jewelry": "https://images.unsplash.com/photo-1611652022419-a9419f74343d?auto=format&fit=crop&w=800&q=80",
}


class PlannerInput(BaseModel):
    budget: float = Field(ge=300, le=100_000_000)
    details: dict[str, Any] = Field(default_factory=dict)
    image_data: str | None = None


class RegisterInput(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginInput(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def _issue_token(email: str) -> str:
    header = _b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = _b64(json.dumps({"sub": email, "exp": int(time.time()) + 60 * 60 * 24 * 7}).encode())
    signing_input = f"{header}.{payload}"
    secret = os.getenv("JWT_SECRET", "local-development-secret-change-me").encode()
    signature = _b64(hmac.new(secret, signing_input.encode(), hashlib.sha256).digest())
    return f"{signing_input}.{signature}"


def _current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> dict[str, str] | None:
    if credentials is None:
        return None
    try:
        header, payload, signature = credentials.credentials.split(".")
        signing_input = f"{header}.{payload}"
        secret = os.getenv("JWT_SECRET", "local-development-secret-change-me").encode()
        expected = _b64(hmac.new(secret, signing_input.encode(), hashlib.sha256).digest())
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        if not hmac.compare_digest(signature, expected) or claims["exp"] < time.time():
            raise ValueError("Invalid token")
        return users.get(claims["sub"])
    except (ValueError, KeyError, json.JSONDecodeError):
        raise HTTPException(status_code=401, detail="Your session has expired. Please sign in again.")


def _password_hash(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 310_000)
    return f"{_b64(salt)}${_b64(digest)}"


def _check_password(password: str, stored: str) -> bool:
    salt, _ = stored.split("$", 1)
    return hmac.compare_digest(_password_hash(password, base64.urlsafe_b64decode(salt + "=" * (-len(salt) % 4))), stored)


def _fallback_recommendations(planner: str, budget: float, details: dict[str, Any]) -> list[dict[str, Any]]:
    presets = {
        "home": [
            ("Lighting", "Warm ambient floor lamp", "IKEA", "A soft-glow lamp to anchor the room."),
            ("Seating", "Textured accent chair", "Amazon", "A compact seat with a relaxed, neutral finish."),
            ("Finishing touch", "Handwoven cushion set", "Flipkart", "An easy color layer for your room."),
        ],
        "party": [
            ("Food", "Crowd-friendly sharing menu", "Zomato", "Flexible platters sized to your guest count."),
            ("Venue", "Intimate event space", "OYO", "A comfortable venue option for your gathering."),
            ("Decor", "Reusable celebration set", "Amazon", "Table accents and lighting for the occasion."),
        ],
        "jewelry": [
            ("Earrings", "Gold-tone sculpted hoops", "Mia by Tanishq", "A versatile pair for day-to-evening wear."),
            ("Necklace", "Minimal pendant chain", "Amazon", "A clean layer that works with most necklines."),
            ("Bracelet", "Polished link bracelet", "Flipkart", "A subtle finishing detail for your look."),
        ],
    }
    allocation = [0.34, 0.28, 0.20]
    products = []
    for index, (category, title, vendor, description) in enumerate(presets[planner]):
        price = round(budget * allocation[index] / 100) * 100
        products.append({
            "id": str(uuid4()),
            "category": category,
            "title": title,
            "vendor": vendor,
            "price": max(100, price),
            "description": description,
            "image": PRODUCT_PHOTOS[planner],
            "url": f"https://www.google.com/search?q={vendor.replace(' ', '+')}+{title.replace(' ', '+')}",
        })
    return products


def _image_part(image_data: str) -> tuple[bytes, str]:
    header, encoded = image_data.split(",", 1)
    mime_type = header.split(":", 1)[1].split(";", 1)[0]
    if not mime_type.startswith("image/"):
        raise ValueError("Upload an image file to use outfit matching.")
    return base64.b64decode(encoded), mime_type


def _gemini_recommendations(planner: str, budget: float, details: dict[str, Any], image_data: str | None) -> list[dict[str, Any]] | None:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return None
    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)
        prompt = (
            "You are PocketSmart, a practical budget planner. Return only a JSON array of exactly three objects. "
            "Each object must have category, title, vendor, price (number in INR), and description. "
            f"Planner: {planner}. Total budget: INR {budget:.0f}. User details: {json.dumps(details, ensure_ascii=True)}. "
            "Keep the sum of all prices at or below 85% of the budget. Use realistic options from Amazon, Flipkart, IKEA, "
            "Swiggy, Zomato, or OYO as appropriate. Do not invent product URLs."
        )
        contents: list[Any] = [prompt]
        if image_data and planner == "jewelry":
            image_bytes, mime_type = _image_part(image_data)
            contents.append(types.Part.from_bytes(data=image_bytes, mime_type=mime_type))
        response = client.models.generate_content(
            model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
            contents=contents,
            config=types.GenerateContentConfig(response_mime_type="application/json"),
        )
        parsed = json.loads(response.text or "[]")
        if not isinstance(parsed, list) or len(parsed) != 3:
            return None
        items = []
        for item in parsed:
            price = float(item["price"])
            if price <= 0:
                return None
            vendor = str(item["vendor"])
            title = str(item["title"])
            items.append({
                "id": str(uuid4()),
                "category": str(item["category"]),
                "title": title,
                "vendor": vendor,
                "price": round(price),
                "description": str(item["description"]),
                "image": PRODUCT_PHOTOS[planner],
                "url": f"https://www.google.com/search?q={vendor.replace(' ', '+')}+{title.replace(' ', '+')}",
            })
        if sum(item["price"] for item in items) > budget:
            return None
        return items
    except Exception:
        return None


@app.get("/")
async def home() -> FileResponse:
    return FileResponse(ROOT / "templates" / "index.html")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "ai": "gemini" if os.getenv("GEMINI_API_KEY") else "demo"}


@app.post("/register")
async def register(data: RegisterInput) -> dict[str, Any]:
    email = str(data.email).lower()
    if email in users:
        raise HTTPException(status_code=409, detail="An account with this email already exists.")
    users[email] = {"name": data.name.strip(), "password": _password_hash(data.password)}
    recommendation_history[email] = []
    return {"token": _issue_token(email), "user": {"name": users[email]["name"], "email": email}}


@app.post("/login")
@app.post("/token")
async def login(data: LoginInput) -> dict[str, Any]:
    email = str(data.email).lower()
    user = users.get(email)
    if not user or not _check_password(data.password, user["password"]):
        raise HTTPException(status_code=401, detail="Email or password is incorrect.")
    return {"token": _issue_token(email), "user": {"name": user["name"], "email": email}}


@app.post("/logout")
async def logout() -> dict[str, str]:
    return {"status": "signed out"}


@app.get("/session-info")
async def session_info(user: dict[str, str] | None = Depends(_current_user)) -> dict[str, Any]:
    if not user:
        return {"authenticated": False}
    email = next(email for email, value in users.items() if value is user)
    return {"authenticated": True, "user": {"name": user["name"], "email": email}}


@app.get("/session-data")
@app.get("/history")
async def session_data(user: dict[str, str] | None = Depends(_current_user)) -> dict[str, Any]:
    email = next((email for email, value in users.items() if value is user), None)
    return {"history": recommendation_history.get(email, []) if email else []}


@app.get("/recommendations-details")
async def recommendation_details(id: str = Query(min_length=1)) -> dict[str, Any]:
    recommendation = recommendations_by_id.get(id)
    if not recommendation:
        raise HTTPException(status_code=404, detail="Recommendation not found.")
    return recommendation


async def _generate(planner: str, data: PlannerInput, user: dict[str, str] | None) -> dict[str, Any]:
    if planner not in PLANNERS:
        raise HTTPException(status_code=404, detail="Planner not found.")
    if data.image_data and planner != "jewelry":
        raise HTTPException(status_code=400, detail="Outfit images are only supported by the jewelry planner.")
    if data.image_data:
        try:
            image_bytes, _ = _image_part(data.image_data)
            if len(image_bytes) > 5_000_000:
                raise HTTPException(status_code=413, detail="Please choose an image under 5 MB.")
        except (ValueError, base64.binascii.Error):
            raise HTTPException(status_code=400, detail="That image could not be read. Please choose another.")

    items = _gemini_recommendations(planner, data.budget, data.details, data.image_data)
    source = "gemini" if items else "demo"
    if items is None:
        items = _fallback_recommendations(planner, data.budget, data.details)
    result = {
        "id": str(uuid4()),
        "planner": planner,
        "budget": data.budget,
        "total": sum(item["price"] for item in items),
        "source": source,
        "created_at": int(time.time()),
        "items": items,
    }
    recommendations_by_id[result["id"]] = result
    email = next((email for email, value in users.items() if value is user), None)
    if email:
        recommendation_history.setdefault(email, []).insert(0, result)
        recommendation_history[email] = recommendation_history[email][:20]
    return result


@app.post("/generate-home")
async def generate_home(data: PlannerInput, user: dict[str, str] | None = Depends(_current_user)) -> dict[str, Any]:
    return await _generate("home", data, user)


@app.post("/generate-party")
async def generate_party(data: PlannerInput, user: dict[str, str] | None = Depends(_current_user)) -> dict[str, Any]:
    return await _generate("party", data, user)


@app.post("/generate-jewelry")
async def generate_jewelry(data: PlannerInput, user: dict[str, str] | None = Depends(_current_user)) -> dict[str, Any]:
    return await _generate("jewelry", data, user)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)