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
 *  page's normal "not ready" branch handles it, with no error state at all. */
export function notReadyPayload(sqlFile: string, extra: Record<string, any> = {}) {
  return {
    ok: true as const,
    ready: false as const,
    note: `Tables non initialisées — exécutez ${sqlFile}`,
    ...extra,
  }
}
