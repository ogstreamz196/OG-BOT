import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OR_FREE_ROUTER,
  forgetOpenRouterModels,
  loadOpenRouterModels,
  openRouterFreeModels,
  openRouterModelGone,
  paramsB,
  pickFreeModels,
  type OrModel,
} from "./openrouter-models.server";

const text = { input_modalities: ["text"], output_modalities: ["text"] };
const m = (id: string, context_length = 128_000, created = 1): OrModel => ({
  id,
  context_length,
  created,
  architecture: text,
});

afterEach(() => {
  forgetOpenRouterModels();
  vi.unstubAllGlobals();
});

describe("OpenRouter free models, picked from the live list", () => {
  it("reads the size from the id", () => {
    expect(paramsB("lab/big-550b-a55b:free")).toBe(550);
    expect(paramsB("lab/mid-31b-it:free")).toBe(31);
    expect(paramsB("lab/tiny-2.6b:free")).toBe(2.6);
    expect(paramsB("lab/flint-v1.0:free")).toBeNull();
  });

  it("free chat models only, biggest first; no safety, code, reasoning or tiny ones", () => {
    const list = [
      m("lab/paid-400b"),
      m("lab/mid-31b-it:free"),
      m("lab/big-550b-a55b:free"),
      m("lab/content-safety-30b:free"),
      m("lab/north-code-70b:free"),
      m("lab/omni-30b-reasoning:free"),
      m("lab/tiny-2.6b:free"),
      {
        id: "lab/image-only-90b:free",
        architecture: { input_modalities: ["image"], output_modalities: ["image"] },
      },
      m("lab/unsized:free", 262_000),
    ];
    expect(pickFreeModels(list)).toEqual([
      "lab/big-550b-a55b:free",
      "lab/mid-31b-it:free",
      "lab/unsized:free",
    ]);
    // A preferred model goes first while it's listed; a retired one is ignored.
    expect(pickFreeModels(list, "lab/mid-31b-it:free")[0]).toBe("lab/mid-31b-it:free");
    expect(pickFreeModels(list, "lab/retired:free")[0]).toBe("lab/big-550b-a55b:free");
  });

  it("before the list loads, or when it can't be read, OpenRouter's free router answers", async () => {
    expect(openRouterFreeModels()).toEqual([OR_FREE_ROUTER]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("down", { status: 503 })),
    );
    await loadOpenRouterModels(1_000);
    expect(openRouterFreeModels()).toEqual([OR_FREE_ROUTER]);
  });

  it("loads the list, uses the best two then the router, and drops a retired one at once", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: [m("lab/a-100b:free"), m("lab/b-70b:free"), m("lab/c-40b:free")],
        }),
      ),
    );
    await loadOpenRouterModels(1_000);
    expect(openRouterFreeModels()).toEqual(["lab/a-100b:free", "lab/b-70b:free", OR_FREE_ROUTER]);
    openRouterModelGone("lab/a-100b:free");
    expect(openRouterFreeModels()).toEqual(["lab/b-70b:free", "lab/c-40b:free", OR_FREE_ROUTER]);
  });
});
