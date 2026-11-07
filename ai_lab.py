"""
TradUp AI Lab - stateless prediction endpoints (one model per request, so each call stays fast on small servers).

Wire it in main.py (2 lines):
    from ai_lab import router as ai_router
    app.include_router(ai_router)                       # add dependencies=[Depends(<your login check>)] to protect it

POST /api/ai/{rules|arima|ets|rf|gb|mc}
body: {"history":[{"date","close","high"?,"low"?,"volume"?},...], "horizon":30, "params":{...}}
"""
import math, threading, warnings
import numpy as np
import pandas as pd
from fastapi import APIRouter, Body, HTTPException

router = APIRouter(prefix="/api/ai", tags=["ai"])
_LOCK = threading.Semaphore(1)          # one heavy model at a time (protects small-RAM servers)
LAB = {1: "BUY", -1: "SELL", 0: "HOLD"}

DEFAULTS = dict(
    sig_days=5, th=1.5,                                           # signal horizon (days) and +/- threshold (%)
    ma_type="sma", fast=50, slow=200, rsi_n=14, rsi_ob=70, rsi_os=30,
    macd_f=12, macd_s=26, macd_g=9, bb_n=20, bb_k=2.0, st_ob=80, st_os=20, adx_min=20,
    vote_th=0.25, bt_days=750,
    ar_p=1, ar_d=1, ar_q=1, ar_auto=True, ar_seas=0, ar_lookback=500, ar_drift=False, ar_vol=False,
    tr_n=80, tr_depth=5, tr_lr=0.05, tr_train=500, bt_n=12,
    mc_n=2000, mc_lookback=252, mc_drift="shrink", mc_target=10.0, mc_stop=8.0,
)
LIM = dict(sig_days=(1, 30), th=(0.1, 25), fast=(2, 120), slow=(5, 400), rsi_n=(2, 50), rsi_ob=(55, 95), rsi_os=(5, 45),
           macd_f=(2, 50), macd_s=(5, 100), macd_g=(2, 30), bb_n=(5, 100), bb_k=(0.5, 4), st_ob=(60, 95), st_os=(5, 40),
           adx_min=(5, 50), vote_th=(0.05, 0.9), bt_days=(120, 2500), ar_p=(0, 5), ar_d=(0, 2), ar_q=(0, 5), ar_seas=(0, 30),
           ar_lookback=(100, 1500), tr_n=(20, 300), tr_depth=(2, 12), tr_lr=(0.01, 0.3), tr_train=(120, 2500), bt_n=(4, 40),
           mc_n=(200, 5000), mc_lookback=(60, 1500), mc_target=(1, 100), mc_stop=(1, 60))


def params(p):
    out = dict(DEFAULTS)
    for k, v in (p or {}).items():
        if k not in DEFAULTS:
            continue
        d = DEFAULTS[k]
        try:
            out[k] = bool(v) if isinstance(d, bool) else int(float(v)) if isinstance(d, int) else float(v) if isinstance(d, float) else str(v)
        except Exception:
            continue
        if k in LIM:
            out[k] = min(max(out[k], LIM[k][0]), LIM[k][1])
    if out["ma_type"] not in ("sma", "ema"): out["ma_type"] = "sma"
    if out["mc_drift"] not in ("zero", "hist", "shrink"): out["mc_drift"] = "shrink"
    return out


def clean(o):
    if isinstance(o, dict): return {k: clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)): return [clean(v) for v in o]
    if isinstance(o, (np.floating, float)): return None if not math.isfinite(float(o)) else round(float(o), 4)
    if isinstance(o, (np.integer,)): return int(o)
    if isinstance(o, (np.bool_,)): return bool(o)
    return o


