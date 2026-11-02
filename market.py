"""Live market data (Yahoo Finance; cse.lk for Colombo quotes) and the forecast model."""
import os, re, time, requests
import numpy as np
import pandas as pd
import yfinance as yf
from concurrent.futures import ThreadPoolExecutor

CSE_API = "https://www.cse.lk/api/"
TTL = 600
_cache: dict = {}
LAST_ERR: dict = {}


def is_cse(s: str) -> bool:
    return s.endswith((".CSE", ".LK", ".CM"))


def cse_code(symbol: str) -> str:
    """HNB.N0000.CSE -> HNB.N0000 (the form cse.lk expects)."""
    return symbol.rsplit(".", 1)[0] if is_cse(symbol) else symbol


_CSE_CLASS = re.compile(r"^(.+?)\.([NXPWD])(\d{0,4})$")


def normalize(symbol: str, cse: bool = False) -> str:
    """Accepts HNB, HNB.N, HNB.N0000 or HNB.N0000.CSE and returns the canonical HNB.N0000.CSE for Colombo
    stocks. Non-Colombo tickers (AAPL, BRK.B, TCS.NS) are returned unchanged unless cse=True."""
    s = symbol.strip().upper()
    if is_cse(s):
        s = cse_code(s)
        cse = True
    m = _CSE_CLASS.match(s)
    if m:
        return f"{m.group(1)}.{m.group(2)}{m.group(3).ljust(4, '0')}.CSE"
    if cse:
        return (s if "." in s else s + ".N0000") + ".CSE"
    return s


def cse_quote(symbol: str):
    """Live quote from the Colombo Stock Exchange's public (unofficial) API."""
    key = ("cse", symbol)
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < 120:
        return hit[1]
    try:
        r = requests.post(CSE_API + "companyInfoSummery", data={"symbol": cse_code(symbol)}, timeout=15,
                          headers={"User-Agent": "Mozilla/5.0 TradUp"})
        i = (r.json() or {}).get("reqSymbolInfo") or {}
        price = i.get("lastTradedPrice") or i.get("previousClose")
        if r.status_code != 200 or not price:
            LAST_ERR[symbol] = f"CSE has no data for {cse_code(symbol)} (class suffix: try .N0000 or .X0000)"
            return None
        change = float(i.get("change") or 0)
        out = {"id": i.get("id"), "price": float(price), "prev": float(price) - change,
               "change_pct": float(i.get("changePercentage") or 0), "volume": 0,
               "date": pd.Timestamp.today().strftime("%Y-%m-%d"), "name": i.get("name") or cse_code(symbol)}
        _cache[key] = (time.time(), out)
        return out
    except Exception as e:
        LAST_ERR[symbol] = f"Could not reach the CSE API ({type(e).__name__})"
        return None


def cse_history(symbol: str):
    """~1 year of daily prices from cse.lk (companyChartDataByStock, period=5)."""
    q = cse_quote(symbol)
    if not q or not q.get("id"):
        return None
    try:
        r = requests.post(CSE_API + "companyChartDataByStock", data={"stockId": q["id"], "period": 5}, timeout=20,
                          headers={"User-Agent": "Mozilla/5.0 TradUp"})
        rows = (r.json() or {}).get("chartData") or []
        if len(rows) < 2:
            LAST_ERR[symbol] = f"CSE returned no daily history for {cse_code(symbol)}"
            return None
        df = pd.DataFrame(rows)
        df["Date"] = (pd.to_datetime(df["t"], unit="ms") + pd.Timedelta(hours=5, minutes=30)).dt.normalize()  # Colombo time
        df = df.rename(columns={"p": "Close", "q": "Volume"})
        df["Volume"] = df["Volume"].fillna(0)
        df = df.dropna(subset=["Close"]).drop_duplicates("Date", keep="last")
        return df[["Date", "Close", "Volume"]].sort_values("Date").reset_index(drop=True)
    except Exception as e:
        LAST_ERR[symbol] = f"Could not read CSE history ({type(e).__name__})"
        return None


def _fetch(symbol: str, years: int):
    try:
        if is_cse(symbol):
            return cse_history(symbol)
        else:
            df = yf.Ticker(symbol).history(period=f"{years}y", auto_adjust=True)
            if df.empty:
                return None
            df.index = df.index.tz_localize(None) if df.index.tz is not None else df.index
            df = df.reset_index().rename(columns={df.index.name or "index": "Date"})
            if "Date" not in df.columns:
                df = df.rename(columns={df.columns[0]: "Date"})
        df["Date"] = pd.to_datetime(df["Date"]).dt.normalize()
        return df[["Date", "Close", "Volume"]].dropna(subset=["Close"]).sort_values("Date").reset_index(drop=True)
    except Exception:
        return None


def history(symbol: str, years: int = 1):
    key = (symbol, years)
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < TTL:
        return hit[1]
    df = _fetch(symbol, years)
    if df is not None:
        if len(_cache) > 400:
            _cache.clear()
        _cache[key] = (time.time(), df)
    return df


