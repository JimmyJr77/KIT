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

## Deploy to Vercel + Render

Use Node 22 (`nvm use`). Vercel hosts the React frontend; Render runs Express with a persistent disk for SQLite and uploaded documents. Browser requests stay on the Vercel origin: `/api/*` is proxied to Render, preserving the existing secure, HTTP-only login cookies without cross-origin cookie settings.

1. Push the intended app version and deployment files to the GitHub repository. Both providers must deploy the same revision.
2. In Render, create a **Blueprint** from this repository using `render.yaml`. It provisions a paid **Starter** web service and a **1 GB persistent disk**. Review the cost in Render before creating it. Set `ADMIN_EMAIL` and a unique `ADMIN_PASSWORD` (at least 12 characters) in Render's secure setup form. `JWT_SECRET` is generated automatically. Never use the example credentials in production.
3. Render runs `npm ci --omit=dev`, then `npm run start:render`. Startup creates the admin only if that email does not exist, initializes the database, and imports the bundled GSA rates. Seeding runs at startup because the disk is not available during builds or pre-deploy commands. Redeploys preserve existing users and passwords; changing `ADMIN_PASSWORD` later does not reset an existing account.
4. Wait for Render's `/api/health` endpoint to return `{"status":"ok"}`. Copy the actual service origin from its dashboard (the assigned hostname may differ from the service name).
5. Import this repository into the intended Vercel team. Use the repository root, **Other** framework preset, Node **22.x**, and the commands in `vercel.json`. Leave Output Directory unset: the build generates `.vercel/output` using Vercel's Build Output API.
6. In Vercel, set `RENDER_API_URL` to that HTTPS origin, for example `https://your-kit-service.onrender.com`, with no `/api` suffix. Set it for Production and, if desired, Preview. Redeploy after changing it; this value is baked into the proxy configuration. Preview deployments using the production backend share production data; use a separate Render service and disk for isolated testing.
7. Deploy Vercel, sign in, refresh a nested page, and verify a ticket attachment can be uploaded and downloaded. Check `/api/health` through the Vercel URL as well as directly on Render.

Render stores the database at `/var/data/kit.db` and attachments at `/var/data/uploads`. Keep the service at one instance because SQLite and the disk are local to that instance. The disk does not cover bundled source data, so airport and GSA datasets continue to update with deploys. Back up SQLite with its backup API (or stop writes before copying the database and its WAL files) and preserve uploaded files alongside it. A new deployment starts with an empty database; it does **not** copy local users, tickets, or attachments automatically.

Integration secrets (`GEMINI_API_KEY`, `GSA_API_KEY`, and any MCP authentication headers) belong only in Render environment variables. `render.yaml` declares `GEMINI_API_KEY` and `GSA_API_KEY` without values (`sync: false`): add their values in the Render dashboard under the service's **Environment**. Rental cars use OctoTrip's free rental-car MCP server (`RENTALCAR_MCP_URL=https://mcp.octotrip.app/rental-cars/mcp`, tool `search`), which needs no key; KIT asks for USD prices and spaces searches about a second apart to stay under its rate limit. Do not put secrets in `VITE_*` variables or commit `.env`. API responses are marked `private, no-store` to keep authenticated data out of shared caches.

### Pipedrive in production

1. In Render, open the service's **Environment** and add `PIPEDRIVE_API_KEY` with the API token from Pipedrive (Settings → Personal preferences → API). Use an admin's token so every deal is visible. Add `PIPEDRIVE_WEBHOOK_SECRET` too, using Render's **Generate** button for its value. Render asks for `sync: false` values only when a Blueprint is first created, so variables added to `render.yaml` later must be added by hand like this. Admin Access › Pipedrive names the service to use while the token is missing.
2. Redeploy. KIT pulls everything from Pipedrive every night at 2 a.m. server time, and refreshes Projects and field definitions every ten minutes. To bring everything in right away, an admin selects **Sync now** in Admin Access › Pipedrive.
3. Live updates follow the sync direction: whenever Pipedrive → KIT is part of the sync, the production server registers webhooks in Pipedrive for deals, activities, notes, people, organizations, pipelines and stages, pointed at `https://<Render address>/api/pipedrive/webhook` (set `PUBLIC_URL` to use another HTTPS address), and removes them when it isn't (checked at startup, when the direction changes, and hourly). Pipedrive signs in with HTTP Basic auth: user `pipedrive` and the webhook secret. A few seconds after a change, KIT pulls just the deals it touched. The Sync section shows whether live updates are on, events received and the last live update.

**Two-way only in production.** Only the production server (NODE_ENV=production on Render, or another production host with `PIPEDRIVE_TWO_WAY=1`) ever writes to Pipedrive: the API layer refuses every write from anywhere else, so a local or test server pulls from Pipedrive and never changes it, whatever an admin turns on. (`PIPEDRIVE_PUSH` no longer does anything.)

