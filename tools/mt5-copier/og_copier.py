"""
OG B0T -> MT5 copier (free, no MetaApi).

Runs on a Windows PC (or Windows VPS) next to the MetaTrader 5 terminal,
logged in to your Vantage account. Every few seconds it reads the OG Trade
Bot's signals from ogbot.co.uk (/api/public/copy-feed) and copies them:

  * a signal fills            -> open a market order (LOT lots)
  * TP1 banked on a runner    -> close half
  * the signal is over        -> close the rest at market
  * price hits the bot's stop -> close at market straight away

Like the bot itself, it puts no stop loss or take profit on the broker by
default (USE_BROKER_STOP = False): it closes with market orders. That means
it must keep running while trades are open. Set USE_BROKER_STOP = True if you
want a safety stop at the broker in case the PC goes off.

Settings live in config.ini next to this file (see config.example.ini).
"""

import configparser
import math
import json
import os
import sys
import time
from datetime import datetime, timezone

import MetaTrader5 as mt5
import requests

HERE = os.path.dirname(os.path.abspath(__file__))
MAGIC = 196196

# ── settings ────────────────────────────────────────────────────────────────
cfg = configparser.ConfigParser()
if not cfg.read(os.path.join(HERE, "config.ini")):
    sys.exit("config.ini not found: copy config.example.ini to config.ini and fill it in.")
c = cfg["copier"]
FEED_URL = c.get("feed_url", "https://ogbot.co.uk/api/public/copy-feed")
TOKEN = c.get("token", "").strip()
# "bot": the same lot the bot's test account takes on each signal; a number:
# that lot on every trade.
LOT_SETTING = c.get("lot", "bot").strip().lower()
LOT = 0.02 if LOT_SETTING == "bot" else float(LOT_SETTING)
# Lot-size bands (set remotely): the copier takes a lot inside the band, bigger
# the surer the signal. The band replaces the old lot + multiplier controls.
LOT_BANDS = {"small": (0.01, 0.05), "medium": (0.02, 0.1), "large": (0.1, 0.5)}
LOT_BAND = "small"

DRY_RUN = c.getboolean("dry_run", True)
USE_BROKER_STOP = c.getboolean("use_broker_stop", False)
POLL_SECONDS = c.getfloat("poll_seconds", 3)
MAX_LATE_MINUTES = c.getfloat("max_late_minutes", 10)
MAX_OPEN = c.getint("max_open", 6)
# The max-open the settings ask for, before high-frequency mode lifts it.
BASE_MAX_OPEN = MAX_OPEN
MARKETS = [m.strip().upper() for m in c.get("markets", "XAUUSD,BTCUSD").split(",") if m.strip()]
# Symbol names for every market the bot trades (your broker's names), so a
# market switched on remotely is ready, and one switched off is still managed.
KNOWN_MARKETS = sorted(set(MARKETS) | {"XAUUSD", "BTCUSD"})
SYMBOLS = {m: c.get(f"symbol_{m}", m) for m in KNOWN_MARKETS}
PAUSED = False
# High-frequency mode (set remotely): bigger lots, quicker checks, more open.
HFT = False
MAX_MULTIPLIER = 4.0
REMOTE = {}
MT5_PATH = c.get("mt5_path", "").strip() or None

# Dry runs keep their own memory, so pretend trades never reach a live run.
STATE_FILE = os.path.join(HERE, "copier_state_dry.json" if DRY_RUN else "copier_state.json")

if len(TOKEN) < 24:
    sys.exit("Put the copy feed token (24+ characters) in config.ini.")


def log(msg):
    stamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{stamp}] {'(dry run) ' if DRY_RUN else ''}{msg}", flush=True)


# ── state: which signal is which MT5 position ──────────────────────────────
def load_state():
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_state(state):
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)
    os.replace(tmp, STATE_FILE)


# ── MT5 helpers ────────────────────────────────────────────────────────────
def connect():
    ok = mt5.initialize(path=MT5_PATH) if MT5_PATH else mt5.initialize()
    if not ok:
        sys.exit(f"Can't reach MetaTrader 5: {mt5.last_error()}. Is the terminal open and logged in?")
    info = mt5.account_info()
    if info is None:
        sys.exit("MetaTrader 5 is open but not logged in to an account.")
    if not mt5.terminal_info().trade_allowed:
        sys.exit("Turn on Algo Trading in MetaTrader 5 (the button in the toolbar).")
    log(f"Connected to {info.server}, account {info.login}, balance {info.balance} {info.currency}")
    for m in MARKETS:
        sym = SYMBOLS[m]
        if not mt5.symbol_select(sym, True):
            sys.exit(f"Symbol {sym} (for {m}) not found. Set symbol_{m} in config.ini to the name in Market Watch.")


