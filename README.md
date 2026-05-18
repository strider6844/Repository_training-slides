# Slidevault

A categorized knowledge vault for training material. Upload PDFs / DOCX / PPTX,
paste web links (auto OG-previewed), or write Notion-style block notes,
organized into nested folders under five categories (Finance, ESG, and three
Claude workflows). Multi-workspace with owner / editor / viewer roles. Each
file supports an AI-generated summary and a per-user "chat with this deck"
powered by Claude Sonnet 4.5.

Originally scaffolded with Emergent. This branch has been migrated off Emergent
to run self-hosted: local filesystem storage and a direct Anthropic API key
instead of `emergentintegrations`.

## Stack

- **Backend**: FastAPI + Motor (async MongoDB) + bcrypt + PyJWT + Anthropic SDK
- **Frontend**: React 19 + React Router 7 + axios + shadcn/ui + Tailwind + sonner toasts
- **Storage**: Local filesystem (defaults to `backend/data/uploads/`)
- **LLM**: Anthropic API, Claude Sonnet 4.5

## Prerequisites

- Python 3.10+
- Node.js 18+
- A MongoDB instance — easiest is the [Atlas free tier](https://www.mongodb.com/atlas)
- An [Anthropic API key](https://console.anthropic.com/) (optional — only needed for AI summary + chat)

## Setup

### Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # macOS / Linux
pip install -r requirements.txt
copy .env.example .env          # Windows
# cp .env.example .env          # macOS / Linux
# Edit .env and fill in MONGO_URL, JWT_SECRET, ANTHROPIC_API_KEY
```

Run the backend:

```bash
uvicorn server:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
# Create .env with the backend URL:
echo REACT_APP_BACKEND_URL=http://localhost:8000 > .env
npm start
```

The app will open at `http://localhost:3000`.

## First-time login

If you set `ADMIN_EMAIL` + `ADMIN_PASSWORD` in `backend/.env`, the admin user is
seeded on first backend startup. Otherwise, click "Create an account" on the
login page and register normally.

## Environment variables

See [`backend/.env.example`](backend/.env.example) for the full list with
inline documentation. The most important ones:

| Var | Required | Purpose |
|---|---|---|
| `MONGO_URL` | yes | Mongo connection string (Atlas or local) |
| `DB_NAME` | yes | Database name (default `training_slides`) |
| `JWT_SECRET` | yes | Long random string for signing tokens |
| `ANTHROPIC_API_KEY` | for AI features | Anthropic key for summary + deck chat |
| `STORAGE_DIR` | no | Absolute path for uploaded files (default `backend/data/uploads`) |
| `CORS_ORIGINS` | no | Allowed origins (default `http://localhost:3000`) |
| `COOKIE_SECURE` | no | Set `false` for HTTP dev, `true` for HTTPS prod |
| `CLAUDE_MODEL` | no | Override the Claude model (default Sonnet 4.5) |

## Tests

```bash
cd backend
pytest tests/                    # all tests
pytest tests/backend_test.py     # iteration 1 (auth, folders, notes, upload, search)
pytest tests/test_iteration2.py  # iteration 2 (workspaces, members, share, chat)
```

Tests need the backend to be running. By default they hit the URL in
`REACT_APP_BACKEND_URL`; export `REACT_APP_BACKEND_URL=http://localhost:8000`
to point them at your local backend.

## Project layout

```
backend/
  server.py          # All FastAPI routes (single file)
  auth.py            # JWT + bcrypt + cookie helpers
  storage.py         # Local-filesystem object store
  link_preview.py    # OG/Twitter scraper (SSRF-guarded)
  extract_text.py    # PDF / DOCX / PPTX text extraction
  tests/             # pytest suites
  data/uploads/      # File storage (gitignored, created at startup)

frontend/
  src/
    App.js           # Router + protected/public route guards
    context/         # AuthContext, WorkspaceContext
    pages/           # Login, Dashboard, Category, NoteEditor, FileViewer, ...
    components/      # AppShell, FolderTree, WorkspaceSwitcher, DeckChat, ShareDialog, ui/*
    lib/             # api.js (axios), categories.js, utils.js
```

## License

Private. Not licensed for redistribution.
