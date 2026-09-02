/**
 * The budget split: turns the model's weight words into the KWD figures a
 * person sees, without the model ever writing a digit — CLAUDE.md rule 2.
 *
 * Pure arithmetic. No database, no model, no filesystem — the planner's
 * "how much should each line get" question has to be answerable by a unit
 * test, not by re-running a meeting.
 */
import { formatKwd } from '@/lib/money'

export const LINE_ITEMS = [
  'Boosting',
  'Photography and production',
  'Influencer',
  'Print and OOH',
  'Event',
  'Contingency',
] as const

export const WEIGHTS = ['dominant', 'large', 'moderate', 'small', 'minimal'] as const

export type LineItem = (typeof LINE_ITEMS)[number]
export type Weight = (typeof WEIGHTS)[number]

/** What the model returns. A weight WORD, never an amount and never a percentage. */
export type PlanLine = { item: LineItem; weight: Weight; why: string }

/** What the person sees. Every digit here was computed by TypeScript. */
export type SpendLine = { item: LineItem; why: string; fils: number; text: string }

/**
 * Relative shares behind each weight word. Arbitrary but fixed — what matters
 * is that they are TypeScript's numbers, never the model's. Widening the gap
 * between "dominant" and "minimal" is a product decision, not a bug fix.
 */
const SHARE: Record<Weight, number> = {
  dominant: 8,
  large: 5,
  moderate: 3,
  small: 2,
  minimal: 1,
}

/**
 * Turns the plan's weight words into KWD figures that sum to exactly the
 * total the person typed.
 */
export function split(totalKwd: number, lines: PlanLine[]): SpendLine[] {
  // Number.isFinite FIRST. A bare range check (`total > 0`) lets NaN through
  // silently, because both `NaN > 0` and `NaN <= 0` are false — the exact
  // failure mode CLAUDE.md rule 2 exists to prevent, just in the total rather
  // than a caption.
  if (!Number.isFinite(totalKwd) || totalKwd <= 0) {
    throw new Error(`split(): totalKwd must be a finite number greater than zero, got ${totalKwd}`)
  }
  if (lines.length === 0) {
    throw new Error('split(): lines must not be empty — there is nothing to allocate a budget across')
  }

  // Fils as integers from here on. Floating-point KWD (0.1 + 0.2 style drift)
  // is exactly the money bug rule 2 exists to rule out, and a fils total that
  // does not sum to the whole is the kind of error nobody notices until an
  // audit adds up the line items on a real invoice.
  const totalFils = Math.round(totalKwd * 1000)
  const sumOfShares = lines.reduce((sum, l) => sum + SHARE[l.weight], 0)

  const parts = lines.map((l) => Math.round((totalFils * SHARE[l.weight]) / sumOfShares))
  const remainder = totalFils - parts.reduce((sum, p) => sum + p, 0)

  // The remainder goes on the LARGEST line, not the last one. The last line
  // is usually Contingency, and a contingency that quietly absorbs rounding
  // error is the one line nobody audits — the error hides exactly where it
  // is least likely to be caught. On a tie, the first largest wins.
  let largestIndex = 0
  for (let i = 1; i < parts.length; i++) {
    if (parts[i] > parts[largestIndex]) largestIndex = i
  }
  parts[largestIndex] += remainder

  return lines.map((l, i) => ({
    item: l.item,
    why: l.why,
    fils: parts[i],
    text: formatKwd(parts[i] / 1000),
  }))
}
