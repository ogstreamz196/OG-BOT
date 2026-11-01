#!/usr/bin/env node
// Builds the migrations checklist (docs/migrations-checklist.md) and the
// verification query (supabase/hub/verify_migrations.sql) from every file in
// supabase/migrations plus supabase/hub/01_drift_from_live.sql (the changes
// Lovable made on live outside the migrations), applied in order: what's
// created is expected, what's dropped or renamed later is taken off again.
//
//   node scripts/hub/migrations-checklist.mjs
//
// The query returns one row per object that's MISSING, so an empty result
// means every migration is in. Run it on the hub (schema og_bot) before and
// after switch day, and on Lovable Cloud (schemas public, private) to catch
// anything Lovable changed outside the migrations. Read only.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../..", import.meta.url).pathname;
const migDir = join(root, "supabase/migrations");
const files = readdirSync(migDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ name: f, path: join(migDir, f) }));
files.push({
  name: "hub/01_drift_from_live.sql",
  path: join(root, "supabase/hub/01_drift_from_live.sql"),
});

/** Statements without comments and function bodies, so only real DDL is read. */
function statements(sql) {
  const noBodies = sql.replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "''");
  const noComments = noBodies.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  return noComments
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const id = String.raw`(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))`;
const q = (m, i) => (m[i] ?? m[i + 1] ?? "").toLowerCase();
const qualified = String.raw`(?:(?:public|private|og_bot)\.)?`;
const rx = (s) => new RegExp(s, "i");

const R = {
  createTable: rx(`^create (?:unlogged )?table (?:if not exists )?${qualified}${id}`),
  dropTable: rx(`^drop table (?:if exists )?${qualified}${id}`),
  renameTable: rx(`^alter table (?:if exists )?(?:only )?${qualified}${id} rename to ${id}`),
  addColumn: rx(
    `^alter table (?:if exists )?(?:only )?${qualified}${id} (.*)$`,
  ),
  createFn: rx(`^create (?:or replace )?function ${qualified}${id}\\s*\\(`),
  dropFn: rx(`^drop function (?:if exists )?${qualified}${id}`),
  createIndex: rx(
    `^create (?:unique )?index (?:concurrently )?(?:if not exists )?${id} on (?:only )?${qualified}${id}`,
  ),
  dropIndex: rx(`^drop index (?:concurrently )?(?:if exists )?${qualified}${id}`),
  createPolicy: rx(`^create policy ${id} on ${qualified}${id}`),
  dropPolicy: rx(`^drop policy (?:if exists )?${id} on ${qualified}${id}`),
  createTrigger: rx(
    `^create (?:or replace )?(?:constraint )?trigger ${id} .*? on ${qualified}${id}`,
  ),
  dropTrigger: rx(`^drop trigger (?:if exists )?${id} on ${qualified}${id}`),
  createView: rx(`^create (?:or replace )?(?:materialized )?view ${qualified}${id}`),
  dropView: rx(`^drop (?:materialized )?view (?:if exists )?${qualified}${id}`),
  cron: rx(`^select cron\\.schedule\\s*\\(\\s*'([^']+)'`),
};

// Objects outside our schemas (auth, storage, cron, realtime) are skipped.
const foreign = /^(?:create|alter|drop) \w+(?: \w+)* (?:auth|storage|cron|realtime|extensions)\./i;

/** kind|name|table → { kind, name, table, from } */
const expected = new Map();
const perFile = [];
const cronJobs = new Map();
/** Access rules on file storage (storage.objects): they move with the files, not with og_bot. */
const storageRules = new Map();
const onForeign = /\bon (?:only )?(?:auth|storage|cron|realtime|extensions)\./i;
const key = (kind, name, table = "") => `${kind}|${name}|${table}`;

