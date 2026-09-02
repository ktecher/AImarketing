'use client'

import { useEffect, useState } from 'react'

/**
 * Which campaign this screen's work is being stamped with.
 *
 * The loop was invisible everywhere it actually happens. Exporting a design
 * writes `campaign_id`, writing copy writes it, and a customer conversation
 * writes it — all from `current()`, none of them saying so. The Campaigns
 * screen then reported the result of a joining that nobody had watched happen,
 * which is why "I made a campaign, now what?" had no answer on screen.
 *
 * Deliberately a line of text and not a picker. The current campaign is the
 * newest one — a rule, not a column (D68) — so offering a choice here would
 * imply a selection the system does not have, and the first thing somebody
 * would do is pick an old one and wonder why nothing was stamped with it.
 */
export function CurrentCampaign({ verb }: { verb: string }) {
  const [name, setName] = useState<string | null>(null)
  const [none, setNone] = useState(false)

  useEffect(() => {
    void fetch('/api/campaigns')
      .then((r) => r.json())
      .then((d) => {
        const now = (d.campaigns ?? []).find((c: { id: string }) => c.id === d.current)
        if (now) setName(now.name)
        else if (d.up !== false) setNone(true)
      })
      // Postgres being down is not this component's story to tell — the screen
      // it sits on has its own, louder version of it.
      .catch(() => {})
  }, [])

  if (none) {
    return (
      <p className="stamping none">
        Nothing is being stamped — there is no campaign yet.{' '}
        <a href="/campaigns">Make one first</a> and everything from then on joins up.
      </p>
    )
  }
  if (!name) return null

  return (
    <p className="stamping">
      <i className="now" aria-hidden="true" />
      {verb} under <a href="/campaigns">{name}</a>, and counted in its report.
    </p>
  )
}