def filling(sym):
    mode = mt5.symbol_info(sym).filling_mode
    if mode & 1:
        return mt5.ORDER_FILLING_FOK
    if mode & 2:
        return mt5.ORDER_FILLING_IOC
    return mt5.ORDER_FILLING_RETURN


def round_volume(sym, vol):
    info = mt5.symbol_info(sym)
    step = info.volume_step or 0.01
    # Halves round up (0.045 -> 0.05), the same as the bot's own sums, so the
    # test account in the signals group trades exactly this lot.
    vol = round(math.floor(vol / step + 0.5 + 1e-9) * step, 8)
    return max(info.volume_min, min(info.volume_max, vol))


def position(ticket):
    pos = mt5.positions_get(ticket=ticket)
    return pos[0] if pos else None


def send(request, what):
    if DRY_RUN:
        log(f"would {what}")
        return True, None
    res = mt5.order_send(request)
    if res is None or res.retcode != mt5.TRADE_RETCODE_DONE:
        log(f"FAILED to {what}: {res.retcode if res else mt5.last_error()} {res.comment if res else ''}")
        return False, None
    log(f"{what} ok (ticket {res.order})")
    return True, res


GOLD_BIG_LOT_BALANCE = 400


def account_balance():
    """The MT5 account's balance, or None when it can't be read."""
    try:
        info = mt5.account_info()
        return float(info.balance) if info else None
    except Exception:
        return None


def lot_for(sig):
    """The lot for this signal: inside the chosen band (bigger when surer), or
    the bot's own lot, or a fixed lot. A band is the lot on its own, so the old
    risk multiplier only still applies to the bot/fixed modes."""
    # The Boss's manual trade: exactly the lot he chose, whatever the mode.
    if sig.get("manual") and sig.get("lots"):
        return float(sig["lots"])
    if LOT_SETTING == "band":
        # The lot always stays inside the band set on the card.
        lo, hi = LOT_BANDS[LOT_BAND]
        if HFT:
            # High-frequency mode trades bigger: the top of the band. Bitcoin
            # always; gold only with $400 or more on the account, and the
            # bottom of the band under that (gold ties up more margin).
            if sig.get("market") != "XAUUSD":
                return hi
            bal = account_balance()
            if bal is not None:
                return hi if bal >= GOLD_BIG_LOT_BALANCE else lo
        t = 0.0
        try:
            conf = sig.get("confidence")
            if conf is not None:
                t = max(0.0, min(1.0, (float(conf) - 55) / 35))
        except (TypeError, ValueError):
            t = 0.0
        return math.floor((lo + (hi - lo) * t) * 100 + 0.5 + 1e-9) / 100
    mult = REMOTE.get("multiplier", 1) if isinstance(REMOTE, dict) else 1
    try:
        mult = float(mult or 1)
    except (TypeError, ValueError):
        mult = 1.0
    # Never more than 4x, whatever the server says (10x was dropped as too risky).
    mult = max(0.25, min(MAX_MULTIPLIER, mult))
    base = float(sig["lots"]) if LOT_SETTING == "bot" else LOT
    return base * mult


def open_trade(sig, sym):
    buy = sig["direction"] == "BUY"
    # A counter-trend hedge keeps its own ticket (the account is in hedging mode,
    # so a BUY and a SELL on one symbol sit side by side); the H mark makes it
    # easy to spot in MT5. The risk multiplier applies to it like any other.
    hedge = bool(sig.get("hedge"))
    tick = mt5.symbol_info_tick(sym)
    price = tick.ask if buy else tick.bid
    req = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": sym,
        "volume": round_volume(sym, lot_for(sig)),
        "type": mt5.ORDER_TYPE_BUY if buy else mt5.ORDER_TYPE_SELL,
        "price": price,
        "deviation": 50,
        "magic": MAGIC,
        "comment": f"OG {sig['id'][:8]}{' H' if hedge else ''}",
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": filling(sym),
    }
    if USE_BROKER_STOP:
        req["sl"] = float(sig["stopNow"])
    ok, res = send(req, f"open {sig['direction']} {req['volume']} {sym} at {price}")
    if not ok:
        return None
    if DRY_RUN:
        return {"ticket": -1, "volume": req["volume"]}
    # The position's ticket is the order's ticket on hedging accounts; look it up to be sure.
    time.sleep(0.5)
    for p in mt5.positions_get(symbol=sym) or []:
        if p.magic == MAGIC and p.comment.startswith(f"OG {sig['id'][:8]}"):
            return {"ticket": p.ticket, "volume": p.volume}
    return {"ticket": res.order, "volume": req["volume"]}


