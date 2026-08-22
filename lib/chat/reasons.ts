/**
 * Why the assistant handed a conversation to a person, and how to say it.
 *
 * Its own file because two screens print these — the inbox, and the campaign
 * report's list of questions the bot could not answer, which `vision.md` calls
 * the most valuable byproduct in the system. Both are client components, so the
 * map cannot live beside the code that produces it: `lib/chat/answer.ts` reaches
 * `lib/ai/generate.ts`, and importing that into a page would pull the model
 * client and its boot-time loopback assert into the browser bundle.
 *
 * Nothing here imports anything. That is the point.
 */

export const WHY = {
  'nothing-retrieved': 'nothing in the catalogue matched',
  'ungrounded-sku': 'it named a product that was not retrieved',
  'invented-number': 'it wrote a figure of its own',
  'unresolved-field': 'a field it reached for had no value',
  'model-unavailable': 'the model did not answer',
} as const

export type Reason = keyof typeof WHY

/** A reason with no label is still a reason. Never print a bare key at a person. */
export const why = (r: string | undefined): string =>
  (r && WHY[r as Reason]) || 'it could not answer'