def quote(symbol: str):
    if is_cse(symbol):
        return cse_quote(symbol)
    df = history(symbol, 1)
    if df is None or df.empty:
        return None
    last = float(df["Close"].iloc[-1])
    prev = float(df["Close"].iloc[-2]) if len(df) > 1 else last
    return {"price": last, "prev": prev, "change_pct": (last / prev - 1) * 100 if prev else 0.0,
            "volume": int(df["Volume"].iloc[-1]), "date": df["Date"].iloc[-1].strftime("%Y-%m-%d")}


def info(symbol: str):
    if is_cse(symbol):
        q = cse_quote(symbol)
        return {"name": (q or {}).get("name") or cse_code(symbol), "sector": "Colombo Stock Exchange"}
    try:
        i = yf.Ticker(symbol).info
        return {"name": i.get("shortName") or i.get("longName") or symbol,
                "sector": i.get("sector") or (i.get("quoteType") or "Asset").title()}
    except Exception:
        return {"name": symbol, "sector": "Asset"}


def search(q: str):
    try:
        res = yf.Search(q, max_results=8).quotes
        return [{"symbol": r["symbol"], "name": r.get("shortname") or r.get("longname") or r["symbol"],
                 "exchange": r.get("exchDisp", "")} for r in res if r.get("symbol")]
    except Exception:
        return []


def parallel(fn, items):
    with ThreadPoolExecutor(6) as ex:
        return list(ex.map(fn, items))


def portfolio_series(holdings, days: int):
    if not holdings:
        return []
    syms = sorted({h.symbol for h in holdings})
    hist = dict(zip(syms, parallel(lambda s: history(s, 2), syms)))
    closes = {s: d.set_index("Date")["Close"] for s, d in hist.items() if d is not None}
    if not closes:
        return []
    px = pd.DataFrame(closes).sort_index().ffill()
    px = px[px.index >= px.index.max() - pd.Timedelta(days=days)]
    val = pd.Series(0.0, index=px.index)
    cost = pd.Series(0.0, index=px.index)
    for h in holdings:
        if h.symbol not in px:
            continue
        live = (px.index >= pd.Timestamp(h.buy_date)).astype(float)
        val = val + px[h.symbol].fillna(0) * h.shares * live
        cost = cost + h.shares * h.buy_price * live
    out = pd.DataFrame({"value": val, "cost": cost})
    out = out[out["cost"] > 0]
    return [{"date": d.strftime("%Y-%m-%d"), "value": round(r.value, 2), "cost": round(r.cost, 2)}
            for d, r in out.iterrows()]


def forecast(symbol: str, days: int):
    """Drift + volatility model: log-linear trend over the last ~90 sessions,
    95% band widening with sqrt(time). Signals = SMA20 vs SMA50 over history+forecast."""
    df = history(symbol, 2)
    if df is None or len(df) < 60:
        return None
    s = df.set_index("Date")["Close"].astype(float)
    lp = np.log(s.values)
    w = min(90, len(lp))
    slope = float(np.clip(np.polyfit(np.arange(w), lp[-w:], 1)[0], -0.005, 0.005))
    sigma = float(np.std(np.diff(lp)[-250:]))
    dates = pd.bdate_range(s.index[-1] + pd.Timedelta(days=1), periods=days)
    h = np.arange(1, days + 1)
    last = float(s.iloc[-1])
    yhat = last * np.exp(slope * h)
    band = 1.96 * sigma * np.sqrt(h)
    lo, hi = last * np.exp(slope * h - band), last * np.exp(slope * h + band)
    full = pd.Series(np.concatenate([s.values, yhat]))
    s20 = full.rolling(20).mean().values[-days:]
    s50 = full.rolling(50).mean().values[-days:]
    gap = (s20 - s50) / s50
    sig = np.where(gap > 0.005, 1, np.where(gap < -0.005, -1, 0))
    hist = s.iloc[-180:]
    return {
        "symbol": symbol,
        "history": [{"date": d.strftime("%Y-%m-%d"), "close": round(float(v), 2)} for d, v in hist.items()],
        "forecast": [{"date": d.strftime("%Y-%m-%d"), "yhat": round(float(a), 2), "lower": round(float(b), 2),
                      "upper": round(float(c), 2), "sma20": round(float(e), 2), "sma50": round(float(f), 2),
                      "signal": int(g)} for d, a, b, c, e, f, g in zip(dates, yhat, lo, hi, s20, s50, sig)],
        "outlook": {"signal": int(sig[-1]), "last": round(last, 2),
                    "expected_pct": round((yhat[-1] / last - 1) * 100, 2),
                    "range_low": round(float(lo[-1]), 2), "range_high": round(float(hi[-1]), 2)},
    }


OVERVIEW = [("^GSPC", "S&P 500"), ("^IXIC", "Nasdaq"), ("^DJI", "Dow Jones"), ("BTC-USD", "Bitcoin"), ("GC=F", "Gold")]
