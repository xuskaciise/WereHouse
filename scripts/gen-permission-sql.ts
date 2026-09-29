// Prints the role_permissions seed INSERT for new modules, from DEFAULT_PERMISSIONS:
//   npx tsx scripts/gen-permission-sql.ts <module> [<module> ...]
import { DEFAULT_PERMISSIONS, EDITABLE_ROLES } from "@/lib/permission-rules"
const mods = process.argv.slice(2)
const rows: string[] = []
for (const role of EDITABLE_ROLES) for (const m of mods) {
  const p = (DEFAULT_PERMISSIONS as any)[role][m]
  rows.push(`  ('rp_${role.toLowerCase()}_${m}', '${role}', '${m}', ${p.view}, ${p.create}, ${p.edit}, ${p.delete}, '${p.scope}', ${p.discountLimit ?? "NULL"}, now())`)
}
console.log(`INSERT INTO "role_permissions" ("id", "role", "module", "canView", "canCreate", "canEdit", "canDelete", "scope", "discountLimit", "updatedAt") VALUES\n${rows.join(",\n")}\nON CONFLICT ("role", "module") DO NOTHING;`)
