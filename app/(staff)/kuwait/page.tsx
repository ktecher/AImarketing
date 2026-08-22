import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReactNode } from 'react'

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
 * What this deliberately is not: a trends feed. Nothing offline can know this
 * week, and a model asked will answer confidently and be wrong (vision.md).
 * This week's specifics have a home already — the campaign's context box — and
 * the header sends people there.
 */

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
        conventions. What is trending <i>this week</i> lives on the{' '}
        <a href="/campaigns">campaign</a>, typed in by the person who knows, because nothing
        offline can — and a system that pretends otherwise will confidently recommend a dead sound.
      </p>

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
