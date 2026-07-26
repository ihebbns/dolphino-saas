// ═══════════════════════════════════════════════════
// API error shaping
//
// Two rules, learned from `relation "credit_reconciliation" does not exist`
// appearing on a restaurant owner's receivables page:
//
//   1. A raw Postgres message is never shown to a user. It leaks schema names and
//      means nothing to the person reading it.
//   2. A missing table/column is a DEPLOYMENT state, not a server fault. It gets
//      reported as "migration not run" so the page can say which file to run,
//      instead of a red error box that looks like data loss.
// ═══════════════════════════════════════════════════

/** Postgres codes/messages that mean "the schema isn't there yet".
 *  42P01 undefined_table (also covers views), 42703 undefined_column. */
export function isMissingSchema(err: any): boolean {
  const code = String(err?.code || '')
  if (code === '42P01' || code === '42703') return true
  const m = String(err?.message || '')
  return /does not exist|undefined_table|undefined_column|relation .* does not exist/i.test(m)
}

/** Log the real cause server-side, return something safe to the caller. */
export function serverError(where: string, err: any) {
  console.error(`[${where}]`, err?.code || '', err?.message || err)
  return { ok: false as const, error: 'Erreur serveur' }
}

/** The payload a GET should return when its tables are missing: shaped so the
 *  page's normal "not ready" branch handles it, with no error state at all.
 *
 *  `missing` carries the relations that are actually absent. Without it the page
 *  can only say "run the migration", which is useless advice to someone who has
 *  already run it — and that is exactly what happened: the message repeated
 *  itself after the SQL had been executed, with nothing to indicate whether a
 *  table was missing, the wrong database was connected, or the check itself was
 *  wrong. A blanket message you cannot act on is worse than an error code. */
export function notReadyPayload(
  sqlFile: string,
  extra: Record<string, any> = {},
  missing?: string[],
) {
  const detail = missing && missing.length
    ? ` (manquant : ${missing.join(', ')})`
    : ''
  return {
    ok: true as const,
    ready: false as const,
    note: `Tables non initialisées — exécutez ${sqlFile}${detail}`,
    missing: missing ?? [],
    ...extra,
  }
}

/**
 * Which of these relations do NOT exist?
 *
 * Asks the catalog rather than probing each table with a SELECT, so it costs one
 * round trip and cannot be confused by a table that exists but is empty or
 * permission-denied. Covers views as well as tables, since a missing view was
 * the original bug.
 *
 * Returns every name as missing if the catalog query itself fails, because at
 * that point we genuinely do not know and claiming they exist would be a lie.
 */
export async function missingRelations(
  sql: any,
  names: string[],
): Promise<string[]> {
  if (!names.length) return []
  try {
    const rows = await sql`
      SELECT c.relname AS name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ANY(current_schemas(false))
        AND c.relkind IN ('r', 'v', 'm', 'p', 'f')
        AND c.relname = ANY(${names})`
    const found = new Set(rows.map((r: any) => String(r.name)))
    return names.filter(n => !found.has(n))
  } catch {
    return [...names]
  }
}

/**
 * The database the app is actually talking to.
 *
 * The single most likely explanation for "I ran the migration and it still says
 * to run the migration" is that the SQL went to one database and the app reads
 * another — a different Neon branch, or a DATABASE_URL in Vercel pointing
 * elsewhere. Reporting the database and schema turns a day of confusion into a
 * glance.
 */
export async function dbIdentity(sql: any): Promise<{ database: string; schema: string } | null> {
  try {
    const rows = await sql`
      SELECT current_database()::text AS database,
             COALESCE(current_schema()::text, 'public') AS schema`
    return rows.length ? { database: rows[0].database, schema: rows[0].schema } : null
  } catch {
    return null
  }
}
