import os, re, secrets, threading, datetime as dt
import bcrypt, jwt
from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session
from authlib.integrations.starlette_client import OAuth

import market
from db import Base, engine, get_db, User, Holding, Watch

SECRET = os.getenv("SECRET_KEY") or secrets.token_hex(32)  # set SECRET_KEY in production
PUBLIC_URL = os.getenv("PUBLIC_URL", "").rstrip("/")
GOOGLE = bool(os.getenv("GOOGLE_CLIENT_ID") and os.getenv("GOOGLE_CLIENT_SECRET"))

app = FastAPI(title="TradUp", docs_url=None, redoc_url=None)
app.add_middleware(SessionMiddleware, secret_key=SECRET, session_cookie="oauth_session", same_site="lax", max_age=900)
app.mount("/static", StaticFiles(directory="static"), name="static")
Base.metadata.create_all(engine)
threading.Thread(target=market.cse_directory, daemon=True).start()   # warm the Colombo name list

oauth = OAuth()
if GOOGLE:
    oauth.register("google", client_id=os.environ["GOOGLE_CLIENT_ID"], client_secret=os.environ["GOOGLE_CLIENT_SECRET"],
                   server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
                   client_kwargs={"scope": "openid email profile"})


# ---------- auth helpers ----------
def hash_pw(p: str) -> str:
    return bcrypt.hashpw(p.encode()[:72], bcrypt.gensalt()).decode()


