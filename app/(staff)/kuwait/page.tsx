import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReactNode } from 'react'
import { RefreshTrends } from './refresh'

/**
 * The Kuwait screen: knowledge/kuwait/ rendered, not retyped.
 *
 * 194 lines of calendar, guardrails and conventions existed with no screen, so
 * the only people who could read them were people reading the repository. The
 * markdown stays the single source — this page renders the files, because a
 * second copy of the calendar typed into JSX is the copy that still says 2027
 * in 2029. CLAUDE.md: lib/kuwait is markdown plus one read function; this is
 * that function, wearing a page.
 *
 * The dated layer renders here too — timely/ files a PERSON pulls by running
 * `npm run kuwait:trends` — but the page itself never fetches: rule 1, enforced
 * by check-localhost. And no model is asked what is trending, ever; a model
 * asked will answer confidently and be wrong (vision.md). The feed says what is
 * moving; what to do with it is typed on the campaign by the person who knows.
 */

// Never prerendered. A static build freezes the timely/ read at build time, so
// the Refresh button would write the file and production would keep serving the
// build day's trends with a freshness line asserting otherwise.
export const dynamic = 'force-dynamic'

const DIR = join(process.cwd(), 'knowledge/kuwait')

/**
 * The files, in reading order: the calendar with the hard rules BESIDE it —
 * every occasion next to what may and may not be done with it, which is the
 * shape the religion guardrail demands — then the conventions.
 */
const SECTIONS = [
  { file: 'evergreen/retail-calendar.md', pair: 'compliance-guardrails.md' },
  { file: 'evergreen/pricing-and-offers.md' },
  { file: 'evergreen/channels-and-platforms.md' },
  { file: 'evergreen/tone-and-dialect.md' },
]

const read = (rel: string): string => {
  try { return readFileSync(join(DIR, rel), 'utf8') } catch { return '' }
}

/**
 * The dated layer: timely/ files, each pulled by a person running a script.
 * Frontmatter's last_verified is separated from the body because it is not
 * content — it is the one fact the reader needs BEFORE the content, and the
 * timely/ contract says the date is displayed in the UI beside what it dates.
 */
function timely(): { name: string; verified: string; days: number; body: string }[] {
  let files: string[] = []
  try {
    files = readdirSync(join(DIR, 'timely')).filter((f) => f.endsWith('.md') && f !== 'README.md')
  } catch { return [] }
  return files.sort().map((name) => {
    const raw = read(join('timely', name))
    const fm = raw.match(/^---\n([\s\S]*?)\n---\n/)
    const verified = fm?.[1].match(/last_verified:\s*(\S+)/)?.[1] ?? ''
    const days = verified
      ? Math.floor((Date.now() - new Date(verified).getTime()) / 86_400_000)
      : Infinity
    const body = (fm ? raw.slice(fm[0].length) : raw)
      // The renderer drops h1 because the evergreen panels are named by the
      // page. A timely file is named by ITSELF, so its title survives as an h2.
      .replace(/^# /m, '## ')
    return { name, verified, days, body }
  })
}

/* ── A markdown renderer the size of the markdown it renders ──────────────
 * Headings, tables, lists, bold, inline code, fences, links. Nothing else
 * appears in these files, and a dependency for five files is the wrong trade.
 */

function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = []
  // An escaped \* is a literal star, not emphasis — the channels file opens a
  // bold footnote with one. Swapped to a private-use char so the classes below
  // never see it, restored on the way out.
  const ESC = '\uE000'
  const un = (s: string) => s.replaceAll(ESC, '*')
  text = text.replaceAll('\\*', ESC)
  // Bold, italics, inline code, links — one pass, bold before single-asterisk
  // so ** is never read as two italics.
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(un(text.slice(last, m.index)))
    if (m[1] !== undefined) out.push(<b key={`${key}-${m.index}`}>{un(m[1])}</b>)
    else if (m[2] !== undefined) out.push(<i key={`${key}-${m.index}`}>{un(m[2])}</i>)
    else if (m[3] !== undefined) out.push(<code key={`${key}-${m.index}`}>{un(m[3])}</code>)
    else out.push(<a key={`${key}-${m.index}`} href={m[5]} target="_blank" rel="noreferrer">{un(m[4])}</a>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(un(text.slice(last)))
  return out
}

function table(lines: string[], key: number): ReactNode {
  const cells = (l: string) => l.split('|').slice(1, -1).map((c) => c.trim())
  const [head, , ...body] = lines
  return (
    <table className="catalogue" key={key}>
      <thead><tr>{cells(head).map((c, i) => <th key={i}>{inline(c, i)}</th>)}</tr></thead>
      <tbody>
        {body.map((r, i) => (
          <tr key={i}>{cells(r).map((c, j) => <td key={j}>{inline(c, i * 20 + j)}</td>)}</tr>
        ))}
      </tbody>
    </table>
  )
}

function markdown(src: string): ReactNode[] {
  const out: ReactNode[] = []
  const lines = src.split('\n')
  let i = 0
  let key = 0
  while (i < lines.length) {
    const line = lines[i]

    if (line.startsWith('```')) {
      const fence: string[] = []
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) fence.push(lines[i])
      i++
      out.push(<pre key={key++}><code>{fence.join('\n')}</code></pre>)
      continue
    }
    if (line.startsWith('|')) {
      const rows: string[] = []
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++])
      out.push(table(rows, key++))
      continue
    }
    if (line.startsWith('- ')) {
      const items: string[] = []
      while (i < lines.length && lines[i].startsWith('- ')) items.push(lines[i++].slice(2))
      out.push(<ul className="list" key={key++}>{items.map((t, j) => <li key={j}>{inline(t, j)}</li>)}</ul>)
      continue
    }
    // The file's h1 is dropped — the panel it renders into already names it,
    // and a page of five h1s has no outline.
    if (line.startsWith('# ')) { i++; continue }
    if (line.startsWith('## ')) { out.push(<h2 key={key++}>{inline(line.slice(3))}</h2>); i++; continue }
    if (line.startsWith('### ')) { out.push(<h3 key={key++}>{inline(line.slice(4))}</h3>); i++; continue }
    if (line.trim() === '') { i++; continue }

    const para: string[] = []
    while (i < lines.length && lines[i].trim() !== '' && !/^(#|\||- |```)/.test(lines[i])) {
      para.push(lines[i++])
    }
    out.push(<p key={key++}>{inline(para.join(' '))}</p>)
  }
  return out
}

