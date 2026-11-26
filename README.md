# Saans — GenAI-Powered Winter Smog Assistant (v2)

**Saans** transforms air quality readings and household profiles into personalized, scientifically grounded daily decisions — balancing **personal exposure** (what you breathe) against **environmental emissions** (what you contribute).

Built with a zero-dependency full-stack architecture (**Node.js 24+, built-in `node:sqlite`, HTML, CSS, JavaScript**) so the entire demo runs reliably offline out of the box, with optional live **Open-Meteo / CAMS** forecasts and **OpenAI** response synthesis.

---

## Quick Start

1. Ensure **Node.js 24 or newer** is installed (`node -v`).
2. Run the server:
   ```bash
   npm start
   ```
   *(On Windows PowerShell, if `npm` script execution is restricted, run `node --env-file-if-exists=.env server.mjs` or `npm.cmd start`.)*
3. Open [http://localhost:3000](http://localhost:3000).
4. Run the automated unit + HTTP/SQLite integration test suite:
   ```bash
   npm test
   ```
   *(Or `node --test`.)*

No `npm install` or API keys are required. SQLite automatically creates `data/saans.sqlite` on startup.

---

## Features Implemented

- **Air Quality Dashboard**: CPCB 6-band scale & dynamic marker across 10 Indian cities (`Delhi`, `Noida`, `Gurugram`, `Patna`, `Lucknow`, `Kolkata`, `Nagpur`, `Mumbai`, `Pune`, `Bengaluru`), manual CPCB AQI override with 2-hour staleness detection, and 24-hour PM2.5 diurnal forecast with best-window & inversion insights.
- **Personalized Daily Planner**: 4 time-of-day blocks synchronized with forecast dispersion windows plus 5 evidence-linked action cards with persistent daily completion tracking.
- **Indoor Air Advisor**: Clean-air readiness score and filterable guidance (`₹0 Habits`, `Low-Cost / DIY`, `Appliances`) tailored to cooking fuel (solid fuel, gas, electric) and available equipment (HEPA purifier, kitchen exhaust, N95 masks, AC).
- **Sustainable Commute Planner, Impact Calculator & Tracker**:
  - Deterministic India GHG Program operating CO₂ calculator (daily, 22-day monthly, 240-day annual, petrol & tree-day equivalents).
  - Qualitative **dual-impact exposure check** that warns when a low-CO₂ switch (e.g., car → cycling) increases inhaled PM2.5 during Poor/Severe smog.
  - Clickable Smart Commute Matrix ranked for today's AQI.
  - Persistent SQLite-backed commute log with cumulative stats and per-trip removal.
- **Ask Saans Assistant**: Multi-turn evidence-grounded Q&A covering outdoor play, vulnerable groups, budget indoor air, ventilation timing, N95 masks, winter inversions, and medical safety guardrails (urgent symptoms & clinical boundaries).
- **Community Clean-Air Action Builder**: Audience-specific templates (`RWA / Society`, `School & Parents`, `Workplace`) with persistent pledges and privacy-safe clipboard copy / `.txt` export.
- **SDG & Research Context**: Aligned with **SDG 3** (Health), **SDG 11** (Sustainable Cities), and **SDG 13** (Climate Action).

---

## Optional Live Integrations

Copy `.env.example` to `.env` and restart:

- `LIVE_FORECAST=1` — Fetches 24-hour PM2.5 forecasts from the **Open-Meteo / CAMS Air Quality API** (`Asia/Kolkata`), falling back gracefully to simulated diurnal data if offline.
- `OPENAI_API_KEY=...` — Enables opt-in **OpenAI Responses API** synthesis (`OPENAI_MODEL=gpt-4.1-mini` by default) grounded strictly in your city/AQI context and curated scientific guidance (no personal identifiers are sent).
- `PORT=3000` — Changes the local server port.

---

## API Overview

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/meta` | `GET` | Cities, transport factors, CPCB bands, sources, community templates |
| `/api/profile` | `GET`, `PUT` | Load or update session household profile & hydrated plan |
| `/api/forecast` | `GET` | 24-hour PM2.5 series (`?city=...&live=0\|1`) |
| `/api/impact` | `POST` | Compute deterministic CO₂ delta + exposure trade-off |
| `/api/trips` | `GET`, `POST`, `DELETE` | List, log, or clear persistent commute switches |
| `/api/trips/:id` | `DELETE` | Delete a single logged trip in the current session |
| `/api/checklist` | `PUT` | Persist daily action checklist completion |
| `/api/pledges` | `PUT` | Persist selected community pledges |
| `/api/ask` | `POST` | Evidence-grounded Q&A with safety guardrails & optional OpenAI synthesis |