def check_pw(p: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(p.encode()[:72], h.encode())
    except Exception:
        return False


def with_session(resp, request: Request, uid: int):
    token = jwt.encode({"sub": str(uid), "exp": dt.datetime.utcnow() + dt.timedelta(days=7)}, SECRET, algorithm="HS256")
    resp.set_cookie("session", token, httponly=True, samesite="lax", max_age=7 * 86400,
                    secure=request.url.scheme == "https")
    return resp


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    t = request.cookies.get("session")
    if not t:
        raise HTTPException(401, "Not signed in")
    try:
        uid = int(jwt.decode(t, SECRET, algorithms=["HS256"])["sub"])
    except Exception:
        raise HTTPException(401, "Session expired")
    u = db.get(User, uid)
    if not u:
        raise HTTPException(401, "Unknown user")
    return u


def udict(u: User):
    return {"id": u.id, "name": u.name, "email": u.email, "avatar": u.avatar}


class SignupIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/api/config")
def config():
    return {"google": GOOGLE}


@app.post("/api/signup")
def signup(body: SignupIn, request: Request, db: Session = Depends(get_db)):
    email = body.email.lower()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(400, "An account with this email already exists")
    u = User(email=email, name=body.name.strip(), password_hash=hash_pw(body.password))
    db.add(u); db.commit()
    return with_session(JSONResponse(udict(u)), request, u.id)


@app.post("/api/login")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    u = db.query(User).filter(User.email == body.email.lower()).first()
    if u and not u.password_hash:
        raise HTTPException(400, "This account uses Google sign-in")
    if not u or not check_pw(body.password, u.password_hash):
        raise HTTPException(400, "Incorrect email or password")
    return with_session(JSONResponse(udict(u)), request, u.id)


@app.post("/api/logout")
def logout():
    r = JSONResponse({"ok": True})
    r.delete_cookie("session")
    return r


@app.get("/api/me")
def me(u: User = Depends(current_user)):
    return udict(u)


@app.get("/auth/google/login")
async def google_login(request: Request):
    if not GOOGLE:
        raise HTTPException(404)
    redirect = f"{PUBLIC_URL}/auth/google/callback" if PUBLIC_URL else str(request.url_for("google_callback"))
    return await oauth.google.authorize_redirect(request, redirect)


@app.get("/auth/google/callback")
async def google_callback(request: Request, db: Session = Depends(get_db)):
    try:
        token = await oauth.google.authorize_access_token(request)
    except Exception:
        return RedirectResponse("/login?error=Google+sign-in+failed")
    info = token.get("userinfo") or {}
    email = (info.get("email") or "").lower()
    if not email or not info.get("email_verified", False):
        return RedirectResponse("/login?error=Google+email+not+verified")
    u = db.query(User).filter((User.google_id == info["sub"]) | (User.email == email)).first()
    if u:
        u.google_id, u.avatar = info["sub"], info.get("picture") or u.avatar
    else:
        u = User(email=email, name=info.get("name") or email.split("@")[0], google_id=info["sub"], avatar=info.get("picture"))
        db.add(u)
    db.commit()
    return with_session(RedirectResponse("/"), request, u.id)


# ---------- pages ----------
@app.get("/")
def index(request: Request, db: Session = Depends(get_db)):
    try:
        current_user(request, db)
    except HTTPException:
        return RedirectResponse("/login")
    return FileResponse("static/index.html")


@app.get("/login")
def login_page():
    return FileResponse("static/login.html")


# ---------- portfolio ----------
class HoldingIn(BaseModel):
    symbol: str = Field(min_length=1, max_length=20)
    shares: float = Field(gt=0)
    buy_price: float = Field(gt=0)
    buy_date: dt.date | None = None
    cse: bool = False


class WatchIn(BaseModel):
    symbol: str = Field(min_length=1, max_length=20)
    cse: bool = False


def cur_of(sym: str) -> str:
    return "LKR" if market.is_cse(sym) else "USD"


@app.get("/api/holdings")
def holdings(currency: str | None = None, u: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.query(Holding).filter(Holding.user_id == u.id).order_by(Holding.id).all()
    syms = sorted({h.symbol for h in rows})
    q = dict(zip(syms, market.parallel(market.quote, syms)))
    out = []
    for h in rows:
        qq = q.get(h.symbol)
        price = qq["price"] if qq else h.buy_price
        prev = qq["prev"] if qq else price
        c, v = h.shares * h.buy_price, h.shares * price
        out.append({"id": h.id, "symbol": h.symbol, "name": h.name, "sector": h.sector, "shares": h.shares,
                    "buy_price": h.buy_price, "buy_date": h.buy_date.isoformat(), "price": price,
                    "currency": cur_of(h.symbol), "day": h.shares * (price - prev),
                    "day_change_pct": qq["change_pct"] if qq else 0, "value": v, "cost": c, "pl": v - c,
                    "pl_pct": (v / c - 1) * 100 if c else 0})
    avail = sorted({o["currency"] for o in out})
    if currency not in avail and avail:   # mixed holdings: default to the currency with more invested
        currency = max(avail, key=lambda k: sum(o["cost"] for o in out if o["currency"] == k))
    sel = [o for o in out if o["currency"] == currency]
    cost, value, day = sum(o["cost"] for o in sel), sum(o["value"] for o in sel), sum(o["day"] for o in sel)
    pl = value - cost
    return {"holdings": out, "summary": {"cost": cost, "value": value, "pl": pl, "pl_pct": pl / cost * 100 if cost else 0,
            "day": day, "day_pct": day / (value - day) * 100 if value - day else 0,
            "currency": currency or "USD", "currencies": avail}}


@app.post("/api/holdings")
def add_holding(b: HoldingIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    sym = market.normalize(b.symbol, b.cse)
    if market.quote(sym) is None:
        raise HTTPException(400, market.LAST_ERR.get(sym) or f"Could not find market data for {sym}")
    i = market.info(sym)
    db.add(Holding(user_id=u.id, symbol=sym, name=i["name"], sector=i["sector"], shares=b.shares,
                   buy_price=b.buy_price, buy_date=b.buy_date or dt.date.today()))
    db.commit()
    return {"ok": True}


class ImportRow(BaseModel):
    symbol: str = Field(min_length=1, max_length=80)
    shares: float = Field(gt=0)
    buy_price: float = Field(gt=0)
    buy_date: dt.date | None = None


class ImportIn(BaseModel):
    rows: list[ImportRow] = Field(min_length=1, max_length=200)
    default_date: dt.date
    replace: bool = False
    mode: str = "auto"          # auto | cse | global
    dry_run: bool = False


def resolve_symbol(raw: str, mode: str):
    """Work out which market a spreadsheet entry belongs to. Returns (symbol, quote, via, error)."""
    s = raw.strip().upper()
    tickerish = bool(re.match(r"^[A-Z0-9]{1,8}(\.[A-Z0-9]{1,6})?$", s))
    if mode == "cse":
        cands = [market.normalize(s, True)] if tickerish else []
    elif mode == "global":
        cands = [s]
    else:
        n = market.normalize(s, False)
        if market.is_cse(n):
            cands = [n]
        elif not tickerish:
            cands = []
        else:
            cands = [market.normalize(s, True), s]   # Sri Lankan first: the CSE feed rejects non-CSE codes
    for c in cands:
        q = market.quote(c)
        if q:
            return c, q, "ticker", None
    err = None
    if mode != "global":                              # a company name, or a short/old Colombo code
        sym, _, err = market.find_cse_by_name(raw)
        if sym:
            q = market.quote(sym)
            if q:
                return sym, q, "name", None
    if mode != "cse":
        for hit in market.search(raw.strip())[:2]:
            c = hit["symbol"].upper()
            q = market.quote(c)
            if q:
                return c, q, "name", None
    return None, None, None, err or "No live market data found for this entry"


@app.post("/api/holdings/import")
def import_holdings(b: ImportIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    prepared = market.parallel(lambda r: resolve_symbol(r.symbol, b.mode), b.rows)
    items = [{"input": r.symbol, "symbol": p[0], "name": (p[1] or {}).get("name"), "price": (p[1] or {}).get("price"),
              "currency": cur_of(p[0]) if p[0] else None, "via": p[2], "error": p[3]}
             for r, p in zip(b.rows, prepared)]
    if b.dry_run:
        return {"items": items}
    good = [(r, p[0]) for r, p in zip(b.rows, prepared) if p[0]]
    infos = market.parallel(lambda g: market.info(g[1]), good)
    if b.replace and good:
        syms = {g[1] for g in good}
        for h in db.query(Holding).filter(Holding.user_id == u.id, Holding.symbol.in_(syms)).all():
            db.delete(h)
    for (r, sym), i in zip(good, infos):
        db.add(Holding(user_id=u.id, symbol=sym, name=i["name"], sector=i["sector"], shares=r.shares,
                       buy_price=r.buy_price, buy_date=r.buy_date or b.default_date))
    db.commit()
    return {"added": len(good), "failed": [{"symbol": i["input"], "error": i["error"]} for i in items if i["error"]]}


@app.get("/api/forecast/portfolio")
def portfolio_forecast(days: int = 30, u: User = Depends(current_user), db: Session = Depends(get_db)):
    days = max(7, min(days, 90))
    rows = db.query(Holding).filter(Holding.user_id == u.id).all()
    shares, names = {}, {}
    for h in rows:
        shares[h.symbol] = shares.get(h.symbol, 0) + h.shares
        names[h.symbol] = h.name
    syms = sorted(shares)
    out, totals = [], {}
    for s, f in zip(syms, market.parallel(lambda s: market.forecast(s, days), syms)):
        if not f:
            out.append({"symbol": s, "name": names[s], "error": market.LAST_ERR.get(s) or "Not enough price history"})
            continue
        o, sh = f["outlook"], shares[s]
        exp = f["forecast"][-1]["yhat"]
        cur = "LKR" if market.is_cse(s) else "USD"
        out.append({"symbol": s, "name": names[s], "shares": sh, "currency": cur, "last": o["last"], "expected": exp,
                    "expected_pct": o["expected_pct"], "low": o["range_low"], "high": o["range_high"], "signal": o["signal"]})
        t = totals.setdefault(cur, {"value": 0.0, "expected": 0.0, "low": 0.0, "high": 0.0})
        t["value"] += sh * o["last"]; t["expected"] += sh * exp
        t["low"] += sh * o["range_low"]; t["high"] += sh * o["range_high"]
    return {"days": days, "items": out, "totals": totals}


@app.delete("/api/holdings/{hid}")
def del_holding(hid: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    h = db.get(Holding, hid)
    if not h or h.user_id != u.id:
        raise HTTPException(404)
    db.delete(h); db.commit()
    return {"ok": True}


@app.get("/api/portfolio/history")
def portfolio_history(days: int = 90, currency: str | None = None, u: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.query(Holding).filter(Holding.user_id == u.id).all()
    if currency:
        rows = [h for h in rows if cur_of(h.symbol) == currency]
    return market.portfolio_series(rows, max(7, min(days, 730)))


@app.get("/api/watchlist")
def watchlist(u: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.query(Watch).filter(Watch.user_id == u.id).order_by(Watch.id).all()

    def card(w):
        df = market.history(w.symbol, 1)
        if df is None or df.empty:
            q = market.quote(w.symbol)   # e.g. CSE stocks: live quote only, no history
            if not q:
                return None
            return {"id": w.id, "symbol": w.symbol, "name": w.name, "price": q["price"], "price_then": q["prev"],
                    "start": q["date"], "end": q["date"], "change_pct": q["change_pct"], "day_change_pct": q["change_pct"]}
        last = df.iloc[-1]
        past = df[df["Date"] <= last["Date"] - dt.timedelta(days=30)]
        first = past.iloc[-1] if not past.empty else df.iloc[0]
        prev = df["Close"].iloc[-2] if len(df) > 1 else last["Close"]
        p0, p1 = float(first["Close"]), float(last["Close"])
        return {"id": w.id, "symbol": w.symbol, "name": w.name, "price": p1, "price_then": p0,
                "start": first["Date"].strftime("%Y-%m-%d"), "end": last["Date"].strftime("%Y-%m-%d"),
                "change_pct": (p1 / p0 - 1) * 100 if p0 else 0, "day_change_pct": (p1 / float(prev) - 1) * 100}
    return [c for c in market.parallel(card, rows) if c]


@app.post("/api/watchlist")
def add_watch(b: WatchIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    sym = market.normalize(b.symbol, b.cse)
    if market.quote(sym) is None:
        raise HTTPException(400, market.LAST_ERR.get(sym) or f"Could not find market data for {sym}")
    if db.query(Watch).filter(Watch.user_id == u.id, Watch.symbol == sym).first():
        raise HTTPException(400, f"{sym} is already on your watchlist")
    db.add(Watch(user_id=u.id, symbol=sym, name=market.info(sym)["name"]))
    db.commit()
    return {"ok": True}


@app.delete("/api/watchlist/{wid}")
def del_watch(wid: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    w = db.get(Watch, wid)
    if not w or w.user_id != u.id:
        raise HTTPException(404)
    db.delete(w); db.commit()
    return {"ok": True}


# ---------- market ----------
@app.get("/api/market/overview")
def overview(u: User = Depends(current_user)):
    def one(p):
        q = market.quote(p[0])
        return {"symbol": p[0], "name": p[1], **q} if q else None
    return [r for r in market.parallel(one, market.OVERVIEW) if r]


@app.get("/api/cse/directory")
def cse_dir(q: str = "", u: User = Depends(current_user)):
    """Diagnostics: how many Colombo companies are known, and what a name resolves to."""
    d = market.cse_directory()
    out = {"companies": len(d), "with_names": sum(1 for v in d.values() if v)}
    if q:
        sym, name, err = market.find_cse_by_name(q)
        out["match"] = {"symbol": sym, "name": name, "error": err}
        out["contains"] = [{"symbol": k, "name": v} for k, v in d.items() if q.upper() in v.upper() or q.upper() in k][:15]
    return out


@app.get("/api/search")
def search(q: str, u: User = Depends(current_user)):
    return market.search(q[:40])


@app.get("/api/forecast")
def forecast(symbol: str, days: int = 30, cse: bool = False, u: User = Depends(current_user)):
    sym = market.normalize(symbol, cse)
    r = market.forecast(sym, max(7, min(days, 90)))
    if not r:
        raise HTTPException(400, market.LAST_ERR.get(sym) or f"Not enough market data for {sym}")
    return r