**What stays the same on both sides.** A Pipedrive deal is a pipeline ticket, and everything on it has a home in KIT:

| In Pipedrive | In KIT |
|---|---|
| Title, value, stage, owner, expected close date, probability, lost reason | The ticket (top of the ticket, and Deal details) |
| Won / lost | The ticket's Won and Lost buttons. Only a **won** deal is a contract in Delivery; a deal sitting in an "Awarded" stage is still open until it's won. |
| Account | Territory |
| Every custom deal field (Capability Area, Opportunity Type, Google Deal, Google FSR, Knexus IP Utilization, RFP release date, Proposal Due Date, Prime or Sub, Prime Contractor, Expected Contract Term, NAICS, GovWin Link, …) | Deal details › Summary and Details, laid out as in Pipedrive, with Pipedrive's options. A field or option added in Pipedrive shows up in KIT on its own. |
| Source origin, channel, channel ID | Deal details › Source |
| Contact person and participants (first name, last name, title, labels, work phone and email) | People, and Deal details › Person |
| Organization (address, labels, website, LinkedIn, industry, annual revenue, employees) | Deal details › Organization |
| Products and installments | Deal details › Products and Installments |
| Labels, followers, activities, notes, files | Tags, followers, activities, notes and documents on the ticket |
| Projects: overview, status, phase, dates, owner, labels, plan (tasks, subtasks and activities), notes, files | Delivery: the won contract's project section, plan, project notes and documents. Marking a contract Complete completes the project, and the other way round. |

**Direction.** Admin Access › Pipedrive › Sync sets which way the sync runs: no sync (the default on a fresh install: nothing is pulled or sent until an admin chooses), two way, Pipedrive → KIT only, KIT → Pipedrive only (nothing is pulled, not even live updates), or selective (each kind of KIT change set to Auto, On push or Off). An install that had already synced deals before this choice existed stays two way. Choosing a direction first shows what its first sync would add and delete on each side (new and deleted deals and files from Pipedrive; everything waiting to go to Pipedrive) and asks for approval; on approval the first sync starts, and the direction stays set until an admin changes it. The active card is shaded; the one awaiting approval has the blue outline. **Sync now** pulls everything and then sends everything waiting, as the direction allows.

