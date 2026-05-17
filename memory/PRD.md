# Slidevault — Training Slides Repository

## Original problem statement
Create an app to keep training slides, categorized under:
- (A) Finance and Accounting
- (B) ESG and Sustainability
- (C) Claude — separated into Chat, Co-work, and Code

Must allow adding folders Notion-style (nested), accept PDF/Word/PPT/web links, and Notion-style block-based notes.

## User choices
- Auth: JWT custom (email/password)
- Storage: Emergent object storage (cloud)
- Notion blocks: Full set (incl. tables/embeds)
- Search: Global yes
- Web links: Auto-fetch preview (title/description/image)

## Architecture
- **Backend**: FastAPI + Motor (MongoDB) + bcrypt + PyJWT, Emergent object storage SDK, custom OG/Twitter preview fetcher (regex-based, no external lib).
- **Frontend**: React 19 + React Router 7 + axios (withCredentials) + Shadcn UI + Tailwind + Lucide icons + Sonner toasts. Swiss/high-contrast light theme with Cabinet Grotesk + IBM Plex Sans + JetBrains Mono.

## Data model (MongoDB)
- `users`: id (uuid), email, password_hash, name, role, created_at
- `folders`: id, name, category, parent_id, owner_id, created_at
- `items`: id, type (file|link|note), title, category, folder_id, owner_id, is_deleted, created_at, updated_at
  - file: storage_path, original_filename, content_type, size, ext
  - link: url, link_title, link_description, link_image
  - note: blocks[], search_text

## What's been implemented (2026-02 / Feb)
- JWT auth (register/login/logout/me/refresh) with httpOnly cookies + admin seed
- 5 hard-coded categories (Finance, ESG, Claude·Chat, Claude·Co-work, Claude·Code)
- Folder CRUD with arbitrary nesting (parent_id) + cascade delete (iterative BFS) + ownership check
- Notes with full Notion-like block set: paragraph, h1/h2/h3, bullet, numbered, todo, quote, code, callout, divider, table, embed — autosave (700 ms debounce)
- File upload (PDF/DOC/DOCX/PPT/PPTX, max 50 MB) → Emergent object storage; backend-proxied download
- Web link cards with OG-based preview auto-fetch + favicon fallback
- Global search (case-insensitive across folders/items/notes) endpoint + UI
- Drag-and-drop multi-file upload zone
- Breadcrumb navigation + nested sidebar tree (iterative flattened render to avoid babel-plugin recursion crash)
- File viewer (PDF inline iframe; Office files prompt download)
- **AI deck summaries** (Claude Sonnet 4.5 via EMERGENT_LLM_KEY) — extracts text from PDF/DOCX/PPTX, generates structured Markdown summary (TL;DR / Key Topics / Main Takeaways / Glossary), result cached on item + regenerate option
- Shadcn Dialog/AlertDialog/DropdownMenu used throughout

## Test credentials
- Admin: `admin@example.com` / `admin123`

## What's tested
- 29 backend pytest tests (auth, categories, folders incl. cross-user isolation, items/notes, links w/ real preview fetch, real Emergent storage upload+download, search, unauthorized guards) — all passing after folder-delete authz fix
- Playwright E2E: login → dashboard → category → create folder → add link → create note → search → logout

## Prioritized backlog
### P1 (revenue / activation)
- Share-only links (read-only sharable URL per item)
- Multi-user workspaces / inviting collaborators
- Stripe-backed Pro plan: unlimited storage + team seats

### P2 (UX polish)
- Drag-to-reorder folders and items
- Inline rename for folders / items
- Tags + filters in addition to folders
- Bulk move (multi-select) + bulk delete
- Recently viewed / favorites pin
- PDF.js-based PPT/DOC preview rendering (currently downloads)
- Slash-command (`/`) menu inside note editor for block insertion
- AI-powered summary of uploaded slides (use EMERGENT_LLM_KEY)
- Trash bin (currently is_deleted is permanent UI-wise)
