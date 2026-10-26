# KIT — Knexus Intelligence Toolkit

A BD management tool for leading a growth team: profiles, travel planning with GSA-based cost estimates, and weekly priority check-ins.

**Stack:** Vite + React 19 + Tailwind v4 (front end) · Express 5 + SQLite via `better-sqlite3` (API) · Gemini (`@google/genai`) · MCP client (`@modelcontextprotocol/sdk`).

## Quick start

```bash
git clone https://github.com/JimmyJr77/KIT.git
cd KIT
npm install
cp .env.example .env        # set ADMIN_EMAIL / ADMIN_PASSWORD / JWT_SECRET
npm run seed                # creates the first admin (use `npm run seed:demo` to add 6 demo BD directors)
npm run dev                 # API on :3001, app on http://localhost:5173
```

Sign in with the admin's email, phone, or username (usernames are not case sensitive). Default password: `ChangeMe123!`. Change it on the Profile page.

**Production:** `npm run build && npm start` serves the built app and API from one Node process on `PORT`.

## Access model

- Only **approved** emails can sign in. Admins approve emails under **Profile → Admin · Access & team directory**.
- A newly approved person clicks **"First time? Activate your approved account"** on the login screen to set up their profile and password.
- When an email is revoked, that person is signed out on their next request.

## Features

### Profile
First name, last name, email, phone (formatted as `xxx-xxx-xxxx` while you type), username (not case sensitive), title/position, and team (BD, Operations, Technical Solutioning, Marketing, Admin). Admins also see approved accounts and the team directory, where they can change anyone's team and role.

### Travel
- **Traveler:** a single-select search box with a team filter dropdown, covering every user who has a profile.
- **General purpose:** multi-select. Options are Internal, Client, Partner, Conference, and Other.
- **Locations:** domestic trips take City and State. International trips take City, State/Province, and Country.
- **Quarter:** set automatically from Date From (calendar year), e.g. `2026 Q4`.
- **Airfare:** choose Estimated (Airfare MCP), Booked, or No Air Travel. Estimates re-run when the route or dates change. Dates default to the trip dates and can be edited.
- **Train/Tram:** a dollar amount.
- **POV:** miles × the GSA mileage rate, with an optional round trip. The GSA rate already covers fuel, so gas isn't reimbursed separately.
- **Car rental:** estimated through the Rental Car MCP using the vehicle class, location, and dates/times, or entered as booked. Dates default to the trip dates and can be edited.
- **Lodging:** priced at the GSA FY2027 rate for each location, including seasonal rates. You can add several hotels to split a stay. Each hotel can override the nightly rate.
- **M&IE:** the GSA daily rate for the location, with the first and last day at 75%. A daily breakdown and a manual override are available.
- **Refresh:** every page load and every click of **Refresh estimates** re-prices all estimated airfare and rental cars on upcoming trips.

