# OG B0T → MT5 copier (Python, free, no MetaApi)

Copies the OG Trade Bot's signals into your own Vantage MT5 account. It runs
on a Windows PC (or a Windows VPS) next to the MetaTrader 5 terminal, using
the free `MetaTrader5` Python package. The Python package only works on
Windows, with the MT5 terminal open and logged in.

What it does, every 3 seconds:

| The bot | The copier |
| --- | --- |
| a signal fills (entry reached) | opens a market order, `lot` lots |
| TP1 banked on a runner | closes half |
| price reaches the bot's stop (original, profit lock or trailing) | closes the rest at market |
| the signal is over (stopped, TP, time-up, called off) | closes the rest at market |

No stop loss or take profit is put on the broker (the house rule), so it
must keep running while trades are open. Set `use_broker_stop = true` for a
safety stop at the broker in case the PC goes off.

## Setup

1. **MT5.** Install MetaTrader 5 from Vantage's site. Log in to your Vantage
   account (start with a **demo** account). In the toolbar, turn on
   **Algo Trading** (it goes green). In Market Watch, right-click → Show All,
   and note the exact names for gold and bitcoin (e.g. `XAUUSD`, `BTCUSD`;
   some accounts add a suffix like `XAUUSD+`).
2. **Python.** Install Python 3.12 (64-bit) from python.org. Tick
   **"Add python.exe to PATH"** on the first screen.
3. **The copier.** Put this folder (`og_copier.py`, `requirements.txt`,
   `config.example.ini`) on the PC, e.g. `C:\og-copier`. Open Command Prompt
   there and run:
   ```
   pip install -r requirements.txt
   copy config.example.ini config.ini
   notepad config.ini
   ```
4. **The token.** In Lovable → Cloud → Database → `site_content`, open the
   row with key `copy.feedToken` and copy its value into `token =` in
   `config.ini`. Fix `symbol_XAUUSD` / `symbol_BTCUSD` if your names differ.
   Keep `dry_run = true` for now. Save.
5. **Dry run.** `python og_copier.py`. It should say "Connected to …" and,
   when the bot posts and a signal fills, print "(dry run) would open …".
6. **Live (demo first).** Set `dry_run = false`, run it again, and watch a
   few trades copy on the demo. Then log MT5 in to the real account (same
   PC) and run it.
7. **Keep it running.** Leave the window open; Windows sleep off
   (Settings → System → Power → Never). If it stops, start it again: it
   remembers its trades in `copier_state.json` and carries on.
   For 24/7, use a Windows VPS (ask Vantage whether they give one free
   for funded accounts; otherwise any cheap Windows VPS).

## Settings (`config.ini`)

- `lot`: lots per trade. 0.02 by default so half (0.01) can close at TP1.
  At 0.01 it can't split, so the whole lot rides the trailing stop.
- `max_late_minutes`: don't jump into a signal that filled longer ago.
- `max_open`: most copied trades open at once.
- `markets`: `XAUUSD,BTCUSD`, or just one.

## Safety

- `config.ini` holds the token: don't share it. A new token in
  `site_content` (`copy.feedToken`) locks the old one out.
- It never touches trades it didn't open (magic number 196196).
- Trading is risky; nothing here is financial advice.
