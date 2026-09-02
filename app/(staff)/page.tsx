import { existsSync, readFileSync, readdirSync } from 'node:fs'

type Card = {
  href: string
  pillar: string
  title: string
  desc: string
  /** Set only when a screen works but a named half of it is still waiting. */
  part?: string
}

const CARDS: Card[] = [
  { href: '/templates', pillar: 'Products', title: 'Designs',
    desc: 'The workspace: load a product sheet or pick rows from the Products tab, choose a template, edit the layout, and download every design.' },
  { href: '/api/template', pillar: 'Products', title: 'Download the blank sheet',
    desc: 'Hand this to marketing. Its columns are exactly what the importer reads, so nothing has to be guessed at.' },
  // No card for /typography or /import. D52 deleted both routes, and their own
  // descriptions here said why: the controls moved into the layout editor and
  // the mapping moved into Designs. These two outlived the pages by three
  // commits and 404'd the whole time — which is exactly the way D52 said a
  // merged page comes back, so they go rather than get re-pointed.
  { href: '/products', pillar: 'Products', title: 'Products',
    desc: 'The full catalogue in Postgres — everything the shop sells. What the assistant and the advisor read, because a customer can ask about anything in stock.' },
  { href: '/studio', pillar: 'Marketing', title: 'Content studio',
    desc: 'Slogans, captions, hashtags, and video scripts — including what not to say. English only, and no figure the model wrote: prices are placeholders the catalogue fills in.' },
  { href: '/advisor', pillar: 'Marketing', title: 'Creative advisor',
    // Kept to two words: the badge is an uppercase pill floated into the card's
    // corner, and a sentence in it wraps under the title.
    part: 'no post history',
    desc: 'Reviews drafts the team wrote, and talks them through — it asks when it cannot tell what it is looking at. Named checks with the exact line that triggered each one. Never a score. Comparison against past posts waits on the social export.' },
  { href: '/kuwait', pillar: 'Marketing', title: 'Kuwait',
    desc: 'The stable layer: the retail calendar with the hard rules beside it, pricing conventions, channels, and the dialect question. This week’s specifics live on the campaign.' },
  { href: '/chat', pillar: 'Sales', title: 'Sales assistant',
    desc: 'Answers product questions from the catalogue, escalates when it cannot, hands over to a person mid-conversation.' },
  { href: '/sales', pillar: 'Sales', title: 'Sales inbox',
    desc: 'Leads the assistant could not close, with the full transcript, why it escalated, and a takeover button.' },
  { href: '/social', pillar: 'Marketing', title: 'Publish',
    desc: 'The end of the loop: a design and a caption that already exist, posted to the company\u2019s own Instagram \u2014 now, or at a time you set. Nothing here writes anything.' },
  { href: '/campaigns', pillar: 'The loop', title: 'Campaigns',
    desc: 'What ties marketing to sales in both directions — including the questions the assistant could not answer.' },
]

/**
 * Whether a screen exists, read from the screen rather than typed here.
 *
 * Every card used to carry its own `state` and `label`. Three of them still said
 * "planned" long after the screens worked, and two pointed at pages that had been
 * deleted — the same failure from both ends. A page that is not built imports
 * `Stub`, and that is a fact about the page, so it cannot drift out of date.
 */
function built(href: string): boolean {
  // /api/* is a route handler, not a page. Nothing there is ever a stub.
  const page = [`app/(staff)${href}/page.tsx`, `app${href}/page.tsx`].find(existsSync)
  if (!page) return true
  return !readFileSync(page, 'utf8').includes('components/Stub')
}

function checks(): { total: number; suites: number } {
  // Read the assertion counts straight from the test scripts so this number
  // cannot drift from reality by being typed in by hand.
  try {
    // Derived from the directory, not a list — a suite added and not listed here
    // would quietly make this number wrong, which is the failure it exists to prevent.
    const files = readdirSync('scripts')
      .filter((f) => f.startsWith('test-') && f.endsWith('.mjs'))
    let total = 0
    for (const f of files) {
      const src = readFileSync(`scripts/${f}`, 'utf8')
      total += (src.match(/\bok\(/g) ?? []).length
    }
    return { total, suites: files.length }
  } catch {
    return { total: 0, suites: 0 }
  }
}

export default function Home() {
  const { total, suites } = checks()

  return (
    <main>
      <h1>AImarketing</h1>
      <p className="sub">
        Marketing and sales in one system. Everything runs on this machine — no
        catalogue row, customer message, or unpublished draft leaves it.
      </p>

      <div className="cards">
        {CARDS.map((c) => {
          const [state, label] = !built(c.href)
            ? ['todo', 'not built yet']
            : c.part ? ['part', c.part] : ['live', 'working']
          return (
            <a className="card" key={c.href} href={c.href}>
              <span className="pillar">{c.pillar}</span>
              <span className={`badge ${state}`} style={{ float: 'right' }}>{label}</span>
              <h3>{c.title}</h3>
              <p>{c.desc}</p>
            </a>
          )
        })}
      </div>

      <h2>Where this actually is</h2>
      <div className="panel">
        <div className="kv"><span>Product sheet in and out</span><b>working</b></div>
        <div className="kv"><span>Text layout — shape, fit, bidi, outline</span><b>working</b></div>
        <div className="kv"><span>Rendering and export — SVG, PNG, JPG, PDF, ZIP</span><b>working</b></div>
        <div className="kv"><span>Copy, advisor, assistant, inbox</span><b>working</b></div>
        <div className="kv"><span>Campaigns — the loop</span><b>working</b></div>
        <div className="kv"><span>Local models installed and verified</span><b>4 models, 21 GB</b></div>
        <div className="kv"><span>Automated checks</span><b>{total} across {suites} suites</b></div>
      </div>

      <h2>What is still needed from you</h2>
      <div className="panel">
        <ul className="list blocked">
          <li>A brand template from the designer, as SVG or at print resolution — the current artwork is 465&times;659, about a fifth of what A4 needs at 300 dpi.</li>
          <li>Whether the brand&rsquo;s Arabic font licence allows converting glyphs to outlines, which is a separate permission from embedding.</li>
          <li>The social export: last 100 posts, captions joined to per-post reach. It is the advisor&rsquo;s other half.</li>
          <li>30&ndash;50 approved past Arabic posts. The studio writes correct English with no local register, and no prompt fixes that — only exemplars do.</li>
          <li>A baseline: how long producing 50 product posts takes today. It stops being measurable once this replaces the manual process.</li>
        </ul>
      </div>
    </main>
  )
}