def close(ticket, sym, volume, why):
    if ticket <= 0 and not DRY_RUN:
        return True  # a pretend trade from a dry run: nothing to close
    p = position(ticket) if ticket > 0 else None
    if ticket > 0 and p is None:
        return True  # already gone (closed by hand or by a broker stop)
    vol = round_volume(sym, min(volume, p.volume) if p else volume)
    buy = (p.type == mt5.POSITION_TYPE_BUY) if p else True
    tick = mt5.symbol_info_tick(sym)
    req = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": sym,
        "volume": vol,
        "type": mt5.ORDER_TYPE_SELL if buy else mt5.ORDER_TYPE_BUY,
        "position": ticket,
        "price": tick.bid if buy else tick.ask,
        "deviation": 50,
        "magic": MAGIC,
        "comment": "OG close",
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": filling(sym),
    }
    ok, _ = send(req, f"close {vol} {sym} ({why})")
    return ok


def move_stop(ticket, sym, stop):
    p = position(ticket)
    if p is None or abs((p.sl or 0) - stop) < 1e-9:
        return
    send(
        {"action": mt5.TRADE_ACTION_SLTP, "symbol": sym, "position": ticket, "sl": float(stop), "tp": p.tp},
        f"move stop to {stop}",
    )


# ── the loop ───────────────────────────────────────────────────────────────
def apply_remote(settings):
    """Settings set on the server (site_content copy.settings) win over config.ini."""
    global PAUSED, LOT_SETTING, LOT, LOT_BAND, MARKETS, MAX_OPEN, BASE_MAX_OPEN, MAX_LATE_MINUTES
    global USE_BROKER_STOP, REMOTE, HFT
    settings = settings or {}
    if settings == REMOTE:
        return
    REMOTE = settings
    PAUSED = bool(settings.get("paused", False))
    band = settings.get("lotBand")
    lot = settings.get("lot")
    # A band is the lot control on the card; a fixed lot or "bot" still work too.
    if band in LOT_BANDS:
        LOT_SETTING, LOT_BAND = "band", band
    elif lot == "bot":
        LOT_SETTING, LOT = "bot", 0.02
    elif isinstance(lot, (int, float)) and lot > 0:
        LOT_SETTING, LOT = str(lot), float(lot)
    if isinstance(settings.get("markets"), list):
        wanted = [str(m).upper() for m in settings["markets"]]
        for m in wanted:
            if m not in SYMBOLS:
                SYMBOLS[m] = c.get(f"symbol_{m}", m)
        MARKETS = [m for m in wanted if mt5.symbol_select(SYMBOLS[m], True) or DRY_RUN]
    if isinstance(settings.get("maxOpen"), int):
        BASE_MAX_OPEN = settings["maxOpen"]
    if isinstance(settings.get("maxLateMinutes"), (int, float)):
        MAX_LATE_MINUTES = settings["maxLateMinutes"]
    if isinstance(settings.get("useBrokerStop"), bool):
        USE_BROKER_STOP = settings["useBrokerStop"]
    HFT = settings.get("hft") is True
    # High-frequency mode lifts it to at least 20; turned off, it's back.
    # High-frequency mode: no cap on open trades.
    MAX_OPEN = float("inf") if HFT else BASE_MAX_OPEN
    if LOT_SETTING == "band":
        size = f"the {LOT_BAND} lot band {LOT_BANDS[LOT_BAND]}"
    elif LOT_SETTING == "bot":
        size = "the bot's lot"
    else:
        size = f"{LOT} lots"
    log(
        f"Remote settings: {'PAUSED (managing open trades only), ' if PAUSED else ''}"
        f"{', '.join(MARKETS) or 'no markets'} at {size}, {'no cap on' if HFT else f'max {MAX_OPEN}'} open, "
        f"broker stop {'on' if USE_BROKER_STOP else 'off'}"
    )


