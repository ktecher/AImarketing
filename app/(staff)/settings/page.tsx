'use client'

import { useEffect, useState } from 'react'

type Row = {
  feature: 'global' | 'content_studio' | 'advisor' | 'sales_chat' | 'campaigns'
  provider: 'default' | 'local' | 'openai' | 'anthropic' | 'google'
  model: string | null
  hasKey: boolean
  resolvedProvider: string
  resolvedModel: string | null
}

const LABEL: Record<Row['feature'], string> = {
  global: 'Global default',
  content_studio: 'Content studio',
  advisor: 'Creative advisor',
  sales_chat: 'Sales chat',
  campaigns: 'Campaigns / meeting',
}

/* What each feature would actually send, in the words of the person who has to
   decide. "Catalogue rows" is what leaves; "content_studio" is how the table
   spells it, and nobody reading this screen thinks in table names. */
const SENDS: Record<Row['feature'], string> = {
  global: 'Whatever the features below inherit from it.',
  content_studio: 'Product names, prices and descriptions from the campaign sheet.',
  advisor: 'The draft the team pasted in, and the checks run against it.',
  sales_chat: 'What customers type, and the catalogue rows retrieved to answer them.',
  campaigns: 'The campaign brief, the shelf it matched, and the whole meeting transcript.',
}

const PROVIDER: Record<Exclude<Row['provider'], 'default'>, string> = {
  local: 'Local (Ollama)',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
}

const options: Exclude<Row['provider'], 'default'>[] = ['local', 'openai', 'anthropic', 'google']

