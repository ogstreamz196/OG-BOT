"""
OG Copier: the app on the stick.

A small window for the copier (og_copier.py): sign in with your ogbot.co.uk
username and password, see your access and your MT5 account, and press Start.
Everything it keeps (the settings, the trade memory) sits in the same folder
as this app, so the whole thing lives on a USB stick.

Run from source:   python og_stick.py
As one file:       build_stick.bat makes OGCopier.exe (see STICK.md)

The copier itself runs as a second copy of this program started with
--copier, so pressing Stop (or closing the window) ends it cleanly apart from
open trades, which stay open until it is started again.
"""

import os
import queue
import subprocess
import sys
import threading

FROZEN = getattr(sys, "frozen", False)
HOME = os.path.dirname(sys.executable if FROZEN else os.path.abspath(__file__))

if "--copier" in sys.argv:
    # The copier half: the same loop as running og_copier.py by hand.
    os.environ.setdefault("OG_COPIER_HOME", HOME)
    import og_copier

    try:
        og_copier.main()
    except KeyboardInterrupt:
        pass
    finally:
        og_copier.mt5.shutdown()
    sys.exit(0)

import tkinter as tk  # noqa: E402
from tkinter import messagebox  # noqa: E402

import stick_core as core  # noqa: E402

BG = "#0b0f14"
CARD = "#131a22"
FG = "#e5e7eb"
MUTED = "#9ca3af"
GOOD = "#34d399"
WARN = "#fbbf24"
BAD = "#fb7185"
FONT = ("Segoe UI", 11)
BIG = ("Segoe UI", 16, "bold")


