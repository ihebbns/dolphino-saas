// ═══════════════════════════════════════════════════════════════════
// One place that decides how a number, a price or a date looks.
//
// Without this, `7.000` appeared on one page and `7` on another for the
// same product, and a never-counted item showed as `-4.000`, which reads
// as a broken app rather than "nobody has counted this yet".
//
// Money uses THREE decimals because the POS prints three on every
// receipt. Rounding differently here would make the back-office disagree
// with the ticket in the customer's hand.
// ═══════════════════════════════════════════════════════════════════

export const CURRENCY = 'DT'

/** Money, always three decimals, matching POS receipts. */
export function money(v: any, currency = CURRENCY): string {
  const n = Number(v)
  return (Number.isFinite(n) ? n : 0).toFixed(3) + ' ' + currency
}

/** Money without the unit, for columns that already carry a header. */
export function money0(v: any): string {
  const n = Number(v)
  return (Number.isFinite(n) ? n : 0).toFixed(3)
}

/**
 * A quantity. Counted things are whole numbers; only a measured unit
 * (kg, L) earns decimals, and then only when it actually has a fraction.
 */
export function qty(v: any, unit?: string): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  const measured = !!unit && /^(kg|g|l|ml|cl)$/i.test(unit)
  const s = measured && n % 1 !== 0 ? String(Math.round(n * 1000) / 1000) : String(Math.round(n))
  return unit ? s + ' ' + unit : s
}

/**
 * A quantity with the noise removed: `7.000` becomes `7`, `7.500` becomes `7.5`.
 *
 * Quantities were being printed with the MONEY formatter, so a shelf holding
 * seven bottles read "7.000" — which looks like a price, or like a precision
 * nobody has. Three decimals are right for dinars (millimes are real) and wrong
 * for things you count.
 *
 * Unlike `qty()` this never rounds a genuine fraction away. Half a kilo is half a
 * kilo; showing it as "1" to satisfy a preference for whole numbers would be a
 * lie about stock. So: trailing zeros go, real decimals stay.
 */
export function qtyTrim(v: any, unit?: string): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  const r = Math.round(n * 1000) / 1000
  // toFixed then strip, rather than String(r), so 1e-7 cannot surface as
  // exponent notation in the middle of a table.
  let s = r.toFixed(3).replace(/\.?0+$/, '')
  if (s === '' || s === '-') s = '0'
  return unit ? s + ' ' + unit : s
}

/** Signed quantity, same trimming, with the direction always explicit. */
export function qtyDelta(v: any, unit?: string): string {
  const n = Number(v) || 0
  const sign = n > 0 ? '+' : n < 0 ? '−' : ''
  return sign + qtyTrim(Math.abs(n), unit)
}

/**
 * Stock level for display. A negative or missing level does not mean
 * "minus four" — it means deltas were recorded before anyone counted.
 * Saying so is honest and stops the page looking broken.
 */
export function qtyOrUncounted(v: any, unit?: string): { text: string; uncounted: boolean } {
  const n = Number(v)
  if (!Number.isFinite(n) || v === null || v === undefined) return { text: 'non compté', uncounted: true }
  if (n < 0) return { text: 'non compté', uncounted: true }
  return { text: qty(n, unit), uncounted: false }
}

/** A signed difference, with its direction always shown the same way. */
export function variance(v: any): { text: string; tone: 'ok' | 'warn' | 'danger' | 'flat' } {
  const n = Number(v) || 0
  if (n === 0) return { text: '0', tone: 'flat' }
  const sign = n > 0 ? '+' : '−'
  const text = sign + Math.abs(Math.round(n * 1000) / 1000)
  // A shortage is the one that costs money, so it is the one coloured red.
  return { text, tone: n < 0 ? 'danger' : 'warn' }
}

/** Signed money difference. */
export function varianceMoney(v: any, currency = CURRENCY): string {
  const n = Number(v) || 0
  const sign = n > 0 ? '+' : n < 0 ? '−' : ''
  return sign + Math.abs(n).toFixed(3) + ' ' + currency
}

const FR = 'fr-TN'

/** Date + time, one format across every view. */
export function when(s: string | null | undefined): string {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString(FR, {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

/** Time only, for rows already grouped under a date. */
export function atTime(s: string | null | undefined): string {
  if (!s) return '—'
  const d = new Date(s)
  return isNaN(d.getTime()) ? '—' : d.toLocaleTimeString(FR, { hour: '2-digit', minute: '2-digit' })
}

/** Day only. */
export function onDay(s: string | null | undefined): string {
  if (!s) return '—'
  const d = new Date(s)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString(FR, { day: '2-digit', month: '2-digit', year: '2-digit' })
}

/** Plain-language age, because "il y a 12 jours" beats a raw timestamp. */
export function since(s: string | null | undefined): string {
  if (!s) return '—'
  const t = new Date(s).getTime()
  if (isNaN(t)) return '—'
  const days = Math.floor((Date.now() - t) / 86400000)
  if (days <= 0) return "aujourd'hui"
  if (days === 1) return 'hier'
  if (days < 31) return 'il y a ' + days + ' jours'
  const months = Math.floor(days / 30)
  return 'il y a ' + months + (months === 1 ? ' mois' : ' mois')
}

/** Read a user-typed number without letting NaN or a negative through. */
export function num(v: any): number {
  if (v === '' || v === null || v === undefined) return 0
  return Math.max(0, parseFloat(String(v)) || 0)
}
