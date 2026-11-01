# TradUp

FastAPI + vanilla JS dashboard. Email/password auth (bcrypt + JWT cookie), Google OAuth,
per-user holdings and watchlist, live prices (Yahoo Finance; Colombo prices and daily history from the unofficial cse.lk API), and a forecast/signal view.

## Run locally
    python -m venv .venv && source .venv/bin/activate
    pip install -r requirements.txt
    cp .env.example .env   # then: export $(cat .env | xargs)
    uvicorn main:app --reload

## Deploy free on Render
1. Create a free Postgres at https://neon.tech and copy its connection string (Render's free Postgres expires after 30 days; SQLite would be wiped on every restart).
2. Push this folder to GitHub, then in Render: New > Blueprint (uses render.yaml), or New > Web Service.
3. Set env vars: DATABASE_URL, PUBLIC_URL (https://YOUR-APP.onrender.com), GOOGLE_CLIENT_ID/SECRET.
   SECRET_KEY is generated automatically.
4. Google Cloud Console > APIs & Services > Credentials > OAuth client (Web).
   Authorized redirect URI: https://YOUR-APP.onrender.com/auth/google/callback
   (add http://localhost:8000/auth/google/callback for local testing).

Notes: free Render services sleep after ~15 min idle (first request takes ~30s). Prices are shown in each asset's native
currency (USD for US stocks, LKR for CSE) and are not converted when totalled.
