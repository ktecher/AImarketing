// Every font name any template binds must resolve, or that template silently
// renders in the wrong face.
import { readFileSync, readdirSync } from 'node:fs'
import { fonts } from '../lib/template/store.ts'
const available = fonts()
console.log('resolvable names:', Object.keys(available).sort().join(', '), '\n')
let bad = 0
for (const f of readdirSync('data/templates').filter((f) => f.endsWith('.json') && !f.includes('overrides'))) {
  const m = JSON.parse(readFileSync(`data/templates/${f}`, 'utf8'))
  for (const s of m.slots.filter((s) => s.type === 'text')) {
    const name = s.font ?? 'Cairo'
    const ok = Boolean(available[name])
    if (!ok) bad++
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${f.padEnd(18)} ${s.id.padEnd(12)} "${name}"`)
  }
}
console.log(bad ? `\n${bad} unresolvable` : '\nall template fonts resolve')
process.exitCode = bad ? 1 : 0
