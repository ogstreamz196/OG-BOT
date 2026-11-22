"""
The parts of the OG SIGNAL BOT app (og_stick.py) that don't need a window or
MT5, so they can be tested on their own: the settings file, signing in, the
access check on ogbot.co.uk, finding MetaTrader 5, the setup wizard's next
step, and reading the copier's status file.
"""

import configparser
import json
import os
from datetime import datetime, timezone

APP_NAME = "OG SIGNAL BOT"
FEED_URL = "https://ogbot.co.uk/api/public/copy-feed"
# Where members get or renew the OG SIGNAL BOT, and where MetaTrader 5 comes from.
GET_URL = "https://ogbot.co.uk/copier"
MT5_DOWNLOAD_URL = "https://www.metatrader5.com/en/download"
MT5_ON_STICK = os.path.join("MT5", "terminal64.exe")
# A status file older than this means the copier isn't running any more.
STATUS_FRESH_SECONDS = 20

LOGIN_ERRORS = {
    "bad_login": "That username or password isn't right.",
    "too_many": "Too many tries. Wait 15 minutes and try again.",
    "no_access": "This account doesn't have the OG SIGNAL BOT yet. Get it on ogbot.co.uk, then sign in again.",
    "bad_request": "Type your username and password (the password is at least 6 characters).",
}


def config_path(home):
    return os.path.join(home, "config.ini")


def load_config(home):
    """The copier's settings as a plain dict (empty when there's no file yet)."""
    cfg = configparser.ConfigParser()
    cfg.read(config_path(home), encoding="utf-8")
    return dict(cfg["copier"]) if cfg.has_section("copier") else {}


def default_config(home):
    """Settings for a fresh stick: MT5 from the stick's own MT5 folder when it's there."""
    on_stick = os.path.exists(os.path.join(home, MT5_ON_STICK))
    return {
        "feed_url": FEED_URL,
        "token": "",
        "lot": "bot",
        "dry_run": "false",
        "use_broker_stop": "false",
        "poll_seconds": "3",
        "max_late_minutes": "10",
        "max_open": "6",
        "markets": "XAUUSD,BTCUSD",
        "symbol_xauusd": "XAUUSD",
        "symbol_btcusd": "BTCUSD",
        "mt5_path": MT5_ON_STICK if on_stick else "",
        "mt5_portable": "true" if on_stick else "false",
    }


def save_config(home, changes):
    """Writes the settings file: what's there, with defaults for anything
    missing and `changes` on top. Returns the full settings."""
    values = {**default_config(home), **load_config(home), **changes}
    cfg = configparser.ConfigParser()
    cfg["copier"] = {k: str(v) for k, v in values.items()}
    tmp = config_path(home) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("; Written by the OG SIGNAL BOT app. Keep this file private.\n")
        cfg.write(f)
    os.replace(tmp, config_path(home))
    return values


def login_url(feed_url):
    """The sign-in address on the same site as the feed."""
    base = (feed_url or FEED_URL).split("/api/")[0].rstrip("/")
    return f"{base}/api/public/copier-login"


def sign_in(feed_url, username, password, post=None):
    """Signs in with an ogbot username and password. Returns (True, {token,
    name, expiresAt}) or (False, a message to show)."""
    if post is None:
        import requests

        post = requests.post
    try:
        r = post(
            login_url(feed_url),
            json={"username": username.strip(), "password": password},
            timeout=15,
        )
    except Exception:
        return False, "Can't reach ogbot.co.uk. Check the internet and try again."
    try:
        body = r.json()
    except Exception:
        return False, "ogbot.co.uk gave an answer I couldn't read. Try again in a minute."
    if body.get("ok") and str(body.get("token", "")).startswith("ogk_"):
        return True, {
            "token": body["token"],
            "name": body.get("name") or username.strip(),
            "expiresAt": body.get("expiresAt") or "",
        }
    return False, LOGIN_ERRORS.get(body.get("reason"), "Couldn't sign in. Try again.")


def site_url(feed_url, path):
    """An address on the same site as the feed."""
    base = (feed_url or FEED_URL).split("/api/")[0].rstrip("/")
    return f"{base}{path}"