#### GSA rates
Open **Travel → GSA rates**. Rates are looked up in this order:
1. **The imported GSA master file.** Download the FY2027 per diem master rates file from [gsa.gov per diem files](https://www.gsa.gov/travel/plan-book/per-diem-rates/per-diem-files) and save it as CSV. Then upload it in the panel (admin), or run `npm run gsa:import -- path/to/file.csv 2027`.
2. **The GSA Per Diem API**, if `GSA_API_KEY` is set. A free key is available from [api.data.gov](https://api.data.gov/signup). Results are cached for 30 days.
3. **The standard CONUS rate** from settings. The seed values are $110 lodging, $68 M&IE, and $0.725/mi POV. **Confirm these against the published FY2027 and CY2027 rates** and update them in the panel.

GSA doesn't cover international (OCONUS) locations, so those take a manual rate (State Department rates).

### Weekly Priorities
- Pick a team and its **check-in day**. The week strip scrolls left and right through past and future weeks; use the arrows, a date picker, or "This week."
- Each team member gets a lane. Lanes scroll horizontally, and a multi-select text filter narrows the board to chosen people.
- **Drag and drop** reorders cards. The left-most card (or top card, when columns are swapped) is the top priority. Dragging a card into another person's lane reassigns it.
- **Swap axes** toggles between members as rows and members as columns.
- Clicking a card or **Add priority** opens a panel on the right with: Opportunity Title, Organization, Pipeline Status, Value (ticket fields); Priority/next step, Assigned (multi), Due Date, Checklist, Notes (card fields).
- A card created on or before the check-in day counts as **planned** (blue). A card added after check-in is **new work** (amber).
- Past weeks are read-only history.

#### Tickets vs. priority cards
A **ticket** is the larger assignment or opportunity. A **priority card** is one weekly step against a ticket. Adding a priority either opens a **new ticket** or links to an **existing ticket**. `GET /api/priorities/tickets?sort=opportunity_title|organization|pipeline_status|value|due_date` already supports sorting, ready for the upcoming tickets/pipeline view.

## Integrations

All integrations are configured in `.env`. **Profile → Integrations** shows which ones are live. Without them the app still works: estimates are clearly labeled as placeholders.

| Integration | Env vars | Notes |
|---|---|---|
| Gemini | `GEMINI_API_KEY`, `GEMINI_MODEL` | Key from [Google AI Studio](https://aistudio.google.com/apikey). Turns raw MCP results into structured estimates; `/api/ai/ask` is a general endpoint. |
| Airfare MCP | `AIRFARE_MCP_URL`, `AIRFARE_MCP_TOOL` (`search_flights`), `AIRFARE_MCP_HEADERS` | Any remote MCP server (Streamable HTTP or SSE). Queries follow the blueprint in `server/prompts/airfare.md`. |
| Rental Car MCP | `RENTALCAR_MCP_URL`, `RENTALCAR_MCP_TOOL` (`find_car_rental_offerings`), `RENTALCAR_MCP_HEADERS` | Blueprint in `server/prompts/rentalCar.md`. |
| GSA Per Diem API | `GSA_API_KEY` | Optional; the CSV import is enough on its own. |

How an estimate is produced: the query is built from the prompt's blueprint (e.g. *"Find a round-trip flight from Washington, DC to Denver, CO departing on November 10, 2026 and returning on November 13, 2026."*). The server then calls the MCP tool, and Gemini, using your prompt as its system instruction, pulls out the lowest price, price band, airlines, and non-stop/layover (or, for cars, the total, daily rate, suppliers, and what's included). Code: `server/services/estimators.js`.

### Google Workspace + Gemini: feasibility
This can be done, in stages:
1. **Gemini API (done):** plug in a key.
2. **Google sign-in:** add Google OAuth restricted to the company domain, and keep the approved-accounts check.
3. **Company data:** with OAuth scopes for Drive, Docs, Calendar, and Gmail, the server can fetch the files a user is allowed to see and pass them to Gemini as context. Calendar is a natural fit for pre-filling travel.
4. **Enterprise option:** if Knexus licenses Gemini for Workspace or Gemini Enterprise, its connectors can search across company data without custom retrieval code.

## Project layout

```
server/
  index.js              Express app (serves dist/ in production)
  db.js                 SQLite schema + settings (only place SQL lives besides routes)
  auth.js               JWT cookie sessions, email/phone/username login
  routes/               auth, users, teams, travel, gsa, priorities, ai
  services/             gsa.js (rates + CSV import), estimators.js, mcp.js, gemini.js
  prompts/              Airfare + Rental Car MCP system prompts
  scripts/              seed.js, importGsa.js
src/
  lib/travelCalc.js     Trip cost math (shared by client and server)
  pages/                Login, Profile, Travel, TripForm, WeeklyPriorities, PriorityPanel
  components/           Layout, pickers (UserCombobox, MultiSelect, LocationInput)
```

## Migrating off SQLite
The database is one file, `server/data/kit.db` (gitignored). All SQL is in `server/`, and the schema is in `server/db.js`. To move to Postgres (e.g. Supabase, Neon, Cloud SQL), port the schema, replace `better-sqlite3` calls with `pg` (or Prisma/Drizzle), and switch the JSON text columns to `jsonb`. The React app doesn't change.

## Roadmap
- Tickets / qualified pipeline view with sorting by Opportunity Title, Organization, Assigned, Due Date, Pipeline Status, Value
- Carry unfinished priorities forward to the next week
- Google sign-in + Workspace grounding
- Automatic POV mileage via a maps API