def to_df(hist):
    if not isinstance(hist, list) or len(hist) < 120:
        raise HTTPException(400, "Need at least 120 daily prices for this ticker.")
    df = pd.DataFrame(hist[-3000:])
    df.columns = [str(c).lower() for c in df.columns]
    if "close" not in df:
        raise HTTPException(400, "history needs a 'close' field")
    for c in ("open", "high", "low", "volume", "close"):
        df[c] = pd.to_numeric(df[c], errors="coerce") if c in df else np.nan
    df = df.dropna(subset=["close"])
    df = df[df.close > 0].reset_index(drop=True)
    df["high"] = np.maximum(df["high"].fillna(df.close), df.close)
    df["low"] = np.minimum(df["low"].fillna(df.close), df.close)
    if "date" not in df:
        df["date"] = pd.bdate_range(end=pd.Timestamp.today().normalize(), periods=len(df)).strftime("%Y-%m-%d")
    df["date"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")
    if df.volume.notna().mean() < 0.8 or (df.volume.fillna(0) == 0).mean() > 0.5:
        df["volume"] = np.nan
    if len(df) < 120:
        raise HTTPException(400, "Need at least 120 daily prices for this ticker.")
    return df


def fdates(df, H):
    last = pd.Timestamp(df.date.iloc[-1])
    return [d.strftime("%Y-%m-%d") for d in pd.bdate_range(start=last + pd.Timedelta(days=1), periods=H)]


# ---------------------------------------------------------------- indicators
def ma(s, n, kind): return s.ewm(span=n, adjust=False).mean() if kind == "ema" else s.rolling(n).mean()
def ema(s, n): return s.ewm(span=n, adjust=False).mean()

def rsi(c, n=14):
    d = c.diff(); up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean(); dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    out = 100 - 100 / (1 + up / dn.replace(0, np.nan)); out[dn == 0] = 100.0
    return out

def macd(c, f=12, s=26, g=9):
    m = ema(c, f) - ema(c, s); sg = ema(m, g); return m, sg, m - sg

def boll(c, n=20, k=2.0):
    m = c.rolling(n).mean(); sd = c.rolling(n).std(); return m, m + k * sd, m - k * sd

def stoch(df, n=14, d=3):
    lo = df.low.rolling(n).min(); hi = df.high.rolling(n).max()
    k = 100 * (df.close - lo) / (hi - lo).replace(0, np.nan); return k, k.rolling(d).mean()

def atr(df, n=14):
    tr = pd.concat([df.high - df.low, (df.high - df.close.shift()).abs(), (df.low - df.close.shift()).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / n, adjust=False).mean()

def adx(df, n=14):
    up = df.high.diff(); dn = -df.low.diff()
    pdm = pd.Series(np.where((up > dn) & (up > 0), up, 0.0), index=df.index); mdm = pd.Series(np.where((dn > up) & (dn > 0), dn, 0.0), index=df.index)
    a = atr(df, n).replace(0, np.nan)
    pdi = 100 * pdm.ewm(alpha=1 / n, adjust=False).mean() / a; mdi = 100 * mdm.ewm(alpha=1 / n, adjust=False).mean() / a
    dx = 100 * (pdi - mdi).abs() / (pdi + mdi).replace(0, np.nan)
    return dx.ewm(alpha=1 / n, adjust=False).mean(), pdi, mdi

def obv(df): return (np.sign(df.close.diff()).fillna(0) * df.volume.fillna(0)).cumsum()


def features(df):
    c = df.close; X = pd.DataFrame(index=df.index)
    for i in (1, 2, 3, 5, 10, 20, 60): X[f"r{i}"] = np.log(c / c.shift(i))
    r = np.log(c).diff(); X["vol10"] = r.rolling(10).std(); X["vol20"] = r.rolling(20).std()
    X["rsi"] = rsi(c) / 100 - 0.5; X["macd"] = macd(c)[2] / c * 100
    mid, up, lo = boll(c); X["pb"] = (c - lo) / (up - lo).replace(0, np.nan)
    X["stoch"] = stoch(df)[0] / 100; X["atr"] = atr(df) / c
    X["dsma20"] = np.log(c / c.rolling(20).mean()); X["dsma50"] = np.log(c / c.rolling(50).mean())
    if df.volume.notna().all():
        v = df.volume; X["vz"] = (v - v.rolling(20).mean()) / v.rolling(20).std().replace(0, np.nan)
    return X.replace([np.inf, -np.inf], np.nan)


# ---------------------------------------------------------------- shared helpers
def sig_from(pct, th): return 1 if pct > th else -1 if pct < -th else 0
def score_from(pct, th): return max(-1.0, min(1.0, pct / (2 * th)))

def holdout(df, P, predict_fn):
    """Walk-forward test: at each past origin predict the sig_days-ahead log return using ONLY data up to that day."""
    k = P["sig_days"]; c = df.close.values; n = len(c); thl = math.log(1 + P["th"] / 100); prs, acts = [], []
    for j in range(P["bt_n"], 0, -1):
        o = n - 1 - j * k
        if o < 150: continue
        try: pr = float(predict_fn(o))
        except Exception: continue
        if math.isfinite(pr): prs.append(pr); acts.append(math.log(c[o + k] / c[o]))
    if len(prs) < 4: return None
    prs, acts = np.array(prs), np.array(acts); nz = acts != 0; buys = prs > thl
    mae_m, mae_n = float(np.mean(np.abs(acts - prs))), float(np.mean(np.abs(acts)))
    return dict(n=len(prs), k=k, hit_rate=float(np.mean(np.sign(prs[nz]) == np.sign(acts[nz]))), skill=(1 - mae_m / mae_n) if mae_n > 0 else 0.0,
                strategy_pct=float(np.prod(np.where(buys, np.exp(acts), 1.0)) - 1) * 100, buy_hold_pct=float(np.prod(np.exp(acts)) - 1) * 100,
                win_rate=float(np.mean(acts[buys] > 0)) if buys.any() else None, trades=int(buys.sum()), resid_sd=float(np.std(acts - prs)))

def pack(df, path, lo, hi, P, H, hold, notes, extra=None):
    last = float(df.close.iloc[-1]); k = min(P["sig_days"], H)
    e_k = (math.exp(path[k - 1]) - 1) * 100; e_h = (math.exp(path[H - 1]) - 1) * 100; s = sig_from(e_k, P["th"]); d = fdates(df, H)
    fc = [dict(date=d[i], yhat=last * math.exp(path[i]), lower=last * math.exp(lo[i]), upper=last * math.exp(hi[i])) for i in range(H)]
    out = dict(ok=True, signal=s, label=LAB[s], score=score_from(e_k, P["th"]), expected_pct=e_k, horizon_pct=e_h, sig_days=k,
               last=last, forecast=fc, holdout=hold, notes=notes)
    if extra: out.update(extra)
    return clean(out)

def band(path_days, sd, k):  # 90% band that widens with sqrt(time)
    t = np.sqrt(np.arange(1, path_days + 1) / k); return -1.645 * sd * t, 1.645 * sd * t


# ---------------------------------------------------------------- 1) rule-based indicator system
def perf(close, pos):
    r = close.pct_change().fillna(0); p = pos.shift(1).fillna(0); sr = r * p; eq = (1 + sr).cumprod()
    sd = sr.std(); tid = (p.diff().fillna(p) == 1).cumsum(); inpos = p == 1
    tr = (1 + sr[inpos]).groupby(tid[inpos]).prod() - 1 if inpos.any() else pd.Series(dtype=float)
    return dict(total_pct=(eq.iloc[-1] - 1) * 100, buy_hold_pct=((1 + r).prod() - 1) * 100, sharpe=(sr.mean() / sd * math.sqrt(252)) if sd > 0 else 0.0,
                max_dd_pct=(eq / eq.cummax() - 1).min() * 100, trades=int(len(tr)), win_rate=float((tr > 0).mean()) if len(tr) else None), eq

def m_rules(df, P, H):
    c = df.close; n = len(c); slow = min(P["slow"], max(10, n // 2)); fast = min(P["fast"], max(2, slow - 1))
    if fast >= slow: fast, slow = slow, fast + 1
    f, s = ma(c, fast, P["ma_type"]), ma(c, slow, P["ma_type"]); rs = rsi(c, P["rsi_n"]); m, sg, mh = macd(c, P["macd_f"], P["macd_s"], P["macd_g"])
    mid, bu, bl = boll(c, P["bb_n"], P["bb_k"]); pb = (c - bl) / (bu - bl).replace(0, np.nan); k, _ = stoch(df); ad, pdi, mdi = adx(df); at = atr(df)
    up = f > s; cross_up = up & ~up.shift(1, fill_value=False) & s.notna().shift(1, fill_value=False); cross_dn = ~up & up.shift(1, fill_value=False) & s.notna()
    buy_ev = cross_up & (rs < P["rsi_ob"]); sell_ev = cross_dn
    ppos = pd.Series(np.nan, index=c.index); ppos[buy_ev] = 1.0; ppos[sell_ev] = 0.0; ppos = ppos.ffill().fillna(0.0)
    votes = pd.DataFrame({"ma": np.sign(f - s).where(s.notna(), 0), "rsi": (rs < P["rsi_os"]).astype(int) - (rs > P["rsi_ob"]).astype(int), "macd": np.sign(m - sg),
                          "bb": (pb < 0).astype(int) - (pb > 1).astype(int), "stoch": (k < P["st_os"]).astype(int) - (k > P["st_ob"]).astype(int),
                          "adx": np.sign(pdi - mdi).where(ad > P["adx_min"], 0)})
    hasv = df.volume.notna().all()
    if hasv: votes["obv"] = np.sign(obv(df) - obv(df).rolling(20).mean())
    score = votes.mean(axis=1); vpos = (score >= P["vote_th"]).astype(float)
    i = n - 1; v = votes.iloc[i]; sc = float(score.iloc[i]); s_now = 1 if sc >= P["vote_th"] else -1 if sc <= -P["vote_th"] else 0
    def row(name, val, vote, note=""): return dict(name=name, value=val, vote=int(vote), note=note)
    ind = [row(f"{P['ma_type'].upper()} {fast}/{slow} trend", f"{f.iloc[i]:.2f} vs {s.iloc[i]:.2f}" if s.notna().iloc[i] else "n/a", v["ma"], "fast above slow = uptrend"),
           row(f"RSI({P['rsi_n']})", f"{rs.iloc[i]:.1f}", v["rsi"], f"oversold<{P['rsi_os']}, overbought>{P['rsi_ob']}"),
           row(f"MACD({P['macd_f']},{P['macd_s']},{P['macd_g']})", f"hist {mh.iloc[i]:.3f}", v["macd"], "MACD line vs signal line"),
           row(f"Bollinger({P['bb_n']},{P['bb_k']:g}) %B", f"{pb.iloc[i]:.2f}" if pd.notna(pb.iloc[i]) else "n/a", v["bb"], "<0 below lower band, >1 above upper"),
           row("Stochastic %K", f"{k.iloc[i]:.1f}" if pd.notna(k.iloc[i]) else "n/a", v["stoch"], f"<{P['st_os']} oversold, >{P['st_ob']} overbought"),
           row("ADX / DI", f"{ad.iloc[i]:.1f}", v["adx"], f"counts only when ADX>{P['adx_min']}")]
    if hasv: ind.append(row("OBV trend", "above avg" if v["obv"] > 0 else "below avg", v["obv"], "volume-flow vs 20-day average"))
    ev = buy_ev | sell_ev; last_ev = ev[ev].index[-1] if ev.any() else None
    primary = dict(event=("BUY" if buy_ev[last_ev] else "SELL") if last_ev is not None else "none", bars_ago=int(i - last_ev) if last_ev is not None else None,
                   state="uptrend" if up.iloc[i] else "downtrend")
    # backtests
    w = slice(max(0, n - P["bt_days"]), n)
    bt_p, eq_p = perf(c[w], ppos[w]); bt_v, eq_v = perf(c[w], vpos[w]); bh = (c[w] / c[w].iloc[0])
    step = max(1, len(bh) // 250); idx = list(range(0, len(bh), step))
    equity = dict(date=df.date[w].iloc[idx].tolist(), vote=(eq_v.iloc[idx]).tolist(), primary=(eq_p.iloc[idx]).tolist(), buy_hold=bh.iloc[idx].tolist())
    # risk & regime
    r = np.log(c).diff(); ew = (r ** 2).ewm(alpha=0.06, adjust=False).mean(); vol_ann = float(np.sqrt(ew.iloc[i] * 252) * 100)
    v20 = r.rolling(20).std(); vp = float((v20.iloc[-250:] <= v20.iloc[i]).mean() * 100)
    regime = ("Trending up" if pdi.iloc[i] > mdi.iloc[i] else "Trending down") if ad.iloc[i] > 25 else ("Ranging / sideways" if ad.iloc[i] < P["adx_min"] else "Weak trend")
    last = float(c.iloc[i]); a = float(at.iloc[i])
    risk = dict(vol_ann_pct=vol_ann, vol_percentile=vp, regime=regime + (" · high volatility" if vp > 80 else ""), atr=a, stop=last - 2 * a, target=last + 3 * a,
                max_dd_1y_pct=float((c.iloc[-252:] / c.iloc[-252:].cummax() - 1).min() * 100))
    cw = min(300, n); sl = slice(n - cw, n); mk = lambda b: [int(j - (n - cw)) for j in b[b].index if j >= n - cw]
    series = dict(date=df.date[sl].tolist(), close=c[sl].tolist(), fast=f[sl].tolist(), slow=s[sl].tolist(), bb_up=bu[sl].tolist(), bb_lo=bl[sl].tolist(),
                  rsi=rs[sl].tolist(), macd_hist=mh[sl].tolist())
    notes = [f"Composite score {sc:+.2f} (BUY at >= +{P['vote_th']:.2f}, SELL at <= -{P['vote_th']:.2f})."]
    if slow != P["slow"]: notes.append(f"Slow window reduced to {slow} because history is short.")
    return clean(dict(ok=True, signal=s_now, label=LAB[s_now], score=max(-1, min(1, sc / max(P["vote_th"] * 2, .2))), raw_score=sc, last=last, indicators=ind, primary=primary,
                      backtest=dict(primary=bt_p, vote=bt_v, days=int(len(bh))), equity=equity, risk=risk, series=series,
                      markers=dict(buy=mk(buy_ev), sell=mk(sell_ev)), holdout=None, forecast=[], notes=notes))


# ---------------------------------------------------------------- 2) ARIMA / SARIMAX
def m_arima(df, P, H):
    from statsmodels.tsa.statespace.sarimax import SARIMAX
    k = P["sig_days"]; c = df.close.values; use_x = P["ar_vol"] and df.volume.notna().all()
    seas = (1, 0, 0, P["ar_seas"]) if P["ar_seas"] > 1 else (0, 0, 0, 0)
    def prep(upto):
        lo = max(0, upto + 1 - P["ar_lookback"]); y = np.log(c[lo:upto + 1]); x = None
        if use_x:
            v = np.log1p(df.volume.values[lo:upto + 1]); x = ((v - v.mean()) / (v.std() or 1)).reshape(-1, 1)
        return y, x
    def fit(y, x, order):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            return SARIMAX(y, exog=x, order=order, seasonal_order=seas, trend="c" if (order[1] == 0 and not seas[3]) else None,
                          enforce_stationarity=False, enforce_invertibility=False).fit(disp=False, maxiter=60)
    def fc(res, y, x, steps):
        xf = np.full((steps, 1), x[-20:, 0].mean()) if x is not None else None
        g = res.get_forecast(steps=steps, exog=xf); mean = np.asarray(g.predicted_mean); ci = np.asarray(g.conf_int(alpha=0.10))
        if P["ar_drift"]:
            mu = 0.5 * np.mean(np.diff(y[-252:])) * np.arange(1, steps + 1); mean = mean + mu; ci = ci + mu[:, None]
        return mean, ci
    y, x = prep(len(c) - 1)
    if P["ar_auto"]:
        best = None
        for p in range(0, 3):
            for q in range(0, 3):
                try:
                    r = fit(y, x, (p, P["ar_d"], q))
                    if best is None or r.aic < best[0]: best = (r.aic, (p, P["ar_d"], q), r)
                except Exception: pass
        if best is None: raise ValueError("no ARIMA order converged")
        _, order, res = best
    else:
        order = (P["ar_p"], P["ar_d"], P["ar_q"]); res = fit(y, x, order)
    mean, ci = fc(res, y, x, H)
    def pf(o):
        yy, xx = prep(o); r = fit(yy, xx, order); m, _ = fc(r, yy, xx, k); return m[-1] - yy[-1]
    hold = holdout(df, P, pf)
    notes = [f"{'SARIMAX' if (use_x or seas[3]) else 'ARIMA'}{order}" + (f" x {seas}" if seas[3] else "") + f", AIC {res.aic:.1f}" + (" (order auto-selected)" if P["ar_auto"] else "") + (", volume as exogenous variable" if use_x else "")]
    return pack(df, mean - y[-1], ci[:, 0] - y[-1], ci[:, 1] - y[-1], P, H, hold, notes, dict(order=list(order)))


# ---------------------------------------------------------------- 3) Holt-Winters exponential smoothing
def m_ets(df, P, H):
    from statsmodels.tsa.holtwinters import ExponentialSmoothing
    k = P["sig_days"]; c = df.close.values; s = P["ar_seas"]
    def run(y, steps):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            kw = dict(trend="add", damped_trend=True, initialization_method="estimated")
            if s > 1 and len(y) > 3 * s: kw.update(seasonal="add", seasonal_periods=s)
            r = ExponentialSmoothing(y, **kw).fit(); return r, np.asarray(r.forecast(steps))
    y = np.log(c[-P["ar_lookback"]:]); r, f = run(y, H)
    sd = float(np.std(r.resid)); t = np.sqrt(np.arange(1, H + 1))
    def pf(o): yy = np.log(c[max(0, o + 1 - P["ar_lookback"]):o + 1]); return run(yy, k)[1][-1] - yy[-1]
    hold = holdout(df, P, pf)
    return pack(df, f - y[-1], f - y[-1] - 1.645 * sd * t, f - y[-1] + 1.645 * sd * t, P, H, hold, ["Holt-Winters (damped additive trend" + (", seasonal)" if s > 1 else ")")])


# ---------------------------------------------------------------- 4) Random Forest / Gradient Boosting (tabular ML)
def m_tree(df, P, H, kind):
    from sklearn.ensemble import RandomForestRegressor, HistGradientBoostingRegressor, HistGradientBoostingClassifier
    X = features(df); cols = list(X.columns); c = df.close; k = P["sig_days"]; H = max(H, k); n = len(c)
    hs = sorted({k, max(k, H // 2), H})
    def mk(light):
        m = max(20, P["tr_n"] // (2 if light else 1))
        if kind == "rf": return RandomForestRegressor(n_estimators=m, max_depth=P["tr_depth"], min_samples_leaf=5, max_features=0.6, n_jobs=1, random_state=0)
        return HistGradientBoostingRegressor(max_iter=m, max_depth=P["tr_depth"], learning_rate=P["tr_lr"], l2_regularization=1.0, min_samples_leaf=10, random_state=0)
    def train(h, upto, light, clf=False):
        y = np.log(c.shift(-h) / c).rename("y"); d = X.loc[X.index <= upto - h].join(y).dropna().iloc[-P["tr_train"]:]
        if len(d) < 80: raise ValueError("not enough rows to train")
        if clf:
            m = HistGradientBoostingClassifier(max_iter=max(30, P["tr_n"]), max_depth=P["tr_depth"], learning_rate=P["tr_lr"], random_state=0).fit(d[cols].values, (d.y > 0).astype(int))
        else:
            m = mk(light).fit(d[cols].values, d.y.values)
        return m, np.nan_to_num(X.loc[[upto], cols].values)
    preds, model_k = {}, None
    for h in hs:
        m, xn = train(h, n - 1, False); preds[h] = float(m.predict(xn)[0])
        if h == k: model_k = m
    path = np.interp(np.arange(1, H + 1), [0] + hs, [0] + [preds[h] for h in hs])
    hold = holdout(df, P, lambda o: (lambda mm: float(mm[0].predict(mm[1])[0]))(train(k, o, True)))
    sd = hold["resid_sd"] if hold else float(np.log(c).diff().std() * math.sqrt(k)); lo, hi = band(H, sd, k)
    extra, notes = {}, [f"{'Random Forest' if kind == 'rf' else 'Gradient Boosting (histogram, XGBoost-style)'}: {P['tr_n']} {'trees' if kind == 'rf' else 'rounds'}, depth {P['tr_depth']}, trained on last {P['tr_train']} days",
                        "Horizon points are modelled directly and the line between them is interpolated."]
    if kind == "rf" and hasattr(model_k, "feature_importances_"):
        imp = sorted(zip(cols, model_k.feature_importances_), key=lambda t: -t[1])[:6]; extra["importance"] = [dict(name=a, value=float(b)) for a, b in imp]
    if kind == "gb":
        try:
            cm, xn = train(k, n - 1, False, clf=True); extra["prob_up"] = float(cm.predict_proba(xn)[0][1])
            notes.append(f"Classifier: {extra['prob_up'] * 100:.0f}% probability of a rise over {k} days.")
        except Exception: pass
    return pack(df, path, path + lo, path + hi, P, H, hold, notes, extra)


# ---------------------------------------------------------------- 5) Monte Carlo (bootstrap simulation)
def m_mc(df, P, H):
    r = np.log(df.close).diff().dropna().values[-P["mc_lookback"]:]; mu = float(r.mean())
    drift = {"zero": 0.0, "hist": mu, "shrink": 0.5 * mu}[P["mc_drift"]]; rng = np.random.default_rng(42)
    cum = np.cumsum(rng.choice(r - mu, size=(P["mc_n"], H)) + drift, axis=1); q = np.percentile(cum, [5, 50, 95], axis=0); k = min(P["sig_days"], H)
    tgt, stp = math.log(1 + P["mc_target"] / 100), math.log(1 - P["mc_stop"] / 100); v5 = np.percentile(cum[:, k - 1], 5); tail = cum[:, k - 1][cum[:, k - 1] <= v5]
    extra = dict(prob_up=float((cum[:, -1] > 0).mean()), prob_target=float((cum.max(axis=1) >= tgt).mean()), prob_stop=float((cum.min(axis=1) <= stp).mean()),
                 var95_pct=(math.exp(v5) - 1) * 100, es95_pct=(math.exp(float(tail.mean())) - 1) * 100, target_pct=P["mc_target"], stop_pct=P["mc_stop"], paths=int(P["mc_n"]))
    return pack(df, q[1], q[0], q[2], P, H, None, [f"{P['mc_n']} bootstrap paths from the last {len(r)} daily returns, drift = {P['mc_drift']}."], extra)


MODELS = {"rules": m_rules, "arima": m_arima, "ets": m_ets, "rf": lambda d, P, H: m_tree(d, P, H, "rf"), "gb": lambda d, P, H: m_tree(d, P, H, "gb"), "mc": m_mc}


@router.post("/{model}")
def run(model: str, body: dict = Body(...)):
    if model not in MODELS: raise HTTPException(404, "unknown model")
    df = to_df(body.get("history")); P = params(body.get("params"))
    try: H = int(body.get("horizon", 30))
    except Exception: H = 30
    H = min(max(H, P["sig_days"]), 120)
    if not _LOCK.acquire(timeout=90): raise HTTPException(503, "Server is busy, try again in a moment.")
    try: return MODELS[model](df, P, H)
    except ImportError as e: raise HTTPException(501, f"Server is missing a library ({e.name}). Add it to requirements.txt and redeploy.")
    except HTTPException: raise
    except Exception as e: raise HTTPException(422, f"{model} could not run: {e}")
    finally: _LOCK.release()
