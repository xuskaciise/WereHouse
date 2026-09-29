#!/usr/bin/env node
// Fails (exit 1) when a database table is not classified for data resets.
// Run as part of `npm run lint`.
//
// Rules:
//  - Every @@map("...") table in prisma/schema.prisma is in exactly one of
//    RESET_KEEP_TABLES / RESET_DELETE_TABLES (lib/reset-tables.ts).
//  - Both lists only name tables that exist.
//  - The keep list of the production reset (scripts/reset/reset-test-data.sql,
//    `keep_tables text[] := ARRAY[...]`) equals RESET_KEEP_TABLES.
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = process.cwd()
const read = (path) => readFileSync(join(ROOT, path), "utf8")

const schemaTables = [...read("prisma/schema.prisma").matchAll(/@@map\("([^"]+)"\)/g)].map((m) => m[1])

function listFrom(source, name) {
  const match = source.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const`))
  if (!match) throw new Error(`lib/reset-tables.ts: ${name} not found`)
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
}

const tablesSource = read("lib/reset-tables.ts")
const keep = listFrom(tablesSource, "RESET_KEEP_TABLES")
const del = listFrom(tablesSource, "RESET_DELETE_TABLES")

const sqlMatch = read("scripts/reset/reset-test-data.sql").match(/keep_tables text\[\] := ARRAY\[([^\]]*)\]/)
const sqlKeep = sqlMatch ? [...sqlMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : null

const errors = []
const schemaSet = new Set(schemaTables)
const seen = new Map()
for (const [list, tables] of [["RESET_KEEP_TABLES", keep], ["RESET_DELETE_TABLES", del]]) {
  for (const table of tables) {
    if (!schemaSet.has(table)) errors.push(`${list}: "${table}" is not a table in prisma/schema.prisma`)
    if (seen.has(table)) errors.push(`"${table}" is listed in both ${seen.get(table)} and ${list} (or twice)`)
    seen.set(table, list)
  }
}
for (const table of schemaTables) {
  if (!seen.has(table)) errors.push(`table "${table}" is not classified in lib/reset-tables.ts (keep or delete?)`)
}
if (!sqlKeep) {
  errors.push("scripts/reset/reset-test-data.sql: keep_tables array not found")
} else if ([...sqlKeep].sort().join() !== [...keep].sort().join()) {
  errors.push(`scripts/reset/reset-test-data.sql keep_tables (${sqlKeep.join(", ")}) differs from RESET_KEEP_TABLES (${keep.join(", ")})`)
}

if (errors.length) {
  console.error("Reset table check failed:")
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}
console.log(`Reset table check passed (${keep.length} kept, ${del.length} deleted, ${schemaTables.length} tables).`)
