'use client'

/**
 * The products a person is working on right now, across screens.
 *
 * This lived only in the Designs page's query string. That was right about its
 * lifetime and wrong about its reach: switching to Social media to write copy
 * for the two products just picked showed nothing picked, and coming back
 * through the sidebar — a bare `/templates` — dropped the selection for good.
 *
 * sessionStorage keeps exactly the lifetime the URL had: one browser tab, gone
 * when it closes, never shared with another window or another person. What it
 * adds is surviving a move between screens, which is the entire point of
 * picking products before deciding what to do with them.
 *
 * Deliberately NOT the campaign. A campaign is a durable record with a name
 * that stamps what gets made under it. This is "these two, right now", and it
 * must stay disposable — the moment it needs a lifecycle it has become a
 * different feature.
 */

const KEY = 'aimarketing:picked'

export function readPicked(): string[] {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : []
  } catch {
    // A private window, blocked site data, or something else's key in ours.
    return []
  }
}

export function writePicked(skus: string[]): void {
  try {
    if (skus.length) sessionStorage.setItem(KEY, JSON.stringify(skus))
    else sessionStorage.removeItem(KEY)
  } catch {
    // Storage refused. The Designs page still carries the selection in its own
    // URL, so nothing on that screen breaks; only the hand-over is lost.
  }
}
