#!/usr/bin/env node
/**
 * What Kuwait is reading about one topic, right now.
 *
 * `node scripts/search-trends.mjs "back to school"` — or the search box on the
 * Kuwait tab, which runs this file with the typed topic as its only argument.
 *
 * The sibling script, pull-trends.mjs, answers "what is Kuwait searching
 * today" and takes no input at all. This one answers "what about cars", which
 * is a question nobody can ask without typing, so a typed string does reach a
 * public feed. That is a deliberate widening of the boundary D72 drew, recorded
 * in docs/decisions.md — and the request code still lives HERE, in scripts/,
 * outside what check-localhost guards, so there is one file to read to know
 * exactly what leaves.
 *
 * What leaves is the topic and nothing else: the argument is stripped to
 * letters, digits and spaces, capped, and URL-encoded. No catalogue row, no
 * customer message, no draft is in scope — this process is handed one string
 * and has no access to anything else.
 *
 * Google News rather than Google Trends, and that is not a shortcut: the Trends
 * RSS feed is the day's rising searches with no query parameter, and the
 * keyword API behind trends.google.com answers 429 without a token handshake.
 * News search takes a query, is public, needs no key, and can be pointed at
 * Kuwait. It reports what is being WRITTEN, which is a fact about the market —
 * never a recommendation. What to do with it stays with the person.
 *
 * Prints JSON to stdout and writes nothing. A file per query would rot the
 * timely/ contract, which is one dated snapshot per subject, not a search log.
 */

import { screen } from './not-for-marketing.mjs'

const raw = process.argv[2] ?? ''
// Letters and digits in any script — a topic may reasonably be Arabic — plus
// spaces. Everything else goes, so no operator, path or parameter can be
// smuggled through the query string.
const topic = raw.replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)

if (!topic) {
  console.error('search-trends: give it a topic — node scripts/search-trends.mjs "back to school"')
  process.exit(1)
}

// Kuwait is added unless it is already there. Without it the feed answers with
// the global story on the word, which is true and useless: "cars" returns a
// Singapore congestion charge, "cars Kuwait" returns Kuwait's H1 registrations.
const place = /kuwait/i.test(topic) ? '' : ' Kuwait'

/**
 * The vocabulary a retail story uses, and the reason this is not a bare search.
 *
 * A topic on its own is a NEWS query, and news about "phones" is a traffic-law
 * fine, a foreign minister's phone call and a telecom licence in a war zone —
 * every one of them true, not one of them a market trend. Somebody typing
 * "phones" into a marketing tool is asking what is launching, what it costs and
 * who is selling it, so the query has to ask that.
 *
 * Measured against this feed on 2026-08-30. "phones Kuwait" put one shop story
 * in its top eight, below a traffic law and two diplomatic phone calls. With
 * this clause the same search opens on Ooredoo's Huawei Pura 90 offer, the
 * Samsung Galaxy S26 Ultra price and Ooredoo selling the Honor 600 series.
 * "cars" goes from missiles and tariffs to the Kuwait-exclusive Porsche 911 and
 * H1 registrations with Nissan Patrol at number one.
 *
 * Negative terms were tried first and do nothing: `-war -military -minister`
 * returned an identical 81 items, so this feed ignores them. Exclusion has to
 * happen here, in the screen, on what comes back.
 */
const SHOP =
  '(launch OR launched OR unveils OR "now available" OR price OR offer OR deal OR ' +
  'discount OR sale OR "best selling" OR bestseller OR shoppers OR retailer OR store OR buy)'

