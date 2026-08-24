'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * The one interactive element on an otherwise server-rendered page. POSTs to
 * the route that runs the pull script, then router.refresh() so the server
 * re-reads the file it wrote — the page stays the single renderer of timely/.
 */
export function RefreshTrends() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  const pull = async () => {
    setBusy(true)
    setNote('')
    const r = await fetch('/api/kuwait/trends', { method: 'POST' }).catch(() => null)
    const d = await r?.json().catch(() => null)
    setBusy(false)
    if (r?.ok) {
      setNote(`Refreshed — ${d?.trends} trends.`)
      router.refresh()
    } else {
      // D56's rule from the other side: a failed pull says so, and the stale
      // file on screen keeps its honest date rather than pretending.
      setNote(d?.error ?? 'Could not refresh — is this machine online?')
    }
  }

  return (
    <p className="trends-refresh">
      <button className="btn small" disabled={busy} onClick={() => void pull()}>
        {busy ? 'Pulling…' : 'Refresh trends'}
      </button>
      {note && <span className="hint"> {note}</span>}
    </p>
  )
}
