"""Tests for stick_core.py. Run:  python -m unittest test_stick_core"""

import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

import stick_core as core


class Reply:
    def __init__(self, body):
        self.body = body

    def json(self):
        if self.body is None:
            raise ValueError("not json")
        return self.body


class StickCore(unittest.TestCase):
    def test_fresh_stick_uses_mt5_from_its_own_folder(self):
        with tempfile.TemporaryDirectory() as home:
            self.assertEqual(core.default_config(home)["mt5_portable"], "false")
            os.makedirs(os.path.join(home, "MT5"))
            open(os.path.join(home, core.MT5_ON_STICK), "w").close()
            d = core.default_config(home)
            self.assertEqual(d["mt5_path"], core.MT5_ON_STICK)
            self.assertEqual(d["mt5_portable"], "true")
            self.assertEqual(d["dry_run"], "false")

    def test_settings_are_kept_between_saves(self):
        with tempfile.TemporaryDirectory() as home:
            core.save_config(home, {"token": "ogk_" + "a" * 32, "name": "Sam"})
            core.save_config(home, {"dry_run": "true"})
            c = core.load_config(home)
            self.assertEqual(c["token"], "ogk_" + "a" * 32)
            self.assertEqual(c["name"], "Sam")
            self.assertEqual(c["dry_run"], "true")
            self.assertEqual(c["feed_url"], core.FEED_URL)

    def test_sign_in_address_is_on_the_feeds_site(self):
        self.assertEqual(
            core.login_url("https://ogbot.co.uk/api/public/copy-feed"),
            "https://ogbot.co.uk/api/public/copier-login",
        )
        self.assertEqual(core.login_url(""), "https://ogbot.co.uk/api/public/copier-login")

    def test_sign_in_results(self):
        sent = {}

        def post(url, json=None, timeout=None):
            sent.update(url=url, json=json)
            return Reply({"ok": True, "token": "ogk_abc", "name": "Sam", "expiresAt": "2027-01-01T00:00:00Z"})

        ok, data = core.sign_in("", " sam ", "secret1", post)
        self.assertTrue(ok)
        self.assertEqual(data["token"], "ogk_abc")
        self.assertEqual(sent["json"], {"username": "sam", "password": "secret1"})

        for reason in ("bad_login", "too_many", "no_access"):
            ok, message = core.sign_in("", "sam", "secret1", lambda *a, **k: Reply({"ok": False, "reason": reason}))
            self.assertFalse(ok)
            self.assertEqual(message, core.LOGIN_ERRORS[reason])

        ok, message = core.sign_in("", "sam", "secret1", lambda *a, **k: Reply(None))
        self.assertFalse(ok)

        def down(*a, **k):
            raise OSError("no network")

        ok, message = core.sign_in("", "sam", "secret1", down)
        self.assertFalse(ok)
        self.assertIn("Can't reach", message)

    def test_days_left(self):
        now = datetime(2026, 11, 13, 12, 0, tzinfo=timezone.utc)
        iso = lambda d: (now + d).isoformat()
        self.assertEqual(core.days_left(iso(timedelta(days=30)), now), 30)
        self.assertEqual(core.days_left(iso(timedelta(hours=1)), now), 1)
        self.assertEqual(core.days_left(iso(timedelta(hours=-1)), now), 0)
        self.assertIsNone(core.days_left("", now))
        self.assertIn("1 day left", core.access_line(iso(timedelta(hours=5)), None, now))
        self.assertEqual(core.access_line(iso(timedelta(days=-1)), None, now), "Your access has run out.")
        self.assertEqual(core.access_line(iso(timedelta(days=5)), "Switched off.", now), "Switched off.")

    def test_status_file(self):
        with tempfile.TemporaryDirectory() as home:
            self.assertIsNone(core.read_status(home))
            now = datetime(2026, 11, 13, 12, 0, tzinfo=timezone.utc)
            path = os.path.join(home, "copier_status.json")
            with open(path, "w") as f:
                json.dump({"at": (now - timedelta(seconds=5)).isoformat(), "balance": 412.5}, f)
            s = core.read_status(home, now)
            self.assertTrue(s["running"])
            self.assertEqual(s["balance"], 412.5)
            self.assertFalse(core.read_status(home, now + timedelta(minutes=2))["running"])
            with open(path, "w") as f:
                f.write("not json")
            self.assertIsNone(core.read_status(home))

    def test_small_things(self):
        self.assertEqual(core.money(1234.5, "USD"), "1,234.50 USD")
        self.assertEqual(core.money(None), "-")
        self.assertTrue(core.token_refused(["x", "The feed said Forbidden: check the token in config.ini."]))
        self.assertFalse(core.token_refused(["This key is locked to a different USB stick."]))



