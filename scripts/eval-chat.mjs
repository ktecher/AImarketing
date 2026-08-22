// The chatbot eval: evals/chat.json against the live catalogue and the live
// model. vision.md's third success criterion, made runnable:
//
//   thirty questions, zero invented prices or specs, the five unanswerable
//   ones escalate instead of guessing.
//
// NOT part of `npm test` — thirty model calls take minutes and need Ollama and
// Postgres both up. This is `npm run eval:chat`, run on demand and before
// anything is called done. Unlike the suites, it does not skip when a
// dependency is missing: an eval that silently skips is an eval that silently
// passes, so a missing dependency here is a loud failure.
//
// The figure check is deliberately implemented HERE, from scratch, rather than
// by importing `bareNumber` from lib/chat/answer.ts. The eval's job is to catch
// that module being wrong; sharing its definition of "invented" would make the
// check circular — the one place where two definitions of the same idea is
// correct.
try { process.loadEnvFile('.env') } catch { /* no .env is normal on a clone */ }

import { readFileSync } from 'node:fs'

const { reachable, query } = await import('../lib/db.ts')
if (!(await reachable())) {
  console.error('eval-chat: Postgres is not running. npm run db:up')
  process.exit(1)
}

const { answer } = await import('../lib/chat/answer.ts')
const { generate } = await import('../lib/ai/generate.ts')
const { formatKwd } = await import('../lib/money.ts')

const SET = JSON.parse(readFileSync('evals/chat.json', 'utf8'))

// Warm the model outside the clock. The first call of the day loads ~7 GB and
// takes 20–60s; timing it would say the median is whatever the disk felt like.
try {
  await generate('Say OK.', { maxTokens: 10 })
} catch {
  console.error('eval-chat: Ollama is not answering. brew services start ollama')
  process.exit(1)
}

/**
 * Every figure in a reply must be accounted for:
 *   - a price of a retrieved row, exactly as formatKwd prints it,
 *   - the discount derived from a retrieved row's two prices,
 *   - or part of a retrieved product's own identity ("AirPods 4", "13-inch",
 *     "S25+", the SKU itself).
 * Anything left is a figure the system invented, and one is a failed run.
 */
function inventedFigures(reply, rows) {
  let text = reply
  const identity = []
  for (const r of rows) {
    for (const f of ['price_now', 'price_was']) {
      const money = formatKwd(r[f])
      if (money) text = text.split(money).join(' ')
    }
    const now = Number(r.price_now), was = Number(r.price_was)
    if (Number.isFinite(now) && Number.isFinite(was) && was > now) {
      text = text.split(`${Math.round((1 - now / was) * 100)}%`).join(' ')
    }
    identity.push(
      [r.sku, r.name_en, r.name_ar, r.display_name, r.brand, r.category]
        .filter(Boolean).join(' ').toLowerCase(),
    )
  }
  const bare = (w) => w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
  return (text.match(/\S*\d[\d.,%]*\S*/g) ?? [])
    .map(bare)
    .filter((w) => w && !identity.some((t) => t.includes(w)))
}

async function citedRows(skus) {
  if (!skus.length) return []
  return query(
    `select sku, name_en, name_ar, display_name, brand, category, price_now, price_was
       from products where sku = any($1)`, [skus],
  )
}

const results = []
console.log(`\n--- chat eval: ${SET.questions.length} questions ---\n`)

for (const t of SET.questions) {
  const t0 = performance.now()
  const a = await answer(t.q)
  const ms = Math.round(performance.now() - t0)

  const problems = []
  if (t.expect === 'escalate') {
    if (!a.escalated) problems.push(`answered instead of escalating: "${a.reply.slice(0, 90)}"`)
  } else {
    if (a.escalated) problems.push(`escalated (${a.reason ?? '?'}) — retrieved: ${a.retrieved.join(', ') || 'nothing'}`)
    else {
      if (!t.cited_any.some((s) => a.cited.includes(s))) {
        problems.push(`cited ${a.cited.join(', ') || 'nothing'}, wanted one of ${t.cited_any.join(', ')}`)
      }
      // Structural in answer(), asserted anyway: the eval must not inherit
      // the module's own guarantees on trust.
      if (!a.cited.every((s) => a.retrieved.includes(s))) {
        problems.push(`cited a sku that was not retrieved: ${a.cited.join(', ')}`)
      }
      // Figures are judged against what the model was SHOWN — the retrieved
      // rows — not only what it cited. "AirPods 4" in a reply about retrieved
      // AirPods is the product's own name either way; judging it against the
      // cited set alone called two grounded replies fabricated on the first
      // run of this eval.
      const invented = inventedFigures(a.reply, await citedRows(a.retrieved))
      if (invented.length) problems.push(`INVENTED FIGURE: ${invented.join(', ')} in "${a.reply.slice(0, 120)}"`)
    }
  }

  const ok = problems.length === 0
  results.push({ id: t.id, expect: t.expect, ok, ms, problems, invented: problems.some((p) => p.startsWith('INVENTED')) })
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${t.id}  ${String(ms).padStart(5)}ms  ${t.q.slice(0, 64)}`)
  for (const p of problems) console.log(`          ${p}`)
}

const answered = results.filter((r) => r.expect === 'answer')
const escalations = results.filter((r) => r.expect === 'escalate')
const medianOf = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const median = medianOf(results.map((r) => r.ms))

const okAnswered = answered.filter((r) => r.ok).length
const okEscalated = escalations.filter((r) => r.ok).length
const inventedCount = results.filter((r) => r.invented).length

console.log(`\nanswerable   ${okAnswered}/${answered.length}   (needs ≥ ${Math.ceil(answered.length * 0.9)})`)
console.log(`escalations  ${okEscalated}/${escalations.length}   (needs all)`)
console.log(`invented     ${inventedCount}   (needs 0 — one is a failed run)`)
console.log(`latency      median ${median}ms over ${results.length} answers`)

const passed =
  okAnswered >= Math.ceil(answered.length * 0.9) &&
  okEscalated === escalations.length &&
  inventedCount === 0

console.log(passed ? '\nchat eval: PASS' : '\nchat eval: FAIL')
process.exit(passed ? 0 : 1)