**Conflicts.** A shared field changed in both KIT and Pipedrive since the last pull is never overwritten by a send. It's kept in Admin Access › Pipedrive › Conflicts with both versions, pulls leave it as found, and an admin settles it one at a time, by selection, or all at once: KIT wins (KIT's value goes to Pipedrive with the next auto sync or push) or Pipedrive wins (Pipedrive's value is written into KIT). Files deleted on one side are always deleted on the other; when a pull finds 20 or more of KIT's files deleted in Pipedrive at once, they're held instead, every admin is alerted, and an admin either deletes them in KIT or keeps them as KIT's own files (a ticket whose deal is gone from Pipedrive then becomes a KIT-only ticket on the KIT pipeline). Every delete in KIT that also deletes the record in Pipedrive says so before it happens.

Pipedrive wins on its own fields, except fields changed in KIT that haven't gone yet. KIT's own work on a ticket (priorities, strategy, assessments) is kept. What's deleted in Pipedrive is deleted in KIT (notes, activities, files, products, tasks); a deal deleted or archived in Pipedrive is archived in KIT, never deleted. KIT → Pipedrive goes on its own about a minute after a change, for every kind of change (deletions too), unless an admin sets a kind to On push or Do not send in Admin Access › Pipedrive. A contract without a Pipedrive project can have one made from Delivery. **Do the numbers match?** in the same panel reads Pipedrive's open, won and lost counts and values next to KIT's.

To check the frontend deployment output locally:

```bash
RENDER_API_URL=https://your-kit-service.onrender.com npm run build:vercel
```

This validates the URL and builds the static app plus API proxy rules; it does not deploy or contact that example backend. Local `npm run dev` and the single-server `npm run build && npm start` workflow still work.

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
- **Airfare:** choose Estimated (Airfare MCP), Booked, or No Air Travel. Estimates re-run when the route or dates change. Dates default to the trip dates and can be edited. Each trip can also set its earliest and latest departure (default 10am–8pm) and max layovers (default direct); these apply each way. Set your own defaults for new trips under **Settings** on the Travel page.
- **Train/Tram:** a dollar amount.
- **POV:** miles × the GSA mileage rate, with an optional round trip. The GSA rate already covers fuel, so gas isn't reimbursed separately.
- **Car rental:** estimated through the Rental Car MCP using the vehicle class, location, and dates/times, or entered as booked. Dates default to the trip dates and can be edited.
- **Lodging:** priced at the GSA FY2027 rate for each location, including seasonal rates. You can add several hotels to split a stay. Each hotel can override the nightly rate.
- **M&IE:** the GSA daily rate for the location, with the first and last day at 75%. A daily breakdown and a manual override are available.
- **Refresh:** every page load and every click of **Refresh estimates** re-prices all estimated airfare and rental cars on upcoming trips.

#### GSA rates
The FY2027 GSA per diem file (`server/data/gsa/FY2027_PerDiemRates.csv`) ships with the repo. It **loads automatically** the first time the server starts, covering 641 rate rows plus the standard CONUS rate ($113 lodging / $68 M&IE). Lookups go in this order:
1. **The GSA file.** It matches on destination city first, then on the counties GSA lists. It also handles cross-state coverage (e.g. Arlington and Fairfax, VA and Montgomery and Prince George's, MD use the District of Columbia rate) and common DC-metro suburbs such as Bethesda, Tysons and Reston. Seasonal rates are applied per night. For a future year, upload the new CSV in **Travel → GSA rates** (admin) or run `npm run gsa:import -- path/to/file.csv 2028`.
2. **The GSA Per Diem API**, if `GSA_API_KEY` is set. It's optional and cached for 30 days.
3. **The standard CONUS rate.**

The POV mileage rate is set separately each calendar year and is seeded at $0.725/mi. **Confirm the 2027 rate** and update it in the panel.

GSA doesn't cover international (OCONUS) locations, so those take a manual rate (State Department rates).

### Delivery
Won contracts. A pipeline ticket becomes a contract the moment its deal is marked **won** (on the ticket, on the BD Pipeline board's last column, or in Pipedrive), and comes with its Pipedrive project: overview, phase on the Delivery board, dates, owner, labels, the plan (tasks with subtasks, and activities, ticked off on either side), project notes, documents, and the deal's payment schedule. A contract whose deal is reopened or lost goes on hold until an admin keeps or deletes it.

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
| Airfare MCP | `SKIPLAGGED_MCP_URL`, `AIRFARE_MCP_URL`, `AIRFARE_MCP_TOOL`, `AIRFARE_MCP_HEADERS` | **Used by default:** Skiplagged's public server (`https://mcp.skiplagged.com/mcp`) goes first, with no key; set `SKIPLAGGED_MCP_URL` empty to turn it off. **Backup:** Kiwi.com's official server (`https://mcp.kiwi.com`, tool `search-flight`), also free with no key. Any other MCP server also works as the backup. |
| Rental Car MCP | `RENTALCAR_MCP_URL`, `RENTALCAR_MCP_TOOL`, `RENTALCAR_MCP_HEADERS` | **Not configured.** No free rental-car MCP with US coverage has been found yet (see below). |
| GSA Per Diem API | `GSA_API_KEY` | Optional; the CSV import is enough on its own. |

**How airfare is estimated (Skiplagged):** KIT searches each direction as its own one-way, because Skiplagged's time filter only covers the outbound leg, and adds the two fares. Hidden-city and self-connected tickets are off, and budget airlines are used only when no full-service airline fits. On international trips the sum can run higher than a real round-trip ticket, and the estimate says so. Skiplagged rate-limits heavy use, so KIT moves to the backup when it's blocked or finds nothing.

**How airfare is estimated (Kiwi.com, the backup):** the trip's cities are converted to airport codes. Denver, CO becomes DEN and its other airfields. Washington, DC and its suburbs (Arlington, Bethesda, Tysons and others) become DCA, IAD and BWI. London becomes LHR, LGW, STN and the rest. Cities with no airport of their own use the airports within 120 km. You can also type codes such as `DCA` into Origin/Destination. KIT runs two searches in parallel, the cheapest fares and non-stops only (or the trip's own departure times and layover limit). It reports the lowest fare, the typical price band, airlines, non-stop vs layover, whether a carry-on is included, and a booking link. Kiwi doesn't sell every airline (for example, it lacks British Airways' IAD–LHR non-stops), so treat its non-stop price as a floor.

The airport data is `server/data/airports.json`, built from [mwgg/Airports](https://github.com/mwgg/Airports) (MIT) by `server/scripts/buildAirports.js`.

**Other MCP servers:** for any other airfare or rental-car server, KIT builds the natural-language query from your prompt's blueprint. Gemini then reads the tool's response, using your prompt as its system instruction. Code: `server/services/estimators.js`.

**Safety:** KIT only calls search tools. `server/services/mcp.js` refuses any tool whose name suggests booking, payment or sending messages. That covers Kiwi's `feedback-to-devs` and Upfront Rentals' `create_reservation` and `contact_upfront_rentals`.

**Rental cars:** [Upfront Rentals' MCP](https://mcpservers.org/servers/upfront-rentals-mcp) was evaluated and rejected. Its 121 pickup locations are all in Greece, Mexico, Italy, and Eastern Europe, and test searches returned no offers. Until a US-capable provider is added, car estimates are labelled placeholders, or you can enter a booked amount.

**Cloud sessions only:** Node's `fetch` ignores `HTTPS_PROXY`. Inside a proxied cloud container, start the app with `NODE_USE_ENV_PROXY=1 npm run dev`. This isn't needed on a normal computer.

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