class Wizard(unittest.TestCase):
    def test_access_check_reads_the_site(self):
        class R:
            def __init__(self, code, body):
                self.status_code, self.body = code, body

            def json(self):
                return self.body

        good = R(200, {"ok": True, "state": "active", "daysLeft": 12, "expiresAt": "2026-12-01T00:00:00Z", "name": "Sam"})
        seen = {}

        def get(url, headers, timeout):
            seen["url"], seen["token"] = url, headers["x-copy-token"]
            return good

        kind, info = core.check_access(core.FEED_URL, "ogk_" + "a" * 32, get=get)
        self.assertEqual(kind, "ok")
        self.assertEqual(info["daysLeft"], 12)
        self.assertEqual(seen["url"], "https://ogbot.co.uk/api/public/copier-status")
        self.assertEqual(core.check_access(core.FEED_URL, "ogk_x", get=lambda *a, **k: R(401, {}))[0], "signin")
        self.assertEqual(core.check_access(core.FEED_URL, "", get=get)[0], "signin")

        def down(*a, **k):
            raise OSError("no internet")

        self.assertEqual(core.check_access(core.FEED_URL, "ogk_x", get=down)[0], "offline")

    def test_finds_mt5_its_own_folder_first_then_vantage(self):
        pf = r"C:\Program Files"
        files = {
            os.path.join(pf, "MetaTrader 5", "terminal64.exe"),
            os.path.join(pf, "Vantage International MT5 Terminal", "terminal64.exe"),
        }
        dirs = {r"C:\Program Files": ["MetaTrader 5", "Vantage International MT5 Terminal", "Other"]}
        listdir = lambda p: dirs[p] if p in dirs else (_ for _ in ()).throw(OSError())
        exists = lambda p: p in files
        path, portable = core.find_mt5(r"D:\app", listdir=listdir, exists=exists)
        self.assertIn("Vantage", path)
        self.assertFalse(portable)
        files.add(os.path.join(r"D:\app", core.MT5_ON_STICK))
        self.assertTrue(core.find_mt5(r"D:\app", listdir=listdir, exists=exists)[1])
        self.assertEqual(core.find_mt5(r"D:\app", listdir=lambda p: [], exists=lambda p: False), ("", False))

    def test_wizard_goes_step_by_step(self):
        active = {"state": "active"}
        self.assertEqual(core.wizard_step({}, None, ""), "signin")
        self.assertEqual(core.wizard_step({"token": "t"}, {"state": "expired"}, "x"), "access")
        self.assertEqual(core.wizard_step({"token": "t"}, active, ""), "mt5")
        self.assertEqual(core.wizard_step({"token": "t"}, active, "x"), "mt5_login")
        self.assertEqual(core.wizard_step({"token": "t", "mt5_login": "123"}, active, "x"), "ready")
        # Offline (access unknown): carry on with what it knows.
        self.assertEqual(core.wizard_step({"token": "t", "mt5_login": "1"}, None, "x"), "ready")

    def test_spots_algo_trading_off(self):
        self.assertTrue(core.algo_trading_off(["Turn on Algo Trading in MetaTrader 5 (the button in the toolbar)."]))
        self.assertFalse(core.algo_trading_off(["Connected to Vantage"]))

if __name__ == "__main__":
    unittest.main()
