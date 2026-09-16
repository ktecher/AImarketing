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

const WARNING: Partial<Record<Row['feature'], string>> = {
  sales_chat: 'Customer messages leave this machine and go to the connected provider while this is set to a cloud option.',
}

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

  if (loadError) return <p style={{ color: '#c0392b' }}>{loadError}</p>
  if (!rows) return <p>Loading…</p>

  const options: Row['provider'][] = ['local', 'openai', 'anthropic', 'google']

  return (
    <div style={{ maxWidth: 640 }}>
      <h1>AI provider</h1>
      {error && <p style={{ color: '#c0392b' }}>{error}</p>}
      {rows.map((r) => {
        const shown = pendingProvider[r.feature] ?? r.provider
        const isCloud = shown !== 'local' && shown !== 'default'
        const rowBusy = busy === r.feature
        // hasKey reflects whatever is saved for r.provider. The moment `shown`
        // picks a DIFFERENT cloud provider, that flag describes the wrong
        // provider's key, not this one's.
        const hasKeyForShown = r.hasKey && shown === r.provider
        return (
          <div key={r.feature} style={{ marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid #ddd' }}>
            <strong>{LABEL[r.feature]}</strong>
            <div style={{ fontSize: 13, color: '#666' }}>
              Currently: {r.resolvedProvider}{r.resolvedModel ? ` (${r.resolvedModel})` : ''}
            </div>
            <select
              value={shown}
              onChange={(e) => { if (!rowBusy) choose(r.feature, e.target.value as Row['provider']) }}
              disabled={rowBusy}
            >
              {r.feature !== 'global' && <option value="default">Default (follows global)</option>}
              {options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            {isCloud && (
              <input
                type="password"
                placeholder={hasKeyForShown ? 'Key saved — enter a new one to replace it' : 'API key'}
                value={keyDraft[r.feature] ?? ''}
                onChange={(e) => setKeyDraft((d) => ({ ...d, [r.feature]: e.target.value }))}
                onBlur={() => { if (!rowBusy && keyDraft[r.feature]) save(r.feature, shown) }}
                disabled={rowBusy}
                style={{ marginLeft: 8 }}
              />
            )}
            {WARNING[r.feature] && isCloud && (
              <p style={{ color: '#c0392b', fontSize: 13 }}>{WARNING[r.feature]}</p>
            )}
          </div>
        )
      })}
    </div>
  )
}