def fetch():
    r = requests.get(FEED_URL, headers={"x-copy-token": TOKEN}, timeout=10)
    if r.status_code == 403:
        sys.exit("The feed said Forbidden: check the token in config.ini.")
    r.raise_for_status()
    body = r.json()
    apply_remote(body.get("settings"))
    return body["signals"]


def minutes_since(iso):
    t = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return (datetime.now(timezone.utc) - t).total_seconds() / 60


def hit_stop(sig, sym):
    tick = mt5.symbol_info_tick(sym)
    if sig["direction"] == "BUY":
        return tick.bid <= sig["stopNow"]
    return tick.ask >= sig["stopNow"]


def step(state):
    signals = fetch()
    by_id = {s["id"]: s for s in signals}
    for sig in reversed(signals):  # oldest first
        if sig["market"] not in SYMBOLS:
            continue
        sym = SYMBOLS[sig["market"]]
        mine = state.get(sig["id"])
        if mine is None:
            if not (sig["active"] and sig["filled"]):
                continue
            # Paused, or a market switched off: no new trades (open ones are
            # still managed below). Not marked, so it's taken if resumed in time.
            if PAUSED or sig["market"] not in MARKETS:
                continue
            if sig["halfClosed"] or minutes_since(sig["createdAt"]) > MAX_LATE_MINUTES:
                state[sig["id"]] = {"skipped": True}
                continue
            # lot = bot copies exactly what the Copy Trader B0T copies: a
            # signal the bot took no lot on isn't copied here either.
            if LOT_SETTING == "bot" and not sig.get("lots"):
                state[sig["id"]] = {"skipped": True}
                log(f"skip {sig['direction']} {sig['market']}: the bot took no lot on it")
                continue
            if sum(1 for v in state.values() if v.get("ticket") and not v.get("closed")) >= MAX_OPEN:
                continue
            if hit_stop(sig, sym):
                state[sig["id"]] = {"skipped": True}
                continue
            opened = open_trade(sig, sym)
            if opened:
                state[sig["id"]] = {**opened, "symbol": sym, "half": False, "closed": False}
            continue
        if mine.get("skipped") or mine.get("closed"):
            continue
        ticket, vol = mine["ticket"], mine["volume"]
        if not sig["active"]:
            if close(ticket, sym, vol, f"signal over: {sig['status']}"):
                mine["closed"] = True
            continue
        if hit_stop(sig, sym):
            if close(ticket, sym, vol, f"stop {sig['stopNow']} reached"):
                mine["closed"] = True
            continue
        if sig["halfClosed"] and not mine["half"]:
            half = round_volume(sym, vol / 2)
            if half < vol and close(ticket, sym, half, "TP1: half closed"):
                mine["half"] = True
                mine["volume"] = round(vol - half, 8)
            else:
                mine["half"] = True  # too small to split: the whole lot rides the trail
        if USE_BROKER_STOP and ticket > 0:
            move_stop(ticket, sym, sig["stopNow"])
    # Signals that dropped out of the feed (over a day old): close what's left,
    # then forget them.
    for sid in list(state):
        if sid in by_id:
            continue
        mine = state[sid]
        if mine.get("ticket") and not mine.get("closed") and not mine.get("skipped"):
            if not close(mine["ticket"], mine["symbol"], mine["volume"], "signal expired"):
                continue
        del state[sid]
    save_state(state)


def main():
    connect()
    state = load_state()
    size = "the bot's lot for each signal" if LOT_SETTING == "bot" else f"{LOT} lots"
    log(f"Copying {', '.join(MARKETS)} at {size}, every {POLL_SECONDS}s. Ctrl+C to stop.")
    while True:
        try:
            step(state)
        except requests.RequestException as e:
            log(f"feed not reachable ({e.__class__.__name__}), trying again")
        except Exception as e:  # keep going: one bad pass must not stop the copier
            log(f"error: {e}")
        time.sleep(0.5 if HFT else POLL_SECONDS)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("Stopped. Open trades stay open: start it again to keep managing them.")
    finally:
        mt5.shutdown()
