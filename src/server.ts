import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

// h3 logs swallowed errors via console.error(error), but the platform log
// capture only stores error.message ("HTTPError") — never the stack. Wrap
// console.error so every logged Error also emits its stack as a plain string.
const origConsoleError = console.error.bind(console);

function isRequestAbort(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; message?: unknown; cause?: unknown };
  const name = typeof candidate.name === "string" ? candidate.name.toLowerCase() : "";
  const message = typeof candidate.message === "string" ? candidate.message.toLowerCase() : "";
  return (
    name === "aborterror" ||
    message === "aborted" ||
    message.includes("operation was aborted") ||
    (candidate.cause !== candidate && isRequestAbort(candidate.cause))
  );
}

console.error = (...args: unknown[]) => {
  if (args.some(isRequestAbort)) return;
  origConsoleError(...args);
  for (const arg of args) {
    if (arg instanceof Error && arg.stack) {
      origConsoleError("[error-stack]", arg.stack);
    }
  }
};

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(
  response: Response,
  requestSignal: AbortSignal,
): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  const capturedError = consumeLastCapturedError();
  if (requestSignal.aborted || isRequestAbort(capturedError)) {
    return new Response(null, { status: 499, statusText: "Client Closed Request" });
  }
  console.error(capturedError ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response, request.signal);
    } catch (error) {
      if (isRequestAbort(error) || request.signal.aborted) {
        return new Response(null, { status: 499, statusText: "Client Closed Request" });
      }
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
