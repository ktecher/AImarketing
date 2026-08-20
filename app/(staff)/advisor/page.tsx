'use client'

import { useEffect, useState } from 'react'

type Verdict = 'ok' | 'needs work' | 'problem'
type Blocker = { quote: string; criterion: string; why: string }
type Fix = { quote: string; change: string; why: string; criterion: string }
type Review = {
  verdicts: Record<string, Verdict>
  blockers: Blocker[]
  fixes: Fix[]
  not_assessed: string[]
  matched: { sku: string; name: string; confidence: string } | null
}

const HOW_SURE: Record<string, string> = {
  sku: 'you named the SKU',
  lexical: 'matched on the words',
  meaning: 'matched on meaning — check this is the right product',
}

export default function Advisor() {
  const [text, setText] = useState('')
  const [lang, setLang] = useState<'en' | 'ar'>('en')
  const [result, setResult] = useState<Review | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [products, setProducts] = useState<number | null>(null)

  useEffect(() => {
    void fetch('/api/advisor').then((r) => r.json()).then((d) => setProducts(d.products ?? 0)).catch(() => {})
  }, [])

  async function run() {
    if (!text.trim() || busy) return
    setBusy(true); setError(''); setResult(null)
    try {
      const res = await fetch('/api/advisor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, lang }),
      })
      const d = await res.json()
      if (!res.ok) setError(d.error ?? 'Could not review that.')
      else setResult(d.review)
    } catch { setError('Could not review that.') }
    setBusy(false)
  }

  return (
    <main>
      <h1>Creative advisor</h1>
      <p className="sub">
        Paste a draft your team wrote — including work this system did not generate — and see what
        the catalogue disagrees with. No opinion, no marks out of ten. Named checks with the line
        that triggered each one.
      </p>

      {products === 0 && (
        <div className="notice warn-notice">
          No catalogue is loaded, so there is no price to check a draft against.
          Import a product sheet on <b>Designs</b> first.
        </div>
      )}

      <div className="panel">
        <label className="lbl" htmlFor="draft">THE DRAFT</label>
        <textarea
          id="draft"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder="Paste a caption, a slogan, or a video script."
        />
        <div className="row">
          <label className="toggle">
            <input type="checkbox" checked={lang === 'ar'} onChange={(e) => setLang(e.target.checked ? 'ar' : 'en')} />
            this draft is in Arabic
          </label>
          <button className="btn" onClick={() => void run()} disabled={busy || !text.trim()}>
            {busy ? 'Reading…' : 'Review it'}
          </button>
        </div>
      </div>

      {error && <p className="note bad">{error}</p>}

      {result && (
        <>
          {result.matched ? (
            <p className="sub">
              Checked against <b>{result.matched.name}</b> ({result.matched.sku}) — {HOW_SURE[result.matched.confidence]}.
            </p>
          ) : (
            <p className="sub">No product in the catalogue matched this draft, so nothing factual could be checked.</p>
          )}

          <div className="verdicts">
            {Object.entries(result.verdicts).map(([dim, v]) => (
              <div key={dim} className={`verdict ${v.replace(' ', '-')}`}>
                <b>{v}</b>
                <span>{dim}</span>
              </div>
            ))}
          </div>

          {result.blockers.length > 0 ? (
            <div className="panel">
              <h2>Do not publish</h2>
              <p className="sub">
                {result.blockers.length === 1 ? 'One thing' : `${result.blockers.length} things`} the
                catalogue will not back. Each one quotes the line it came from.
              </p>
              {result.blockers.map((b, i) => (
                <div key={i} className="blocker">
                  <q>{b.quote}</q>
                  <b>{b.criterion}</b>
                  <span>{b.why}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="ok-note">Nothing in this draft contradicts the catalogue.</p>
          )}

          {result.fixes.length > 0 && (
            <div className="panel">
              <h2>What to change</h2>
              <p className="sub">Most important first. Three at most — twelve suggestions is none.</p>
              <ol className="fixes">
                {result.fixes.map((f, i) => (
                  <li key={i}>
                    <q>{f.quote}</q>
                    <b>{f.change}</b>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="panel">
            <h2>Not looked at</h2>
            <p className="sub">Said out loud, because silence here would read as a pass.</p>
            <ul className="list blocked">
              {result.not_assessed.map((n) => <li key={n}>{n}</li>)}
            </ul>
          </div>
        </>
      )}
    </main>
  )
}
