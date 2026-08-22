#!/usr/bin/env node
/**
 * Fails if app/globals.css contains a declaration that can never win the cascade.
 *
 * Two rules with byte-identical selector text, in the same at-rule context, have
 * identical specificity — so for any property BOTH declare, the later one always
 * wins. The earlier declaration can never apply, in any element state, colour
 * scheme or media context. It is dead text.
 *
 * The restyle in D59 was applied by appending a layer that overrode the repo's
 * own rules by source order, which left 141 of these. This keeps them gone.
 *
 * Matching is by exact property name, which can only UNDER-report: `border`
 * followed by `border-color` is left alone, because the shorthand still supplies
 * width and style. It never removes a declaration that still carries meaning.
 *
 * `node scripts/css-dead-decls.mjs --write` removes what it finds.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import postcss from 'postcss'

const path = process.argv.find((a) => a.endsWith('.css')) ?? 'app/globals.css'
const write = process.argv.includes('--write')
const src = readFileSync(path, 'utf8')

if (src.includes('!important')) {
  console.error('!important present — equal specificity no longer implies the later rule wins')
  process.exit(1)
}

const root = postcss.parse(src, { from: path })

/** The chain of enclosing at-rules, so a rule inside @media never pairs with one outside it. */
const context = (node) => {
  const parts = []
  for (let p = node.parent; p && p.type !== 'root'; p = p.parent) {
    if (p.type === 'atrule') parts.unshift('@' + p.name + ' ' + p.params.replace(/\s+/g, ' ').trim())
  }
  return parts.join(' | ')
}

const groups = new Map()
root.walkRules((rule) => {
  const key = context(rule) + ' ' + rule.selector.replace(/\s+/g, ' ').trim()
  if (!groups.has(key)) groups.set(key, [])
  groups.get(key).push(rule)
})

const dead = []
for (const rules of groups.values()) {
  if (rules.length < 2) continue
  for (let i = 0; i < rules.length - 1; i++) {
    const later = new Set()
    for (const r of rules.slice(i + 1)) r.walkDecls((d) => later.add(d.prop))
    rules[i].each((node) => {
      if (node.type === 'decl' && later.has(node.prop)) dead.push(node)
    })
  }
}

if (dead.length === 0) {
  console.log(path + ': no dead declarations')
  process.exit(0)
}

for (const d of dead) {
  const { line, column } = d.source.start
  console.log('  ' + path + ':' + line + ':' + column + '  ' + d.prop +
    ' in "' + d.parent.selector.replace(/\s+/g, ' ') + '"')
}

if (!write) {
  console.error('\n' + dead.length + ' dead declarations — run with --write to remove them')
  process.exit(1)
}

for (const d of dead) {
  const rule = d.parent
  d.remove()
  if (rule.nodes.length === 0) rule.remove()
}
writeFileSync(path, root.toString())
console.log('removed ' + dead.length + ' dead declarations')
