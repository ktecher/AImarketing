#!/usr/bin/env node
// Spike B: does the social export carry captions joined to per-post reach?
//
// This answers the one question that decides whether the creative advisor gets
// built in its planned form. Run it against the raw Instagram/Snapchat CSV
// export. No dependencies, no install.
//
//   node scripts/analyze-posts.mjs data/samples/instagram-insights.csv
//
// PASS  -> captions and a reach-like metric are on the same row, with spread.
// FAIL  -> the advisor cannot be grounded in real performance. Say so in
//          docs/decisions.md D9 rather than building it anyway.

import { readFileSync } from 'node:fs'

const path = process.argv[2]
if (!path) {
  console.error('usage: node scripts/analyze-posts.mjs <export.csv>')
  process.exit(2)
}

// Minimal RFC-4180-ish reader. Handles quoted fields containing commas,
// newlines, and doubled quotes — all three occur in real caption text.
function parseCsv(text) {
  const rows = []
  let row = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows.filter(r => r.some(v => v.trim()))
}

const raw = readFileSync(path, 'utf8')
// Exports sometimes carry a title block before the real header.
const all = parseCsv(raw)
const headerIdx = all.findIndex(r => r.length > 2)
const header = all[headerIdx].map(h => h.trim())
const rows = all.slice(headerIdx + 1).filter(r => r.length === header.length)

const find = (...pats) =>
  header.findIndex(h => pats.some(p => new RegExp(p, 'i').test(h)))

const capIdx = find('caption', 'description', 'text', 'post copy', 'message')
const reachIdx = find('^reach', 'impressions', 'views', 'plays')
const savesIdx = find('save', 'bookmark')
const sharesIdx = find('share', 'send')

const num = s => {
  const n = Number(String(s).replace(/[,\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

console.log(`\nfile        ${path}`)
console.log(`columns     ${header.length}`)
console.log(`rows        ${rows.length}`)
console.log(`\nheaders:\n  ${header.join('\n  ')}`)

console.log('\n--- the question ---')
const hasCaption = capIdx >= 0
const hasReach = reachIdx >= 0
console.log(`caption column   ${hasCaption ? `YES  "${header[capIdx]}"` : 'NO'}`)
console.log(`reach column     ${hasReach ? `YES  "${header[reachIdx]}"` : 'NO'}`)
console.log(`saves column     ${savesIdx >= 0 ? `yes  "${header[savesIdx]}"` : 'no'}`)
console.log(`shares column    ${sharesIdx >= 0 ? `yes  "${header[sharesIdx]}"` : 'no'}`)

if (!hasCaption || !hasReach) {
  console.log('\nFAIL — captions are not joined to a reach metric in this file.')
  console.log('Check whether a second export joins on post id before concluding.')
  console.log('If not, the advisor cannot be grounded in real performance:')
  console.log('record that against D9 in docs/decisions.md.\n')
  process.exit(1)
}

const joined = rows
  .map(r => ({ caption: r[capIdx]?.trim() ?? '', reach: num(r[reachIdx]) }))
  .filter(p => p.caption && p.reach !== null)

console.log(`\nrows with BOTH   ${joined.length} of ${rows.length}`)

if (joined.length < 20) {
  console.log('\nWEAK — under 20 usable posts is anecdote territory.')
  console.log('Similar-post lookup will not have enough to draw on.\n')
  process.exit(1)
}

const reaches = joined.map(p => p.reach).sort((a, b) => a - b)
const at = q => reaches[Math.floor(reaches.length * q)]
const mean = reaches.reduce((a, b) => a + b, 0) / reaches.length

console.log(`\nreach  min ${reaches[0]}  p25 ${at(0.25)}  median ${at(0.5)}  p75 ${at(0.75)}  max ${reaches.at(-1)}`)
console.log(`spread top/median  ${(reaches.at(-1) / (at(0.5) || 1)).toFixed(1)}x`)
console.log(`mean caption chars ${Math.round(joined.reduce((a, p) => a + p.caption.length, 0) / joined.length)}`)

const arabic = joined.filter(p => /[؀-ۿ]/.test(p.caption)).length
console.log(`captions with Arabic  ${arabic} (${Math.round(arabic / joined.length * 100)}%)`)

console.log('\ntop 5 by reach — read these yourself, that is the real test:')
for (const p of [...joined].sort((a, b) => b.reach - a.reach).slice(0, 5)) {
  console.log(`  ${String(p.reach).padStart(8)}  ${p.caption.replace(/\s+/g, ' ').slice(0, 90)}`)
}
console.log('\nbottom 5 by reach:')
for (const p of [...joined].sort((a, b) => a.reach - b.reach).slice(0, 5)) {
  console.log(`  ${String(p.reach).padStart(8)}  ${p.caption.replace(/\s+/g, ' ').slice(0, 90)}`)
}

console.log(`\nPASS — ${joined.length} posts with captions joined to reach.`)
console.log('Now the part no script does: read the top 5 against the bottom 5.')
console.log('If YOU cannot see a difference by eye, no model will find one.\n')