for (const f of files) {
  const added = [];
  const add = (kind, name, table = "") => {
    const k = key(kind, name, table);
    if (!expected.has(k)) added.push(k);
    expected.set(k, { kind, name, table, from: f.name });
  };
  const drop = (pred) => {
    for (const [k, v] of expected) if (pred(v)) expected.delete(k);
  };
  for (const s of statements(readFileSync(f.path, "utf8"))) {
    if (foreign.test(s)) continue;
    let m;
    // Policies, triggers and indexes on another schema's tables (file storage,
    // sign-in): not part of og_bot. Storage rules are listed on their own.
    if (onForeign.test(s)) {
      const p = rx(`^create policy ${id} on storage\\.`).exec(s);
      if (p) storageRules.set(q(p, 1), f.name);
      const d = rx(`^drop policy (?:if exists )?${id} on storage\\.`).exec(s);
      if (d) storageRules.delete(q(d, 1));
      continue;
    }
    if ((m = R.cron.exec(s))) cronJobs.set(m[1], f.name);
    else if ((m = R.createTable.exec(s))) add("table", q(m, 1));
    else if ((m = R.dropTable.exec(s))) {
      const t = q(m, 1);
      drop((v) => (v.kind === "table" && v.name === t) || v.table === t);
    } else if ((m = R.renameTable.exec(s))) {
      const [from, to] = [q(m, 1), q(m, 3)];
      for (const [k, v] of [...expected]) {
        if (v.kind === "table" && v.name === from) {
          expected.delete(k);
          add("table", to);
        } else if (v.table === from) {
          expected.delete(k);
          add(v.kind, v.name, to);
        }
      }
    } else if ((m = R.createFn.exec(s))) add("function", q(m, 1));
    else if ((m = R.dropFn.exec(s))) {
      const n = q(m, 1);
      drop((v) => v.kind === "function" && v.name === n);
    } else if ((m = R.createIndex.exec(s))) add("index", q(m, 1), q(m, 3));
    else if ((m = R.dropIndex.exec(s))) {
      const n = q(m, 1);
      drop((v) => v.kind === "index" && v.name === n);
    } else if ((m = R.createPolicy.exec(s))) add("policy", q(m, 1), q(m, 3));
    else if ((m = R.dropPolicy.exec(s))) {
      const [n, t] = [q(m, 1), q(m, 3)];
      drop((v) => v.kind === "policy" && v.name === n && v.table === t);
    } else if ((m = R.createTrigger.exec(s))) add("trigger", q(m, 1), q(m, 3));
    else if ((m = R.dropTrigger.exec(s))) {
      const [n, t] = [q(m, 1), q(m, 3)];
      drop((v) => v.kind === "trigger" && v.name === n && v.table === t);
    } else if ((m = R.createView.exec(s))) add("view", q(m, 1));
    else if ((m = R.dropView.exec(s))) {
      const n = q(m, 1);
      drop((v) => v.kind === "view" && v.name === n);
    } else if ((m = R.addColumn.exec(s))) {
      // ALTER TABLE t ADD COLUMN …, DROP COLUMN …, RENAME COLUMN a TO b
      const t = q(m, 1);
      const rest = m[3];
      for (const a of rest.matchAll(new RegExp(String.raw`add column (?:if not exists )?${id}`, "gi")))
        add("column", (a[1] ?? a[2]).toLowerCase(), t);
      for (const d of rest.matchAll(new RegExp(String.raw`drop column (?:if exists )?${id}`, "gi"))) {
        const c = (d[1] ?? d[2]).toLowerCase();
        drop((v) => v.kind === "column" && v.name === c && v.table === t);
      }
      const rn = new RegExp(String.raw`rename column ${id} to ${id}`, "i").exec(rest);
      if (rn) {
        const [a, b] = [(rn[1] ?? rn[2]).toLowerCase(), (rn[3] ?? rn[4]).toLowerCase()];
        drop((v) => v.kind === "column" && v.name === a && v.table === t);
        add("column", b, t);
      }
    }
  }
  perFile.push({ file: f.name, added });
}