async function pull(query) {
  const feed = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-KW&gl=KW&ceid=KW:en`
  const res = await fetch(feed, {
    signal: AbortSignal.timeout(20_000),
    // Without a browser agent the feed answers 200 and an empty channel.
    headers: { 'user-agent': 'Mozilla/5.0' },
  })
  if (!res.ok) {
    console.error(`search-trends: the feed answered ${res.status}.`)
    process.exit(1)
  }
  return res.text()
}

const query = `${topic} ${SHOP}${place}`
const xml = await pull(query)

const tag = (src, name) => src.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ?? ''
const unescape = (s) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
   .replace(/<[^>]+>/g, '')
   .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
   .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
   .trim()

const parse = (src) => [...src.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, body]) => {
  const source = unescape(tag(body, 'source'))
  const title = unescape(tag(body, 'title'))
  return {
    // The feed suffixes every headline with " - Source". Printed as-is beside a
    // source column it reads twice.
    title: source && title.endsWith(` - ${source}`) ? title.slice(0, -(source.length + 3)) : title,
    source,
    link: unescape(tag(body, 'link')),
    published: unescape(tag(body, 'pubDate')),
  }
}).filter((i) => i.title)

const items = parse(xml)

// Rule 5, applied to what the feed SHOWS and not only to what the system
// writes. A marketing team searching "cars" was being handed missile and tariff
// headlines; the count comes back so the screen can say what it left out.
let { kept, dropped, total } = screen(items, (i) => `${i.title} ${i.source}`)

// A narrow topic can have no retail coverage at all this week, and an empty
// screen tells the person nothing. Ask the plain question as well and let the
// screen do the work — the result is topped up, never replaced, so anything the
// retail query found stays above anything the broad one did.
if (kept.length < 8) {
  const broad = screen(parse(await pull(`${topic}${place}`)), (i) => `${i.title} ${i.source}`)
  const seen = new Set(kept.map((i) => i.title))
  kept = [...kept, ...broad.kept.filter((i) => !seen.has(i.title))]
  dropped = {
    political: dropped.political + broad.dropped.political,
    religious: dropped.religious + broad.dropped.religious,
  }
  total = dropped.political + dropped.religious
}

/**
 * Market news first, everything else after, each half newest first.
 *
 * Screening only removes what must never be shown. It does not make the top of
 * the list useful: "Kuwait plans the world's tallest skyscraper" is perfectly
 * publishable and has nothing to do with phones. A headline that names a price,
 * a launch, a brand's sales or a shop is what somebody searching a topic in a
 * marketing tool came for, so it goes first — and nothing is hidden, because
 * the rest follows underneath rather than being dropped.
 */
const MARKET =
  /(launch|unveil|reveal|announce|price[sd]?|pricing|offer|deal|discount|sale|selling|bestsell|shopper|retail|store|buy|brand|model|series|edition|market share|demand|sales|available)/i

/**
 * Crime, courts and disasters, which the compliance screen correctly does not
 * touch — none of it is political or religious, and rule 5 is not a general
 * taste filter. It is still nobody's marketing hook, and it ranked FIRST: a
 * jewellery-store robbery topped a search for "cars" because the word "store"
 * reads as retail. Sunk rather than dropped, because it is legitimately news
 * and hiding it would be this feed deciding what is true.
 */
const NOT_A_HOOK =
  /(robber|burglar|theft|thieves|stolen|steal|arrest|jail|prison|court|verdict|lawsuit|smuggl|fraud|scam|forger|murder|assault|stabb|shooting|crash|collision|accident|death|died|killed|fatal|injur|blaze|wildfire|raid|crackdown|seiz|outbreak|epidemic)/i

const rank = (i) => (NOT_A_HOOK.test(i.title) ? 0 : MARKET.test(i.title) ? 2 : 1)
const when = (i) => Date.parse(i.published) || 0
kept.sort((a, b) => rank(b) - rank(a) || when(b) - when(a))

// Zero is an answer, not a failure: some topics genuinely have no Kuwait
// coverage this week, and saying so beats an error that reads like a bug.
console.log(JSON.stringify({
  topic,
  query,
  source: 'news.google.com',
  pulled: new Date().toISOString(),
  items: kept.slice(0, 25),
  dropped,
  droppedTotal: total,
}))
