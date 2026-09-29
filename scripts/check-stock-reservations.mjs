// Read-only reconciliation of sales stock reservations:
//   node --env-file=.env scripts/check-stock-reservations.mjs   (npm run check:reservations)
// Runs the checks of scripts/readonly/stock-reservations-check.sql in a READ
// ONLY transaction, prints the database host only (never the URL) and exits
// with 1 when anything does not reconcile. On production run the .sql file
// with psql inside the db container instead.
import { readFileSync } from "node:fs"
import pg from "pg"

const url = process.env.DATABASE_URL
if (!url) {
  console.error("DATABASE_URL is not set")
  process.exit(2)
}
console.log(`database host: ${new URL(url).hostname}`)

// The psql file split into its sections: "\echo 'title'" followed by one query.
const sql = readFileSync(new URL("./readonly/stock-reservations-check.sql", import.meta.url), "utf8")
const sections = [...sql.matchAll(/\\echo '([^']+)'\r?\n([\s\S]*?;)\r?\n/g)].map((m) => ({ title: m[1], query: m[2] }))

const client = new pg.Client({ connectionString: url })
await client.connect()
let problems = 0
try {
  await client.query("BEGIN TRANSACTION READ ONLY")
  for (const { title, query } of sections) {
    const { rows } = await client.query(query)
    console.log(`\n${title}`)
    if (title.includes("Summary")) {
      console.table(rows)
    } else if (rows.length === 0) {
      console.log("  ok")
    } else {
      problems += rows.length
      console.table(rows)
    }
  }
} finally {
  await client.query("ROLLBACK").catch(() => {})
  await client.end()
}
console.log(problems ? `\n${problems} problem(s) found` : "\nAll reservations reconcile.")
process.exit(problems ? 1 : 0)