// Only what's still expected at the end (later drops win).
const finalList = [...expected.values()].sort((a, b) =>
  `${a.kind}${a.table}${a.name}`.localeCompare(`${b.kind}${b.table}${b.name}`),
);
const esc = (s) => s.replace(/'/g, "''");

const sql = `-- GENERATED by scripts/hub/migrations-checklist.mjs: don't edit by hand.
-- Every object OG B0T's migrations (and the recorded live drift) leave
-- behind, and whether it exists. Returns only what's MISSING: no rows means
-- every migration is in. Read only.
--
-- Schemas to look in: the hub is og_bot; Lovable Cloud is public, private.
with schemas(n) as (values ('og_bot')),
expected(kind, name, tbl, from_file) as (values
${finalList.map((o) => `  ('${o.kind}', '${esc(o.name)}', '${esc(o.table)}', '${esc(o.from)}')`).join(",\n")}
),
present as (
  select 'table' kind, c.relname name, '' tbl from pg_class c join pg_namespace s on s.oid = c.relnamespace
    where c.relkind in ('r','p') and s.nspname in (select n from schemas)
  union all select 'view', c.relname, '' from pg_class c join pg_namespace s on s.oid = c.relnamespace
    where c.relkind in ('v','m') and s.nspname in (select n from schemas)
  union all select 'column', a.attname, c.relname from pg_attribute a join pg_class c on c.oid = a.attrelid
    join pg_namespace s on s.oid = c.relnamespace
    where a.attnum > 0 and not a.attisdropped and s.nspname in (select n from schemas)
  union all select 'function', p.proname, '' from pg_proc p join pg_namespace s on s.oid = p.pronamespace
    where s.nspname in (select n from schemas)
  union all select 'index', i.relname, t.relname from pg_index x join pg_class i on i.oid = x.indexrelid
    join pg_class t on t.oid = x.indrelid join pg_namespace s on s.oid = t.relnamespace
    where s.nspname in (select n from schemas)
  union all select 'policy', p.policyname, p.tablename from pg_policies p where p.schemaname in (select n from schemas)
  union all select 'trigger', g.tgname, c.relname from pg_trigger g join pg_class c on c.oid = g.tgrelid
    join pg_namespace s on s.oid = c.relnamespace where not g.tgisinternal and s.nspname in (select n from schemas)
)
select e.kind, e.name, nullif(e.tbl, '') as on_table, e.from_file
from expected e
where not exists (
  select 1 from present p
  where p.kind = e.kind and lower(p.name) = e.name and (e.tbl = '' or lower(p.tbl) = e.tbl)
)
order by e.from_file, e.kind, e.name;
`;
writeFileSync(join(root, "supabase/hub/verify_migrations.sql"), sql);

const counts = finalList.reduce((m, o) => ((m[o.kind] = (m[o.kind] ?? 0) + 1), m), {});
const stillThere = new Set(finalList.map((o) => key(o.kind, o.name, o.table)));
const lines = [
  "# Migrations checklist",
  "",
  "<!-- GENERATED by scripts/hub/migrations-checklist.mjs from supabase/migrations",
  "     and supabase/hub/01_drift_from_live.sql. Don't edit the lists by hand;",
  "     re-run the script after adding a migration. -->",
  "",
  "Every database change OG B0T has ever had, and how to prove each one is in",
  "the OGSTREAMZ hub (`og_bot`) before and after the move off Lovable. Nothing",
  "here changes any data: the check only reads.",
  "",
  "## How to verify",
  "",
  "1. Run `node scripts/hub/migrations-checklist.mjs` (rebuilds this page and",
  "   the query from the repo).",
  "2. Run `supabase/hub/verify_migrations.sql` on the hub (Supabase → OGSTREAMZ",
  "   → SQL editor, or a Claude through the Supabase connection). **No rows =",
  "   every migration is in.** Any row is an object that's missing, with the",
  "   migration it came from.",
  "3. Run the same query on Lovable Cloud with the schemas line changed to",
  "   `values ('public'), ('private')`. Rows there mean Lovable's live database",
  "   is missing something; extra objects on live that no migration made are",
  "   the other way round: compare with `scripts/hub/build-og-bot-init.sh`",
  "   (it records drift into `01_drift_from_live.sql`).",
  "4. Tick the boxes below and note the date and the result in",
  "   `docs/claude-sync-log.md`.",
  "",
  "## Switch-day checks",
  "",
  "- [ ] No new migration since the last hub check (`git log -- supabase/migrations`).",
  "- [ ] `verify_migrations.sql` on the hub: no rows.",
  "- [ ] The same query on Lovable Cloud (`public`, `private`): no rows.",
  "- [ ] No drift: `build-og-bot-init.sh` run against live again finds nothing new.",
  "- [ ] Row counts match table by table after the data copy (`og_bot` vs Lovable Cloud).",
  "- [ ] Storage: song files reachable (Drive / R2), avatars and images copied.",
  `- [ ] File storage access rules recreated with the files (${storageRules.size} in the migrations: ${[...storageRules.keys()].map((n) => `\`${n}\``).join(", ")}). Not part of \`og_bot\`, so the query above doesn't check them.`,
  `- [ ] Scheduled jobs recreated (${cronJobs.size} in the migrations: ${[...cronJobs.keys()].map((n) => `\`${n}\``).join(", ")}), pointing at the new host.`,
  "- [ ] Edge functions deployed to the hub with their secrets.",
  "- [ ] Realtime publication includes the same tables.",
  "- [ ] A dummy account signs in with its old password on beta.",
  "",
  "## What's expected",
  "",
  `${finalList.length} objects in total: ${Object.entries(counts)
    .map(([k, n]) => `${n} ${{ index: "indexes", policy: "access rules" }[k] ?? `${k}s`}`)
    .join(", ")}. Columns made inside a \`create table\` are covered by the`,
  "table itself; the columns listed are the ones added to a table later.",
  "",
  "## By migration",
  "",
  "Each migration with what it leaves in place today (objects dropped or renamed by",
  "a later migration aren't listed under the earlier one).",
  "",
];
for (const { file, added } of perFile) {
  const live = added.filter((k) => stillThere.has(k));
  const what = live.length
    ? live
        .map((k) => {
          const [kind, name, table] = k.split("|");
          return `${kind} \`${name}\`${table ? ` on \`${table}\`` : ""}`;
        })
        .join(", ")
    : "no lasting objects (data, access or settings changes only)";
  lines.push(`- [ ] \`${file}\`: ${what}`);
}
lines.push("");
writeFileSync(join(root, "docs/migrations-checklist.md"), lines.join("\n"));
console.log(
  `${files.length} files, ${finalList.length} objects (${Object.entries(counts)
    .map(([k, n]) => `${k} ${n}`)
    .join(", ")}), ${cronJobs.size} cron jobs`,
);