export default function SettingsPage() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [keyDraft, setKeyDraft] = useState<Record<string, string>>({})
  // A cloud choice isn't saved until a key is entered, so the select shows this
  // instead of the server's row.provider while one is pending — otherwise a
  // provider picked with no key yet would revert on the 400 and the key field
  // that's supposed to appear for it would never show.
  const [pendingProvider, setPendingProvider] = useState<Record<string, Row['provider']>>({})

  async function load() {
    const res = await fetch('/api/settings/ai')
    const data = await res.json()
    if (res.ok) {
      setRows(data.rows)
      setLoadError(null)
    } else {
      setLoadError(data.error || 'Could not load settings.')
    }
  }
  useEffect(() => { load() }, [])

  async function save(feature: Row['feature'], provider: Row['provider']) {
    setBusy(feature)
    setError(null)
    const res = await fetch('/api/settings/ai', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feature, provider, apiKey: keyDraft[feature] || undefined }),
    })
    const data = await res.json()
    setBusy(null)
    if (!res.ok) { setError(data.error); return }
    setRows(data.rows)
    setKeyDraft((d) => ({ ...d, [feature]: '' }))
    setPendingProvider((p) => { const n = { ...p }; delete n[feature]; return n })
  }

  function choose(feature: Row['feature'], provider: Row['provider']) {
    // A stray keystroke in the key field for the PREVIOUS provider can still
    // be sitting in keyDraft; it means nothing for the newly-picked one.
    setKeyDraft((d) => ({ ...d, [feature]: '' }))
    if (provider === 'local' || provider === 'default') {
      setPendingProvider((p) => { const n = { ...p }; delete n[feature]; return n })
      save(feature, provider)
    } else {
      setPendingProvider((p) => ({ ...p, [feature]: provider }))
    }
  }

  if (loadError) return <p className="err">{loadError}</p>
  if (!rows) return <p className="hint">Loading…</p>

  const global = rows.find((r) => r.feature === 'global')
  const features = rows.filter((r) => r.feature !== 'global')

  /* One row of the screen. The global default and the four features differ in
     what they may be set to and in nothing else, so they are drawn by the same
     function rather than by two that drift apart. */
  function control(r: Row) {
    const shown = pendingProvider[r.feature] ?? r.provider
    const isCloud = shown !== 'local' && shown !== 'default'
    const rowBusy = busy === r.feature
    // hasKey reflects whatever is saved for r.provider. The moment `shown`
    // picks a DIFFERENT cloud provider, that flag describes the wrong
    // provider's key, not this one's.
    const hasKeyForShown = r.hasKey && shown === r.provider
    const inherits = r.provider === 'default'
    const draft = keyDraft[r.feature] ?? ''

    return (
      <>
        <div className="row">
          <label className="fld" style={{ flex: '1 1 220px', marginBottom: 0 }}>
            <span>Runs on</span>
            <select
              value={shown}
              onChange={(e) => { if (!rowBusy) choose(r.feature, e.target.value as Row['provider']) }}
              disabled={rowBusy}
            >
              {r.feature !== 'global' && <option value="default">Follow the global default</option>}
              {options.map((o) => <option key={o} value={o}>{PROVIDER[o]}</option>)}
            </select>
          </label>
        </div>

        {isCloud && (
          <form
            className="row"
            style={{ marginTop: 12, alignItems: 'flex-end' }}
            onSubmit={(e) => { e.preventDefault(); if (!rowBusy && draft) save(r.feature, shown) }}
          >
            <label className="fld" style={{ flex: '1 1 260px', marginBottom: 0 }}>
              <span>{PROVIDER[shown]} API key</span>
              <input
                type="password"
                placeholder={hasKeyForShown ? 'Saved — enter a new one to replace it' : 'Paste the key'}
                value={draft}
                onChange={(e) => setKeyDraft((d) => ({ ...d, [r.feature]: e.target.value }))}
                disabled={rowBusy}
              />
            </label>
            <button className="btn" type="submit" disabled={rowBusy || !draft}>
              {rowBusy ? 'Checking the key…' : hasKeyForShown ? 'Replace key' : 'Save key'}
            </button>
          </form>
        )}

        {/* The one place the screen raises its voice. Sales chat is the only
            feature whose input is somebody else's words rather than the
            company's own, so it is the only one that gets a warning. */}
        {isCloud && r.feature === 'sales_chat' && (
          <p className="notice warn-notice" style={{ marginTop: 12, marginBottom: 0 }}>
            Customer messages leave this machine while sales chat is on a cloud provider.
          </p>
        )}

        {isCloud && !hasKeyForShown && (
          <p className="hint" style={{ marginTop: 10 }}>
            Nothing changes until the key is saved. It is checked against {PROVIDER[shown]} first,
            then encrypted here — {inherits ? 'until then this keeps following the global default' : `until then this stays on ${PROVIDER[(r.provider === 'default' ? 'local' : r.provider)]}`}.
          </p>
        )}
      </>
    )
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <div className="section-head">
        <h1>AI provider</h1>
      </div>

      <p className="hint" style={{ maxWidth: '62ch', marginTop: 0 }}>
        Every feature writes with the local model unless you point it somewhere else.
        Retrieval always stays local: a catalogue embedded by one model cannot be
        searched by another.
      </p>

      {error && <p className="err" style={{ marginBottom: 14 }}>{error}</p>}

      {global && (
        <div className="panel">
          <div className="panel-head">
            <b>{LABEL.global}</b>
            <span className="badge live">{label(global)}</span>
          </div>
          <p className="hint" style={{ marginTop: 0 }}>
            What a feature uses when it has no choice of its own. Changing it moves
            every feature below that is still following it.
          </p>
          {control(global)}
        </div>
      )}

      {features.map((r) => (
        <div className="panel" key={r.feature}>
          <div className="panel-head">
            <b>{LABEL[r.feature]}</b>
            {/* Warn, not error: sending a caption to a cloud model is a choice
                the screen exists to offer. `bad` here would be a red flag on a
                legitimate answer, and the next red flag would be ignored too. */}
            <span className={`badge ${r.resolvedProvider === 'local' ? 'live' : 'part'}`}>{label(r)}</span>
          </div>
          <p className="hint" style={{ marginTop: 0 }}>{SENDS[r.feature]}</p>
          {control(r)}
        </div>
      ))}
    </div>
  )
}

/* The badge says where the work actually happens, which for a feature on
   "default" is not what its own row stores. Resolution is the server's answer,
   never recomputed here. */
function label(r: Row): string {
  const where = r.resolvedProvider === 'local' ? 'local' : r.resolvedProvider
  return r.resolvedModel ? `${where} · ${r.resolvedModel}` : where
}