def check_access(feed_url, token, get=None):
    """Asks ogbot.co.uk about the token (read only: it never locks it to this
    PC). Returns ("ok", {state, daysLeft, expiresAt, name, paused}),
    ("signin", None) when the token isn't valid any more, or ("offline", None)
    when the site can't be reached."""
    if not token:
        return "signin", None
    if get is None:
        import requests

        get = requests.get
    try:
        r = get(
            site_url(feed_url, "/api/public/copier-status"),
            headers={"x-copy-token": token},
            timeout=15,
        )
    except Exception:
        return "offline", None
    if getattr(r, "status_code", 200) == 401:
        return "signin", None
    try:
        body = r.json()
    except Exception:
        return "offline", None
    if not body.get("ok"):
        return "signin", None
    return "ok", {
        "state": body.get("state") or "active",
        "daysLeft": body.get("daysLeft"),
        "expiresAt": body.get("expiresAt") or "",
        "name": body.get("name") or "",
        "paused": bool(body.get("paused")),
    }


# Where MetaTrader 5 usually installs (any broker's build), checked in order.
MT5_PLACES = (
    r"C:\Program Files",
    r"C:\Program Files (x86)",
)


def find_mt5(home, places=MT5_PLACES, listdir=os.listdir, exists=os.path.exists):
    """terminal64.exe for the copier: the app's own MT5 folder first (portable),
    else an installed MetaTrader 5 (a Vantage build first). Returns (path,
    portable) or ("", False) when there isn't one."""
    own = os.path.join(home, MT5_ON_STICK)
    if exists(own):
        return own, True
    found = []
    for place in places:
        try:
            names = listdir(place)
        except Exception:
            continue
        for name in names:
            exe = os.path.join(place, name, "terminal64.exe")
            if exists(exe):
                found.append((0 if "vantage" in name.lower() else 1, exe))
    if not found:
        return "", False
    return sorted(found)[0][1], False


def wizard_step(config, access, mt5_path):
    """The setup wizard's next screen: "signin" (no token), "access" (none or
    run out: get or renew it), "mt5" (MetaTrader 5 isn't installed),
    "mt5_login" (MT5 has never been given an account), or "ready"."""
    if not config.get("token"):
        return "signin"
    if access is not None and access.get("state") != "active":
        return "access"
    if not mt5_path:
        return "mt5"
    if not config.get("mt5_login"):
        return "mt5_login"
    return "ready"


def algo_trading_off(last_lines):
    """Whether the copier stopped because Algo Trading is off in MT5."""
    return "algo trading" in " ".join(last_lines[-5:]).lower()


def parse_time(iso):
    try:
        t = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        return t if t.tzinfo else t.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def days_left(expires_iso, now=None):
    """Whole days of access left (0 once it has run out), or None when unknown."""
    t = parse_time(expires_iso)
    if t is None:
        return None
    now = now or datetime.now(timezone.utc)
    seconds = (t - now).total_seconds()
    return 0 if seconds <= 0 else int(-(-seconds // 86400))


def access_line(expires_iso, note=None, now=None):
    """The dashboard's line about access, in plain words."""
    if note:
        return note
    left = days_left(expires_iso, now)
    if left is None:
        return "Access: checking..."
    if left == 0:
        return "Your access has run out."
    until = parse_time(expires_iso).strftime("%d %b %Y")
    return f"Access: {left} day{'' if left == 1 else 's'} left (until {until})"


def read_status(home, now=None):
    """What the running copier last wrote (copier_status.json), with "running"
    added: True while the file is fresh. None when there's no usable file."""
    try:
        with open(os.path.join(home, "copier_status.json"), encoding="utf-8") as f:
            status = json.load(f)
    except Exception:
        return None
    if not isinstance(status, dict):
        return None
    at = parse_time(status.get("at"))
    now = now or datetime.now(timezone.utc)
    status["running"] = bool(at and (now - at).total_seconds() < STATUS_FRESH_SECONDS)
    return status


def money(value, currency=""):
    if value is None:
        return "-"
    return f"{float(value):,.2f} {currency}".strip()


def token_refused(last_lines):
    """Whether the copier stopped because its key isn't valid any more (so the
    app should ask the user to sign in again)."""
    text = " ".join(last_lines[-5:]).lower()
    return "forbidden" in text or "copy feed token" in text
