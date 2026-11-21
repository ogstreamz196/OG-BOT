import { createFileRoute } from "@tanstack/react-router";
import copier from "../../../../tools/mt5-copier/og_copier.py?raw";
import requirements from "../../../../tools/mt5-copier/requirements.txt?raw";

// The OG SIGNAL BOT copier's files for members who bought a token (their
// /copier page links here), served straight from tools/mt5-copier so they
// always get the current version (the 2%/1% lot cap included). Public: the
// files hold no secret; the token on the member's page is the access.
const FILES: Record<string, { body: string; type: string }> = {
  "og_copier.py": { body: copier, type: "text/x-python; charset=utf-8" },
  "requirements.txt": { body: requirements, type: "text/plain; charset=utf-8" },
  // The members' starter: installs what the copier needs (first run), then
  // runs it with their Python 3. Windows wants CRLF in a batch file.
  "start_og_signal_bot.bat": {
    body: [
      "@echo off",
      "rem Starts the OG SIGNAL BOT copier. Double-click this file.",
      'cd /d "%~dp0"',
      "title OG SIGNAL BOT",
      "py -3 -m pip install --quiet --disable-pip-version-check -r requirements.txt",
      "py -3 og_copier.py",
      "echo.",
      "echo The copier has stopped. Press any key to close this window.",
      "pause >nul",
      "",
    ].join("\r\n"),
    type: "application/x-bat; charset=utf-8",
  },
};

export const Route = createFileRoute("/api/public/copier-files/$name")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const file = FILES[params.name];
        if (!file) return new Response("Not found", { status: 404 });
        return new Response(file.body, {
          headers: {
            "content-type": file.type,
            "content-disposition": `attachment; filename="${params.name}"`,
            "cache-control": "public, max-age=300",
          },
        });
      },
    },
  },
});
