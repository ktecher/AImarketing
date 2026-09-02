#!/usr/bin/env node
/**
 * Pull today's Kuwait search trends into knowledge/kuwait/timely/.
 *
 * A PERSON runs this — `npm run kuwait:trends` in a terminal, or the Refresh
 * button on the Kuwait tab, which executes this file unchanged with no
 * arguments (see app/api/kuwait/trends/route.ts). Either way the request code
 * lives HERE, in scripts/, outside the app: check-localhost fails the suite on
 * any outbound URL in app/, lib/ or db/, and this script takes no input from
 * anything, so no catalogue row or customer message can ride along. Nothing
 * from this machine is sent — one GET of a public RSS feed, no query beyond
 * `geo=KW` (the retailer seeder set the scripts/ precedent).
 *
 * The Kuwait screen renders the file this writes, with its date beside it, so
 * freshness is a visible parameter rather than a hidden assumption — the
 * timely/ contract. Search trends are the layer between the calendar (stable,
 * evergreen/) and this week's campaign angle (typed by a person): they say what
 * Kuwait is looking up TODAY, which is a fact about the market, not a
 * recommendation. The judgement of what to do with a trend stays human.
 */
import { writeFileSync } from 'node:fs'
import { screen } from './not-for-marketing.mjs'

const FEED = 'https://trends.google.com/trending/rss?geo=KW'
const OUT = 'knowledge/kuwait/timely/trending-searches.md'

const res = await fetch(FEED, { signal: AbortSignal.timeout(20_000) })
if (!res.ok) {
  console.error(`pull-trends: the feed answered ${res.status}. Nothing was written.`)
  process.exit(1)
}
const xml = await res.text()

// Regex over a feed this small beats an XML dependency for one script. If the
// shape drifts, items come back empty and the guard below refuses to write.
const tag = (src, name) => src.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1] ?? ''
const unescape = (s) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
   .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")

const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, body]) => ({
  term: unescape(tag(body, 'title')),
  traffic: tag(body, 'ht:approx_traffic'),
  news: [...body.matchAll(/<ht:news_item>([\s\S]*?)<\/ht:news_item>/g)]
    .map(([, n]) => ({
      title: unescape(tag(n, 'ht:news_item_title')),
      source: unescape(tag(n, 'ht:news_item_source')),
    }))
    .filter((n) => n.title)
    .slice(0, 2),
})).filter((i) => i.term)

if (!items.length) {
  console.error('pull-trends: the feed parsed to zero items — its shape may have changed. Nothing was written.')
  process.exit(1)
}

// Rule 5 applied to the feed itself. Most days this list is sport, weather and
// world news, and a good share of the world news is exactly what marketing may
// not build on. Dropped here rather than left for a person to skip past, and
// counted in the file so the omission is visible rather than silent.
const { kept, dropped, total } = screen(
  items,
  (i) => `${i.term} ${i.news.map((n) => n.title).join(' ')}`,
)

const today = new Date().toISOString().slice(0, 10)
const lines = [
  '---',
  `last_verified: ${today}`,
  `source: ${FEED}`,
  '---',
  '',
  '# Trending searches in Kuwait',
  '',
  `What Kuwait searched for on ${today}, by approximate search volume. Refresh from the Kuwait tab's button, or with \`npm run kuwait:trends\`.`,
  '',
  'A raw feed, not a recommendation: most days it is sport, weather and world news. The judgement of whether a trend is usable for retail stays with you. The compliance guardrails apply to trends exactly as they apply to copy.',
  '',
  total
    ? `${total} trend${total === 1 ? ' was' : 's were'} left out as political or religious (${dropped.political} political, ${dropped.religious} religious). Rule 5 forbids either as a marketing angle, so they are not offered as one.`
    : 'Nothing was left out — no political or religious trends in this pull.',
  '',
  '| Search | Volume | In the news |',
  '|---|---|---|',
  ...kept.map((i) => {
    const news = i.news.map((n) => `${n.title} *(${n.source})*`).join(' · ')
    return `| **${i.term}** | ${i.traffic || '—'} | ${news || '—'} |`
  }),
  '',
]

writeFileSync(OUT, lines.join('\n'))
console.log(`pull-trends: ${kept.length} trends written to ${OUT} (${today}), ${total} left out as political or religious`)