export default function Kuwait() {
  return (
    <main>
      <h1>Kuwait</h1>
      <p className="sub">
        The stable layer of &ldquo;knows Kuwait&rdquo; — the calendar, the hard rules, and the
        conventions — plus a dated snapshot of what Kuwait is searching, pulled by hand. A feed
        says what is moving, never what to do with it: the angle built on any of this is typed
        on the <a href="/campaigns">campaign</a> by the person who knows.
      </p>

      {timely().map((t) => (
        <div className="panel knowledge" key={t.name}>
          {/* The date is the first thing on the panel, and going stale is said
              plainly. Viral specifics live 3\u201314 days (timely/README); a
              two-week-old trend presented without a warning is the exact
              "confidently recommend a dead sound" failure vision.md names. */}
          <p className={t.days > 7 ? 'notice warn' : 'hint'}>
            {t.verified
              ? t.days > 7
                ? `Pulled ${t.verified} \u2014 ${t.days} days old and past its shelf life.`
                : `Pulled ${t.verified}. The pull sends nothing \u2014 it reads one public feed and writes a file here.`
              : 'Undated \u2014 treat as stale.'}
          </p>
          <RefreshTrends />
          {markdown(t.body)}
        </div>
      ))}
      {timely().length === 0 && (
        <div className="panel knowledge">
          <h2>Trending searches</h2>
          <p>
            Nothing pulled yet. The button fetches today\u2019s Kuwait search trends \u2014 public
            data, one request on your click, nothing sent \u2014 and this panel renders the result
            with its date.
          </p>
          <RefreshTrends />
        </div>
      )}

      {SECTIONS.map(({ file, pair }) => {
        const main = read(file)
        if (!main) return null
        const beside = pair ? read(pair) : ''
        return beside ? (
          // The calendar and the guardrails share a row on a wide screen:
          // every occasion sits beside what may and may not be done with it.
          // Splitting them onto separate screens is how "Ramadan offer" and
          // "religion as a marketing angle" stop being read as one decision.
          <div className="kw-pair" key={file}>
            <div className="panel knowledge">{markdown(main)}</div>
            <div className="panel knowledge">{markdown(beside)}</div>
          </div>
        ) : (
          <div className="panel knowledge" key={file}>{markdown(main)}</div>
        )
      })}
    </main>
  )
}
