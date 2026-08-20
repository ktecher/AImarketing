import { readFileSync, readdirSync } from 'node:fs'

type Card = {
  href: string
  pillar: string
  title: string
  desc: string
  state: 'live' | 'part' | 'todo'
  label: string
}

const CARDS: Card[] = [
  { href: '/templates', pillar: 'Catalogue', title: 'Designs', state: 'live', label: 'working',
    desc: 'The workspace: load a product sheet, pick or add a template, edit the layout, and download every design.' },
  { href: '/api/template', pillar: 'Catalogue', title: 'Download the blank sheet', state: 'live', label: 'working',
    desc: 'Hand this to marketing. Its columns are exactly what the importer reads, so nothing has to be guessed at.' },
  { href: '/typography', pillar: 'Templates', title: 'Typography bench', state: 'live', label: 'reference',
    desc: 'The layout engine on its own, for testing a string against a box. The controls that matter now live in the layout editor, on the slot they affect.' },
  { href: '/import', pillar: 'Catalogue', title: 'Import in detail', state: 'live', label: 'working',
    desc: 'The full import screen — every column understood, every skipped row with its reason. Reached from Designs when you need it.' },
  { href: '/studio', pillar: 'Marketing', title: 'Content studio', state: 'live', label: 'working',
    desc: 'Slogans, captions, hashtags, and video scripts — including what not to say. English only, and no figure the model wrote: prices are placeholders the catalogue fills in.' },
  { href: '/advisor', pillar: 'Marketing', title: 'Creative advisor', state: 'todo', label: 'planned',
    desc: 'Reviews drafts the team wrote. Named checks with the exact line that triggered each one. Never a score.' },
  { href: '/chat', pillar: 'Sales', title: 'Sales assistant', state: 'todo', label: 'planned',
    desc: 'Answers product questions from the catalogue, escalates when it cannot, hands over to a person mid-conversation.' },
  { href: '/sales', pillar: 'Sales', title: 'Sales inbox', state: 'todo', label: 'planned',
    desc: 'Leads the assistant could not close, with the full transcript and a takeover button.' },
  { href: '/campaigns', pillar: 'The loop', title: 'Campaigns', state: 'todo', label: 'planned',
    desc: 'What ties marketing to sales in both directions — including the questions the assistant could not answer.' },
]

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
        {CARDS.map((c) => (
          <a className="card" key={c.href} href={c.href}>
            <span className="pillar">{c.pillar}</span>
            <span className={`badge ${c.state}`} style={{ float: 'right' }}>{c.label}</span>
            <h3>{c.title}</h3>
            <p>{c.desc}</p>
          </a>
        ))}
      </div>

      <h2>Where this actually is</h2>
      <div className="panel">
        <div className="kv"><span>Product sheet in and out</span><b>working</b></div>
        <div className="kv"><span>Text layout — shape, fit, bidi, outline</span><b>working</b></div>
        <div className="kv"><span>Local models installed and verified</span><b>4 models, 19 GB</b></div>
        <div className="kv"><span>Automated checks</span><b>{total} across {suites} suites</b></div>
        <div className="kv"><span>Template rendering — SVG and PNG</span><b>working</b></div>
        <div className="kv"><span>Batch, ZIP and PDF export</span><b>next</b></div>
        <div className="kv"><span>Copy, advisor, assistant</span><b>planned</b></div>
      </div>

      <h2>What is still needed from you</h2>
      <div className="panel">
        <ul className="list blocked">
          <li>The real product Excel — its column names become the template bindings and the assistant&rsquo;s comparison surface.</li>
          <li>A brand template from the designer, as SVG.</li>
          <li>The social export: last 100 posts, captions joined to per-post reach.</li>
          <li>Whether the brand&rsquo;s Arabic font licence allows converting glyphs to outlines, which is a separate permission from embedding.</li>
        </ul>
      </div>
    </main>
  )
}
