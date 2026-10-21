import { describe, expect, it } from "bun:test";
import { neededPlugins } from "./message-response";

describe("chat reply plugins", () => {
  it("loads nothing extra for plain chat", () => {
    expect(neededPlugins("Yo, that's £5 and 50% off, no cap")).toEqual([]);
    expect(neededPlugins("costs $5 or $10")).toEqual([]);
  });
  it("loads only what a reply uses", () => {
    expect(neededPlugins("```js\nconsole.log(1)\n```")).toEqual(["code"]);
    expect(neededPlugins("$$x^2$$")).toEqual(["math"]);
    expect(neededPlugins("```mermaid\ngraph TD\n```")).toEqual(["mermaid", "code"]);
  });
});
