// The migrations checklist (docs/migrations-checklist.md) and its verification
// query must cover every migration: add one and forget to re-run
// `node scripts/hub/migrations-checklist.mjs`, and this fails.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("migrations checklist", () => {
  const migrations = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql"));
  const checklist = readFileSync("docs/migrations-checklist.md", "utf8");
  const verify = readFileSync("supabase/hub/verify_migrations.sql", "utf8");

  it("lists every migration (re-run scripts/hub/migrations-checklist.mjs)", () => {
    const missing = migrations.filter((f) => !checklist.includes(`\`${f}\``));
    expect(missing).toEqual([]);
  });

  it("has a verification query that only reads", () => {
    expect(verify).toMatch(/^-- GENERATED/);
    // Outside the quoted object names and comments, no statement that writes.
    const code = verify.replace(/^--[^\n]*/gm, "").replace(/'(?:[^']|'')*'/g, "''");
    expect(code).not.toMatch(/\b(insert|update|delete|drop|alter|create|truncate|grant)\b/i);
    expect(code.trim()).toMatch(/^with schemas/);
  });
});
