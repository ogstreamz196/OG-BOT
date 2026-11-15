# OG Copier on a USB stick

The stick app (`og_stick.py`, built into `OGCopier.exe`) is a small window for
the copier: the user signs in with their ogbot.co.uk username and password,
sees their access and MT5 account, and presses Start. Windows only (the MT5
link only exists for Windows).

Each user's key is locked, the first time it runs, to that stick and to one
MT5 account. Only the Boss can reset that (Copy Trader B0T → 👥 Copier users).

## Making the app (once, on any Windows PC)

1. Install Python 3.12 (64-bit) from python.org, ticking "Add python.exe to PATH".
2. Put this folder on the PC and double-click `build_stick.bat`.
3. The app is `dist\OGCopier.exe`. The same file goes on every stick.

## Making a stick

1. Make a folder on the stick, e.g. `E:\OGCopier`, and copy `OGCopier.exe` into it.
2. MetaTrader 5 on the stick: run the broker's MT5 installer, press Settings
   on its first screen and set the folder to `E:\OGCopier\MT5`. When it has
   installed, close MT5, then start it once by hand as
   `E:\OGCopier\MT5\terminal64.exe /portable` and switch on **Algo Trading**
   in the toolbar (it goes green). Close it again.
   The app finds `MT5\terminal64.exe` next to itself and runs it in portable
   mode, so MT5 keeps its login and data on the stick.
   Without an `MT5` folder the app uses the MT5 installed on the PC instead.
3. Nothing else: the app writes its own `config.ini` on first sign-in.

## Giving it to someone

1. In the Copy Trader B0T: `/adduser theirusername 30` (their ogbot.co.uk
   username, then the days of access). They need an ogbot.co.uk account.
2. They plug the stick in, open `OGCopier.exe` and sign in.
3. The first time they press Start it asks for their MT5 account number,
   password and server. The password logs MetaTrader in once and is not
   saved by the app. That account and that stick are now the only ones the
   key works with.
4. "Practice mode" shows what it would do without placing orders. Use it for
   a first check.

## What the user sees

- Days of access left, and a clear line when it has run out or been switched off.
- The MT5 account, balance, open copied trades and today's result.
- Start / Stop, and a log of what the copier is doing.

When access runs out or is switched off, the copier opens nothing new but
still closes the trades it has open. Stopping the app or pulling the stick
leaves open trades unmanaged until it is started again: turn on the safety
stop on the copier card if that worries you.

## Away from the PC

A user can check on their copier from anywhere with the same account:

- **Website:** ogbot.co.uk/copier shows their days left, whether the app is
  running, the MT5 account and the balance last seen.
- **Telegram:** `/mycopier` in the Copy Trader B0T shows the same (their
  Telegram has to be linked to their ogbot.co.uk account).

Both have **Pause new trades / Resume**. Pausing stops new trades; open ones
are still managed while the app runs. Starting and stopping the app itself
is only done on the PC.

## Managing people (the Boss)

Copy Trader B0T → 👥 Copier users: add days, switch someone off or back on,
reset the stick and account lock (a new stick, or a new MT5 account), make a
new key, or remove them. Everyone follows the settings on the ⚙️ Copier
settings card.

## Files on the stick

- `OGCopier.exe`: the app.
- `MT5\`: MetaTrader 5 (portable).
- `config.ini`: written by the app; holds the user's key. Keep it private.
- `copier_state.json`: which trades the copier opened.
- `copier_status.json`: what the dashboard shows.