class App:
    def __init__(self, root):
        self.root = root
        self.proc = None
        self.lines = queue.Queue()
        self.recent = []
        # MT5 details typed this session: used for one start, never saved.
        self.mt5_once = None
        self.config = core.load_config(HOME)
        root.title("OG Copier")
        root.configure(bg=BG)
        root.geometry("460x640")
        root.minsize(420, 560)
        root.protocol("WM_DELETE_WINDOW", self.on_close)
        self.frame = None
        if len(self.config.get("token", "")) >= 24:
            self.show_dashboard()
        else:
            self.show_login()
        self.tick()

    # ── small helpers ─────────────────────────────────────────────────────
    def clear(self):
        if self.frame is not None:
            self.frame.destroy()
        self.frame = tk.Frame(self.root, bg=BG, padx=22, pady=18)
        self.frame.pack(fill="both", expand=True)
        return self.frame

    def label(self, parent, text="", colour=FG, font=FONT, **pack):
        widget = tk.Label(
            parent, text=text, fg=colour, bg=parent["bg"], font=font, anchor="w", justify="left"
        )
        widget.pack(fill="x", **pack)
        return widget

    def button(self, parent, text, command, colour=GOOD, **pack):
        widget = tk.Button(
            parent,
            text=text,
            command=command,
            bg=colour,
            fg="#04110b",
            activebackground=colour,
            relief="flat",
            font=("Segoe UI", 12, "bold"),
            padx=10,
            pady=8,
            cursor="hand2",
        )
        widget.pack(fill="x", **pack)
        return widget

    def entry(self, parent, show=None):
        widget = tk.Entry(
            parent,
            show=show,
            bg=CARD,
            fg=FG,
            insertbackground=FG,
            relief="flat",
            font=("Segoe UI", 12),
        )
        widget.pack(fill="x", ipady=7, pady=(2, 10))
        return widget

    # ── sign in ───────────────────────────────────────────────────────────
    def show_login(self, message=""):
        f = self.clear()
        self.label(f, "OG Copier", GOOD, BIG, pady=(8, 2))
        self.label(f, "Sign in with your ogbot.co.uk username and password.", MUTED, pady=(0, 16))
        self.label(f, "Username", MUTED)
        self.username = self.entry(f)
        self.label(f, "Password", MUTED)
        self.password = self.entry(f, show="*")
        self.login_note = self.label(f, message, BAD if message else MUTED, pady=(0, 8))
        self.login_button = self.button(f, "Sign in", self.sign_in)
        self.username.focus_set()
        self.root.bind("<Return>", lambda _e: self.sign_in())

    def sign_in(self):
        username = self.username.get().strip()
        password = self.password.get()
        if len(username) < 3 or len(password) < 6:
            self.login_note.config(text=core.LOGIN_ERRORS["bad_request"], fg=BAD)
            return
        self.login_button.config(state="disabled", text="Signing in...")
        self.login_note.config(text="", fg=MUTED)

        def work():
            feed = self.config.get("feed_url") or core.FEED_URL
            ok, result = core.sign_in(feed, username, password)
            self.root.after(0, lambda: self.signed_in(ok, result))

        threading.Thread(target=work, daemon=True).start()

    def signed_in(self, ok, result):
        if not ok:
            self.login_button.config(state="normal", text="Sign in")
            self.login_note.config(text=result, fg=BAD)
            return
        self.config = core.save_config(
            HOME,
            {"token": result["token"], "name": result["name"], "expires_at": result["expiresAt"]},
        )
        self.root.unbind("<Return>")
        self.show_dashboard()

    # ── dashboard ─────────────────────────────────────────────────────────
    def show_dashboard(self):
        f = self.clear()
        self.label(f, "OG Copier", GOOD, BIG, pady=(4, 0))
        self.who = self.label(f, f"Signed in as {self.config.get('name') or 'you'}", MUTED)
        self.access = self.label(f, "", FG, pady=(10, 0))

        card = tk.Frame(f, bg=CARD, padx=14, pady=12)
        card.pack(fill="x", pady=12)
        self.mt5_line = self.label(card, "MT5: not connected yet", FG)
        self.balance_line = self.label(card, "Balance: -", FG)
        self.trades_line = self.label(card, "Open trades: -", FG)
        self.today_line = self.label(card, "Today: -", FG)

        self.state_line = self.label(f, "Stopped", MUTED, ("Segoe UI", 12, "bold"))
        self.start_button = self.button(f, "Start", self.toggle, pady=(6, 8))

        self.practice = tk.BooleanVar(value=self.config.get("dry_run", "false") == "true")
        tk.Checkbutton(
            f,
            text="Practice mode (shows what it would do, places no orders)",
            variable=self.practice,
            command=self.set_practice,
            bg=BG,
            fg=MUTED,
            selectcolor=CARD,
            activebackground=BG,
            activeforeground=FG,
            font=("Segoe UI", 10),
            anchor="w",
        ).pack(fill="x")

        row = tk.Frame(f, bg=BG)
        row.pack(fill="x", pady=(8, 6))
        for text, command in (("MT5 account...", self.mt5_dialog), ("Sign out", self.sign_out)):
            tk.Button(
                row,
                text=text,
                command=command,
                bg=CARD,
                fg=FG,
                relief="flat",
                font=("Segoe UI", 10),
                padx=8,
                pady=5,
                cursor="hand2",
            ).pack(side="left", padx=(0, 8))

        self.log = tk.Text(
            f, height=9, bg=CARD, fg=MUTED, relief="flat", font=("Consolas", 9), wrap="word"
        )
        self.log.pack(fill="both", expand=True, pady=(4, 0))
        self.log.config(state="disabled")
        self.refresh()

    def set_practice(self):
        self.config = core.save_config(HOME, {"dry_run": "true" if self.practice.get() else "false"})
        if self.running():
            self.say("Practice mode changes the next time you press Start.")

    def say(self, text):
        self.recent = (self.recent + [text])[-200:]
        if not hasattr(self, "log") or not self.log.winfo_exists():
            return
        self.log.config(state="normal")
        self.log.insert("end", text + "\n")
        self.log.see("end")
        self.log.config(state="disabled")

    def running(self):
        return self.proc is not None and self.proc.poll() is None

    # ── start and stop ────────────────────────────────────────────────────
    def toggle(self):
        if self.running():
            self.stop()
        else:
            self.start()

    def start(self):
        on_stick = bool(self.config.get("mt5_path"))
        if on_stick and not self.config.get("mt5_login") and self.mt5_once is None:
            # A fresh stick: MT5 on it has never been logged in.
            self.mt5_dialog(then_start=True)
            return
        env = os.environ.copy()
        env["OG_COPIER_HOME"] = HOME
        env["PYTHONUNBUFFERED"] = "1"
        if self.mt5_once:
            env["OG_MT5_LOGIN"], env["OG_MT5_PASSWORD"], env["OG_MT5_SERVER"] = self.mt5_once
        command = [sys.executable, "--copier"]
        if not FROZEN:
            command = [sys.executable, os.path.abspath(__file__), "--copier"]
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        try:
            self.proc = subprocess.Popen(
                command,
                cwd=HOME,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                creationflags=flags,
            )
        except Exception as e:
            self.say(f"Couldn't start: {e}")
            return
        # The password was for this one start; MT5 remembers the login now.
        self.mt5_once = None
        threading.Thread(target=self.pump, args=(self.proc,), daemon=True).start()
        self.say("Starting...")
        self.refresh()

    def pump(self, proc):
        for line in proc.stdout:
            self.lines.put(line.rstrip())
        self.lines.put(None)

    def stop(self):
        if self.running():
            self.proc.terminate()
            self.say("Stopped. Open trades stay open: press Start to keep managing them.")
        self.refresh()

    def stopped_by_itself(self):
        if core.token_refused(self.recent):
            self.config = core.save_config(HOME, {"token": ""})
            self.show_login("Please sign in again.")

    # ── MT5 account ───────────────────────────────────────────────────────
    def mt5_dialog(self, then_start=False):
        win = tk.Toplevel(self.root)
        win.title("MT5 account")
        win.configure(bg=BG, padx=20, pady=16)
        win.transient(self.root)
        win.grab_set()
        self.label(win, "Your MT5 account", GOOD, ("Segoe UI", 13, "bold"))
        self.label(
            win,
            "As in the email from your broker. The password is used once to log\n"
            "MetaTrader in and is not saved by this app.",
            MUTED,
            ("Segoe UI", 9),
            pady=(0, 10),
        )
        self.label(win, "Account number", MUTED)
        login = self.entry(win)
        login.insert(0, self.config.get("mt5_login", ""))
        self.label(win, "Password", MUTED)
        password = self.entry(win, show="*")
        self.label(win, "Server (e.g. VantageInternational-Live 3)", MUTED)
        server = self.entry(win)
        server.insert(0, self.config.get("mt5_server", ""))
        note = self.label(win, "", BAD)

        def save():
            number = login.get().strip()
            if not number.isdigit() or not password.get() or not server.get().strip():
                note.config(text="Fill in all three (the account number is digits only).")
                return
            self.mt5_once = (number, password.get(), server.get().strip())
            self.config = core.save_config(
                HOME, {"mt5_login": number, "mt5_server": server.get().strip()}
            )
            win.destroy()
            if self.running():
                self.say("The new MT5 details are used the next time you press Start.")
            elif then_start:
                self.start()

        self.button(win, "Save", save)

    def sign_out(self):
        if self.running() and not messagebox.askyesno(
            "Sign out", "The copier is running. Stop it and sign out?\nOpen trades stay open."
        ):
            return
        self.stop()
        self.config = core.save_config(HOME, {"token": ""})
        self.show_login()

    # ── keeping the window up to date ─────────────────────────────────────
    def tick(self):
        try:
            while True:
                line = self.lines.get_nowait()
                if line is None:
                    self.say("The copier has stopped.")
                    self.stopped_by_itself()
                elif line:
                    self.say(line)
        except queue.Empty:
            pass
        if hasattr(self, "state_line") and self.state_line.winfo_exists():
            self.refresh()
        self.root.after(1000, self.tick)

    def refresh(self):
        running = self.running()
        status = core.read_status(HOME) if running else None
        self.state_line.config(
            text="Running" if running else "Stopped", fg=GOOD if running else MUTED
        )
        self.start_button.config(
            text="Stop" if running else "Start", bg=BAD if running else GOOD,
            activebackground=BAD if running else GOOD,
        )
        access = (status or {}).get("access") or {}
        expires = access.get("expiresAt") or self.config.get("expires_at", "")
        note = (status or {}).get("note")
        left = core.days_left(expires)
        self.access.config(
            text=core.access_line(expires, note),
            fg=WARN
            if note and access.get("ok")
            else BAD
            if note or left == 0
            else WARN
            if left is not None and left <= 3
            else FG,
        )
        if status and status.get("account"):
            currency = status.get("currency") or ""
            self.mt5_line.config(text=f"MT5: account {status['account']} ({status.get('server')})")
            self.balance_line.config(text=f"Balance: {core.money(status.get('balance'), currency)}")
            self.trades_line.config(text=f"Open trades: {status.get('open', 0)}")
            today = status.get("today")
            self.today_line.config(
                text=f"Today: {core.money(today, currency)}",
                fg=FG if not today else GOOD if today > 0 else BAD,
            )
        elif not running:
            self.mt5_line.config(text="MT5: connects when you press Start")

    def on_close(self):
        if self.running() and not messagebox.askyesno(
            "Close",
            "The copier is running. Closing stops it.\n"
            "Open trades stay open and are not managed until you start it again.\n\nClose anyway?",
        ):
            return
        if self.running():
            self.proc.terminate()
        self.root.destroy()


def main():
    root = tk.Tk()
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()
