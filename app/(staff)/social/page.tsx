'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CurrentCampaign } from '../current-campaign'
import { readPicked, writePicked } from '../picked'

type Platform = 'facebook' | 'instagram'
type Account = { id: string; platform: Platform; name: string; connected_at: string }
type Piece = { id: string; kind: string; status: string; text: string; filled: string }
type Product = { sku: string; name: string; onSale?: boolean; approved?: number; drafts?: number; captions?: number }
/** A check from `check()` in lib/content/guard, kept as a local shape rather
 * than importing that module into this client bundle for one type. */
type Check = { name: string; pass: boolean; span?: string; hint?: string }
type Tpl = { id: string; name: string }
/** One account's outcome. Per account, because one failing does not stop the others. */
type Result = {
  accountId: string; ok: boolean; platformPostId?: string; permalinkUrl?: string; error?: string
  /** Set instead of a post id when this was scheduled rather than sent (D89).
   * `ok: true` is shared by both, so this is the only thing that tells them apart. */
  scheduled?: string
}
type Post = {
  id: string; skus: string[]; account_id: string; caption: string
  // Mirrors PostStatus in lib/social/store.ts. 'scheduled' and 'missed' are
  // D89: waiting to go out, and its time passed with nothing running to send it.
  status: 'scheduled' | 'publishing' | 'posted' | 'failed' | 'missed'
  permalink_url: string | null; error: string | null; created_at: string
  scheduled_at: string | null
  /** When it actually went out. Null until it has. */
  posted_at: string | null
}

/** The same stamp the Inbox and Campaigns screens use, so two dates read alike. */
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { hour12: false }).replace(',', '')

const PLATFORM: Record<Platform, string> = { facebook: 'Facebook', instagram: 'Instagram' }

/**
 * What a history row calls the post's subject.
 *
 * A carousel is about several products and naming only the first would read as
 * if that were the whole post — the count is the honest summary, and the
 * permalink is there for anyone who wants the rest.
 */
const productLabel = (skus: string[]) =>
  skus.length === 0 ? 'no product' : skus.length === 1 ? skus[0] : `${skus.length} products`

/** A caption is a paragraph; a dropdown option is a line. */
const oneLine = (s: string) => {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > 72 ? `${flat.slice(0, 71)}…` : flat
}

export default function Social() {
  // null while unknown. An empty array is "nobody has connected an account",
  // which is a real first-run state and must not be shown when the truth is
  // that the request failed — those are different screens and only one of them
  // has a Connect button that will work.
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [apiDown, setApiDown] = useState(false)
  /**
   * How the last connection attempt ended, if this load is the one it came back to.
   *
   * The callback route decides every outcome — cancelled, an expired state, a
   * missing app id, a database that would not take the row — and redirects here
   * with it in the query string. Nothing read those, so pressing Cancel on Meta's
   * dialog landed on an identical Connect panel that said nothing at all, and so
   * did every real failure.
   */
  const [connectMsg, setConnectMsg] = useState<{ text: string; bad: boolean } | null>(null)

  const [products, setProducts] = useState<Product[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [onlyPicked, setOnlyPicked] = useState(true)
  const [sku, setSku] = useState('')

  const [templates, setTemplates] = useState<Tpl[]>([])
  const [templateId, setTemplateId] = useState('')
  const [image, setImage] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)

  const [pieces, setPieces] = useState<Piece[]>([])
  const [captionId, setCaptionId] = useState('')
  const [caption, setCaption] = useState('')

  // Bug: an edit made in the box below used to reach only the published post —
  // nothing wrote it back, so reopening the product showed the un-fixed line
  // again. The fix is D-shaped on purpose: an edit is never allowed to
  // overwrite the approved caption (that would defeat the point of approving
  // one), so it is offered as a save of a NEW draft instead, for review.
  const [savingDraft, setSavingDraft] = useState(false)
  const [saveChecks, setSaveChecks] = useState<Check[] | null>(null)
  const [draftSaved, setDraftSaved] = useState(false)

  // Posting several products in one go. Kept beside the single-product compose
  // area rather than replacing it: one product is still the common case and a
  // list of one is a worse way to say it.
  const [batchCaptions, setBatchCaptions] = useState<Record<string, string>>({})
  const [batchOn, setBatchOn] = useState<Set<string>>(new Set())
  const [carouselCaption, setCarouselCaption] = useState('')
  /** '' when idle; otherwise what is happening, counted so ten is not a blank wait. */
  const [batchBusy, setBatchBusy] = useState('')
  const [batchConfirm, setBatchConfirm] = useState<'' | 'each' | 'carousel'>('')
  const [batchDone, setBatchDone] = useState<
    // `scheduled` is counted apart from `posted` for the reason the publish
    // route counts them apart: a post that has not happened yet must never be
    // announced as one that has. See below.
    { sku: string; posted: number; scheduled: number; at?: string; accounts: number; error?: string }[] | null
  >(null)

  /** '' means send it now. Otherwise a datetime-local value (D89). */
  const [sendAt, setSendAt] = useState('')
  const [queue, setQueue] = useState<Post[]>([])

  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [results, setResults] = useState<Result[] | null>(null)
  const [error, setError] = useState('')
  const [history, setHistory] = useState<Post[]>([])
  /** Only what actually happened. What has not is the queue panel's job. */
  const past = history.filter((p) => p.status !== 'scheduled' && p.status !== 'missed')

  /**
   * datetime-local hands back a wall-clock string with no zone, and `new Date()`
   * reads it as local time — which is what somebody typing 19:00 means. Sent as
   * an instant so the server never has to guess which 19:00.
   */
  const asInstant = (local: string) => (local ? new Date(local).toISOString() : undefined)

  const loadQueue = useCallback(async () => {
    try {
      const r = await fetch('/api/social/scheduled')
      const d = (await r.json()) as { posts?: Post[] }
      setQueue(d.posts ?? [])
    } catch { /* the panel simply stays as it was */ }
  }, [])

  useEffect(() => { void loadQueue() }, [loadQueue])

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const said = q.get('error') ?? ''
    // A cancel is not an error and does not get Meta's words for it
    // ("Permissions error." is what it actually sends), but it still gets a line
    // — an unchanged screen is indistinguishable from a press that did nothing.
    const text = q.get('cancelled') === '1'
      ? 'Connection cancelled — nothing was connected.'
      : said || (q.get('connected') === '1' ? `Connected ${q.get('names') ?? ''}`.trim() + '.' : '')
    if (!text) return
    setConnectMsg({ text, bad: q.get('connected') !== '1' })
    // Off the URL once it has been read: a refresh must not re-announce an
    // outcome from ten minutes ago. Everything else in the query string stays —
    // ?sku is read by the effect below.
    for (const one of ['error', 'cancelled', 'connected', 'names']) q.delete(one)
    const rest = q.toString()
    window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''))
  }, [])

  const loadAccounts = useCallback(async () => {
    try {
      const res = await fetch('/api/social/accounts')
      if (!res.ok) throw new Error(String(res.status))
      const d = await res.json()
      setAccounts(d.accounts ?? [])
      setApiDown(false)
    } catch {
      // Route missing, or Postgres down. Either way this screen cannot publish,
      // and saying "no accounts connected" would send somebody to a Connect
      // button that is equally unreachable.
      setAccounts(null)
      setApiDown(true)
    }
  }, [])

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/social/posts?limit=20')
      if (!res.ok) throw new Error(String(res.status))
      const d = await res.json()
      setHistory(d.posts ?? [])
    } catch {
      // History is the nice-to-have half of this screen; publishing still works
      // without it, so it disappears rather than taking the page down.
      setHistory([])
    }
  }, [])

  useEffect(() => { void loadAccounts(); void loadHistory(); void loadQueue() }, [loadAccounts, loadHistory])

  // Every connected account is ticked to start with, because posting to both is
  // the ordinary case and the confirmation step names them before anything
  // leaves. ONCE, though: this re-ticked everything on every accounts reload, so
  // disconnecting a third account silently re-selected one somebody had
  // deliberately unticked — on the control that decides where something public
  // goes. Afterwards a reload only prunes, because an id that is no longer
  // connected is still sent by `publish()` and comes back as a failed line.
  const firstAccounts = useRef(true)
  useEffect(() => {
    if (!accounts) return
    const live = new Set(accounts.map((a) => a.id))
    // Read into a local BEFORE the updater is handed over. React calls that
    // function during the next render, not here — reading the ref inside it saw
    // the `false` written on the line below and took the pruning branch on the
    // very first load, so nothing was ticked and the button said "nothing
    // ticked" next to a connected account.
    const first = firstAccounts.current
    firstAccounts.current = false
    setChosen((was) => (first ? live : new Set([...was].filter((id) => live.has(id)))))
  }, [accounts])

  useEffect(() => {
    // The products picked on Designs, exactly as the studio reads them: somebody
    // who picked two products and walked here means those two.
    const chose = readPicked()
    setPicked(chose)
    void fetch('/api/studio')
      .then((r) => r.json())
      .then((d) => {
        const list: Product[] = d.products ?? []
        setProducts(list)
        // ?sku= is a deliberate jump from a campaign report row, and must not
        // land on a dropdown narrowed to a selection it is not part of.
        const wanted = new URLSearchParams(window.location.search).get('sku')
        const known = wanted && list.some((p) => p.sku === wanted)
        if (known && !chose.includes(wanted)) setOnlyPicked(false)
        const firstPicked = chose.find((s) => list.some((p) => p.sku === s))
        if (list.length) setSku((s) => s || (known ? wanted : firstPicked ?? list[0].sku))
      })
      .catch(() => setProducts([]))
  }, [])

  useEffect(() => {
    void fetch('/api/templates')
      .then((r) => r.json())
      .then((d) => {
        const list: Tpl[] = d.templates ?? []
        setTemplates(list)
        setTemplateId((t) => t || list[0]?.id || 'brand-poster')
      })
      .catch(() => {})
  }, [])

  /**
   * One render at Instagram's square edge, used for BOTH the preview and the
   * bytes that get published. A smaller second render for the screen would be a
   * second thing that can disagree with what actually went out, and the whole
   * job of this page is showing you the post before it is public.
   */
  useEffect(() => {
    if (!sku || !templateId) return
    let live = true
    setRendering(true)
    setImage(null)
    void fetch('/api/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId, skus: [sku], width: 1080, limit: 1 }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!live) return
        const png = d.results?.[0]?.png
        setImage(png ? `data:image/png;base64,${png}` : null)
      })
      .catch(() => { if (live) setImage(null) })
      .finally(() => { if (live) setRendering(false) })
    return () => { live = false }
  }, [sku, templateId])

  useEffect(() => {
    if (!sku) return
    setCaptionId('')
    setCaption('')
    setResults(null)
    setSaveChecks(null)
    setDraftSaved(false)
    void fetch(`/api/studio?sku=${encodeURIComponent(sku)}`)
      .then((r) => r.json())
      .then((d) => {
        const list: Piece[] = d.pieces ?? []
        setPieces(list)
        const first = list.find((p) => p.status === 'approved' && p.kind === 'caption')
        if (first) { setCaptionId(first.id); setCaption(first.filled) }
      })
      .catch(() => setPieces([]))
  }, [sku])

  // Joined rather than the array itself: a new array every render restarts the
  // effect forever, and this is a list of a dozen short strings.
  const mineKey = products.filter((p) => picked.includes(p.sku)).map((p) => p.sku).join(',')

  useEffect(() => {
    const skus = mineKey ? mineKey.split(',') : []
    if (skus.length < 2) return
    let stale = false
    // Parallel is fine here and nowhere else on this screen: these are local
    // reads of drafts already written, not model calls.
    void Promise.all(skus.map(async (one) => {
      try {
        const r = await fetch(`/api/studio?sku=${encodeURIComponent(one)}`)
        const d = (await r.json()) as { pieces?: Piece[] }
        const cap = (d.pieces ?? []).find((x) => x.status === 'approved' && x.kind === 'caption')
        return [one, cap ? cap.filled || cap.text : ''] as const
      } catch {
        return [one, ''] as const
      }
    })).then((pairs) => {
      if (stale) return
      setBatchCaptions(Object.fromEntries(pairs))
      // Pre-ticked only where there is something to post. A product with no
      // approved caption cannot go out, and ticking it would promise otherwise.
      setBatchOn(new Set(pairs.filter(([, c]) => c).map(([one]) => one)))
      setCarouselCaption((was) => was || (pairs.find(([, c]) => c)?.[1] ?? ''))
    })
    return () => { stale = true }
  }, [mineKey])

  const setSelection = (next: string[]) => {
    setPicked(next)
    writePicked(next)
    // Widening or narrowing must leave a product selected that is actually
    // listed, or the deck shows a name the dropdown no longer offers.
    const list = next.length && onlyPicked ? products.filter((x) => next.includes(x.sku)) : products
    if (!list.some((x) => x.sku === sku)) setSku(list[0]?.sku ?? '')
  }

  const product = products.find((p) => p.sku === sku)
  const mine = products.filter((p) => picked.includes(p.sku))
  const listed = onlyPicked && mine.length ? mine : products

  const toggleScope = () => {
    const next = !onlyPicked
    setOnlyPicked(next)
    const list = next && mine.length ? mine : products
    if (!list.some((p) => p.sku === sku)) setSku(list[0]?.sku ?? '')
  }

  // Approved only. An unapproved draft reaching the public is the failure this
  // whole pillar exists downstream of — the studio is where a line is judged.
  const captions = pieces.filter((p) => p.status === 'approved' && p.kind === 'caption')
  const tags = pieces.find((p) => p.status === 'approved' && p.kind === 'hashtags')

  // Whether the box still says what the approved piece says. Compared against
  // the FILLED text, because that is what is on screen — comparing against the
  // stored placeholder form would call an untouched caption "edited" the
  // moment its price differed from the placeholder text.
  const captionSource = captions.find((c) => c.id === captionId)
  const captionEdited = Boolean(captionSource) && caption !== captionSource!.filled

  const ticked = (accounts ?? []).filter((a) => chosen.has(a.id))
  // Instagram rejects a post with no image outright, so this cannot be
  // discovered at publish time — the person would have pressed a button that
  // was never going to work. Every connected account is an Instagram account
  // since D86, so ticking one is all it takes.
  const needsImage = !image && ticked.length > 0

  const blocked = !ticked.length
    ? 'nothing ticked'
    : !caption.trim()
      ? 'no caption'
      : needsImage
        ? 'needs an image'
        : ''

  /**
   * Saves the box's current text as a new draft piece, for later review.
   *
   * Never touches the approved piece it came from — approval is a human
   * judgement and silently rewriting it would defeat the review. `check()`
   * runs server-side first; a blocker (an invented price, say) comes back as
   * `saveChecks` and nothing is written.
   */
  async function saveDraftEdit() {
    if (!captionSource) return
    setSavingDraft(true)
    setSaveChecks(null)
    try {
      const res = await fetch('/api/studio', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku, action: 'save-draft', from: captionSource.id, text: caption }),
      })
      const d = await res.json().catch(() => ({}))
      if (d.saved) {
        setPieces(d.pieces ?? [])
        setDraftSaved(true)
      } else {
        setSaveChecks(d.checks ?? [{ name: 'save failed', pass: false, hint: d.error ?? 'Could not save.' }])
      }
    } catch (e) {
      setSaveChecks([{ name: 'save failed', pass: false, hint: e instanceof Error ? e.message : 'Could not save.' }])
    }
    setSavingDraft(false)
  }

  async function publish() {
    setPublishing(true)
    setError('')
    setResults(null)
    try {
      const res = await fetch('/api/social/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountIds: [...chosen],
          caption,
          // A one-element list. There is no separate single-post shape (D88).
          skus: sku ? [sku] : [],
          templateId,
          imageDataUrls: image ? [image] : [],
          scheduledAt: asInstant(sendAt),
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) setError(d.error ?? `Publishing failed (${res.status}).`)
      else setResults(d.results ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Publishing failed.')
    }
    setPublishing(false)
    setConfirming(false)
    void loadHistory(); void loadQueue()
  }

  /**
   * One post per product, in order, each with its own caption.
   *
   * Sequentially, and not because the server could not take them at once: each
   * call renders a design and uploads it, and ten of those in parallel on a
   * laptop also running Postgres and a local model is how a demo dies. It also
   * makes the progress line true — "4 of 10" means four have actually gone out.
   *
   * One failure does not stop the rest, for the same reason the route does not
   * abort on one account: the realistic failure is one product's design, and the
   * other nine are still perfectly postable.
   */
  async function postEach() {
    const list = [...batchOn]
    setBatchConfirm('')
    setBatchDone(null)
    setError('')
    const out: { sku: string; posted: number; scheduled: number; at?: string; accounts: number; error?: string }[] = []
    for (let i = 0; i < list.length; i++) {
      const one = list[i]
      setBatchBusy(`Posting ${i + 1} of ${list.length}…`)
      try {
        const res = await fetch('/api/social/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accountIds: [...chosen],
            caption: batchCaptions[one] ?? '',
            skus: [one],
            templateId,
            scheduledAt: asInstant(sendAt),
          }),
        })
        const d = (await res.json().catch(() => ({}))) as
          { results?: Result[]; error?: string }
        const rs = d.results ?? []
        // `ok: true` is shared by "sent to Instagram" and "written to the
        // queue" — the route returns it for a scheduled post WITHOUT calling
        // Instagram at all. `r.scheduled` is the only thing that separates
        // them, so counting `ok` alone reported unsent posts as published.
        const queued = rs.filter((r) => r.ok && r.scheduled)
        out.push({
          sku: one,
          posted: rs.filter((r) => r.ok && !r.scheduled).length,
          scheduled: queued.length,
          at: queued[0]?.scheduled,
          accounts: rs.length,
          error: d.error ?? rs.find((r) => !r.ok)?.error,
        })
      } catch (e) {
        out.push({ sku: one, posted: 0, scheduled: 0, accounts: 0,
          error: e instanceof Error ? e.message : 'Publishing failed.' })
      }
      // Set inside the loop, so a long run shows what has already happened
      // rather than nothing until the end.
      setBatchDone([...out])
    }
    setBatchBusy('')
    void loadHistory(); void loadQueue()
  }

  /**
   * All of them as one Instagram carousel.
   *
   * One post, one caption — Instagram permits exactly one per carousel, which is
   * why the box below exists rather than the per-product captions being joined
   * into something nobody wrote.
   *
   * Reuses the single-post `results` display: a carousel is still one post to N
   * accounts, so the outcome has the same shape.
   */
  /**
   * Move one product to the front of the carousel.
   *
   * A Set keeps insertion order, so the order things were ticked in IS the
   * carousel order and rebuilding the Set with one product first is the whole
   * operation. Instagram shows the first image as the cover and it is the only
   * one that appears in a grid, so "which is first" is the only ordering
   * question worth a control; the rest is the order they were picked in.
   */
  function makeFirst(sku: string) {
    setBatchOn((was) => new Set([sku, ...[...was].filter((s) => s !== sku)]))
  }

  /** Selected, in carousel order — the order the customer will swipe through. */
  const carouselOrder = [...batchOn]
  /** Ticked products with nothing approved to say. Fine in a carousel, not alone. */
  const unsayable = carouselOrder.filter((sku) => !batchCaptions[sku])

  async function postCarousel() {
    const list = [...batchOn]
    setBatchConfirm('')
    setBatchDone(null)
    setError('')
    setBatchBusy(`Rendering ${list.length} designs and building the carousel…`)
    try {
      const res = await fetch('/api/social/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountIds: [...chosen],
          caption: carouselCaption,
          skus: list,
          templateId,
          scheduledAt: asInstant(sendAt),
        }),
      })
      const d = (await res.json().catch(() => ({}))) as { results?: Result[]; error?: string }
      if (!res.ok) setError(d.error ?? `Publishing failed (${res.status}).`)
      else setResults(d.results ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Publishing failed.')
    }
    setBatchBusy('')
    void loadHistory(); void loadQueue()
  }

  /** Drop something that has not gone out. Refuses anything already public. */
  async function drop(id: string) {
    try {
      const r = await fetch(`/api/social/scheduled?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!r.ok) setError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Could not drop it.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not drop it.')
    }
    await loadQueue()
  }

  /**
   * Send a waiting or missed post now.
   *
   * Goes through the same claim the sweep uses, so pressing this while a sweep
   * is mid-flight cannot publish the same post twice — one of them loses and
   * says so.
   */
  async function sendNow(id: string) {
    setError('')
    setBatchBusy('Sending it now…')
    try {
      const r = await fetch('/api/social/scheduled', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!r.ok) setError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Could not send it.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send it.')
    }
    setBatchBusy('')
    await loadQueue()
    void loadHistory()
  }

  async function disconnect(id: string) {
    try {
      await fetch(`/api/social/accounts?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    } catch { /* reported by the reload below, which will still show the account */ }
    await loadAccounts()
  }

  /** An account may have been disconnected since it posted, so history stands alone. */
  const accountName = (id: string) =>
    (accounts ?? []).find((a) => a.id === id)?.name ?? PLATFORM[id.split(':')[0] as Platform] ?? id

  return (
    <main>
      <h1>Publish</h1>
      <CurrentCampaign verb="Everything posted here is stamped" />

      {connectMsg && (
        <div className={connectMsg.bad ? 'err' : 'notice'} style={{ marginTop: 14 }}>
          {connectMsg.text}
        </div>
      )}

      {apiDown && (
        <div className="err">
          The publishing service is not answering, so nothing can be posted from here.
          Designs and captions are unaffected.
        </div>
      )}

      {accounts?.length === 0 && (
        <div className="panel">
          <b>Connect Instagram</b>
          <p className="hint">
            Publishing posts to the company&rsquo;s own Instagram account. Until one is
            connected there is nowhere for a post to go. It has to be a Business or
            Creator account — Instagram will not let an app post to a personal one.
          </p>
          {/* A link, never a fetch: this route redirects to Meta and the browser
              has to follow it. Nothing on this page ever holds a token. */}
          <p style={{ marginTop: 14 }}>
            <a className="btn" href="/api/social/instagram/start">Connect</a>
          </p>
        </div>
      )}

      {accounts && accounts.length > 0 && (
        <>
          {mine.length > 0 && (
            <p className="hint" style={{ marginTop: -14, marginBottom: 14 }}>
              {onlyPicked
                ? `${mine.length} ${mine.length === 1 ? 'product' : 'products'} picked on Designs.`
                : 'Every product in the catalogue.'}
              <button className="chip" onClick={toggleScope}>
                {onlyPicked ? `Show all ${products.length}` : `Show my ${mine.length}`}
              </button>
            </p>
          )}

          {/* Only when there is more than one. A batch panel over a single
              product is a list of one, which is a worse way to say what the
              compose area below already says. */}
          {mine.length > 1 && (
            <details className="panel" open style={{ marginBottom: 14 }}>
              <summary className="fold">
                Post several at once
                <span> — {batchOn.size} of {mine.length} selected</span>
              </summary>

              <p className="hint" style={{ marginTop: 10 }}>
                One post each, or all of them as a single carousel. Instagram allows
                exactly one caption per carousel, so a carousel uses the box below
                rather than joining the captions into something nobody wrote — and
                a product with nothing approved to say can still ride in one. The
                first in the list is the cover: it is what shows in the grid.
              </p>



              {/* Full width explicitly: a bare textarea takes its size from cols
                  and renders as a stamp next to the buttons. */}
              <textarea rows={2} value={carouselCaption}
                        style={{ marginTop: 12, width: '100%', display: 'block' }}
                        aria-label="Caption for the carousel"
                        placeholder="Caption for the carousel — one for the whole post"
                        onChange={(e) => setCarouselCaption(e.target.value)} />

              <p style={{ marginTop: 12 }}>
                {/* Separate posts need a caption EACH, and this is where that is
                    refused now that the checkbox allows an uncaptioned product
                    to be ticked for a carousel. The button says which ones. */}
                <button className="btn small"
                        disabled={!batchOn.size || unsayable.length > 0
                                  || Boolean(blocked && blocked !== 'no caption') || Boolean(batchBusy)}
                        onClick={() => setBatchConfirm('each')}>
                  Post separately ({batchOn.size})
                </button>
                {' '}
                {/* Two is the least that is a carousel. One would silently
                    publish an ordinary post under a button that says otherwise. */}
                <button className="btn small" disabled={batchOn.size < 2 || !carouselCaption.trim() || Boolean(blocked && blocked !== 'no caption') || Boolean(batchBusy)}
                        onClick={() => setBatchConfirm('carousel')}>
                  Post as one carousel ({batchOn.size})
                </button>
              </p>

              {unsayable.length > 0 && (
                <p className="hint" style={{ marginTop: -4 }}>
                  {unsayable.length} of the {batchOn.size} ticked {unsayable.length === 1 ? 'has' : 'have'}
                  {' '}no approved caption. They can go in the carousel, which carries one
                  caption for the whole post — they cannot go out as separate posts.
                </p>
              )}

              {/* Capped and scrolled. A campaign of twenty-six pushed the buttons
                  below the fold and left a list nothing could act on. */}
              <div style={{ maxHeight: 240, overflowY: 'auto', marginTop: 12 }}>
              {/* The order NEVER depends on what is ticked. Sorting the selected
                  to the top re-sorts the list under the pointer on every click,
                  so ticking three in a row lands on three different products —
                  found by doing exactly that. Carousel position is shown as a
                  number instead, which says the same thing and holds still. */}
              {[...mine].sort((a, b) =>
                // The ones with something approved to say first: a screen
                // opening on twelve rows saying "write one first" buries the
                // two that are ready to go.
                Number(Boolean(batchCaptions[b.sku])) - Number(Boolean(batchCaptions[a.sku]))
              ).map((m) => {
                const cap = batchCaptions[m.sku] ?? ''
                const at = carouselOrder.indexOf(m.sku)
                return (
                  <div className="kv" key={m.sku} style={{ gap: 12 }}>
                    <label style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
                      {/* Tickable with or without a caption. A carousel carries
                          exactly one caption for the whole post, so requiring
                          one per product kept products out of a carousel that
                          had nothing to say and did not need to. Posting them
                          SEPARATELY still needs one each, and that button says
                          so rather than this checkbox refusing in advance. */}
                      <input type="checkbox" checked={batchOn.has(m.sku)}
                             onChange={(e) => setBatchOn((was) => {
                               const next = new Set(was)
                               if (e.target.checked) next.add(m.sku); else next.delete(m.sku)
                               return next
                             })} />
                      {at === 0 && <span className="badge live">cover</span>}
                      {at > 0 && <span className="hint" style={{ minWidth: 14 }}>{at + 1}</span>}
                      {/* One line. A full laptop name wraps to three and the
                          list stops being scannable. */}
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {m.name}
                      </span>
                    </label>
                    <span className="hint" style={{ whiteSpace: 'nowrap', display: 'flex', gap: 10 }}>
                      {at > 0 && (
                        <button className="linkish" onClick={() => makeFirst(m.sku)}>make cover</button>
                      )}
                      {cap
                        ? oneLine(cap)
                        : <a href={`/studio?sku=${encodeURIComponent(m.sku)}`}>no caption — write one</a>}
                    </span>
                  </div>
                )
              })}
              </div>

              {batchConfirm && (
                <div className="confirm">
                  <b>
                    {batchConfirm === 'each'
                      ? 'Post ' + batchOn.size + ' separate posts?'
                      : 'Post one carousel of ' + batchOn.size + ' products?'}
                  </b>
                  <p>
                    To {ticked.map((a) => a.name).join(' and ')}.{' '}
                    {sendAt
                      ? 'It goes out at ' + new Date(sendAt).toLocaleString('en-GB', { hour12: false }).replace(',', '') + ', and only while this app is running. Anything more than half an hour late is marked missed rather than posted, for you to decide.'
                      : 'This is public straight away and cannot be undone here — Instagram has no delete endpoint, so removing a post means opening the app.'}
                  </p>
                  <button className="chip" onClick={() => setBatchConfirm('')}>Cancel</button>
                  {' '}
                  <button className="btn small"
                          onClick={() => void (batchConfirm === 'each' ? postEach() : postCarousel())}>
                    Publish now
                  </button>
                </div>
              )}

              {batchBusy && <div className="notice" style={{ marginTop: 12 }}>{batchBusy}</div>}

              {batchDone && batchDone.map((r) => (
                /* Scheduled first: it is the case that used to be reported as
                   posted, and the word "posted" must not appear for something
                   nobody has seen yet. */
                r.scheduled > 0 ? (
                  <div key={r.sku} className="notice" style={{ marginTop: 8 }}>
                    {products.find((x) => x.sku === r.sku)?.name ?? r.sku}
                    {' — scheduled for ' + r.scheduled + ' of ' + r.accounts + ', '}
                    {r.at ? when(r.at) : 'later'}. Nothing is public yet.
                    {r.error && <span style={{ display: 'block', marginTop: 3 }}>{r.error}</span>}
                  </div>
                ) : r.posted > 0 ? (
                  <div key={r.sku} className="notice" style={{ marginTop: 8 }}>
                    {products.find((x) => x.sku === r.sku)?.name ?? r.sku}
                    {' — posted to ' + r.posted + ' of ' + r.accounts + '.'}
                    {/* "posted to 1 of 2" and nothing else: the reason the other
                        account failed was computed and then dropped on the floor
                        by this branch. Same line as the single-post path below. */}
                    {r.error && <span style={{ display: 'block', marginTop: 3 }}>{r.error}</span>}
                  </div>
                ) : (
                  <div key={r.sku} className="issue error" style={{ marginTop: 8 }}>
                    <b>{products.find((x) => x.sku === r.sku)?.name ?? r.sku} — not posted</b>
                    <span style={{ display: 'block', marginTop: 3 }}>{r.error ?? 'No reason given.'}</span>
                  </div>
                )
              ))}
            </details>
          )}
          {/* Everything that decides what gets posted, pinned above the post
              itself — same bar as Designs, so the two screens are read the same
              way: what am I working on, where is it going, go. */}
          <div className="deck">
            <div className="deck-row">
              {/* Capped, or a long product name sizes the select to the whole
                  row and pushes everything else onto a line of its own —
                  the bar stops being a bar. */}
              <select className="deck-tpl" aria-label="Product" value={sku}
                      style={{ maxWidth: 330 }}
                      onChange={(e) => setSku(e.target.value)}>
                {!listed.length && <option value="">loading…</option>}
                {listed.map((p) => (
                  <option key={p.sku} value={p.sku}>
                    {/* `captions` counts only kind === 'caption', which is all this
                        screen can post. `p.approved` counts every kind — a product
                        with an approved hashtag set and no caption once read
                        "2 approved" here and then said it had none. */}
                    {p.name}{p.captions ? ` · ${p.captions} approved caption${p.captions === 1 ? '' : 's'}` : ''}
                  </option>
                ))}
              </select>

              {/* Against the select, so "it" points at something. Same rule as
                  Write: what acts on ONE product sits by the product, what is
                  about the set stays on the set's line. */}
              {sku && (
                picked.includes(sku)
                  ? <button className="chip danger"
                            onClick={() => setSelection(picked.filter((one) => one !== sku))}>
                      Drop it
                    </button>
                  : <button className="chip add" onClick={() => setSelection([...picked, sku])}>
                      + Keep it
                    </button>
              )}

              {/* Only when there is a choice to make. One template is not a decision. */}
              {templates.length > 1 && (
                <select className="deck-tpl" aria-label="Design" value={templateId}
                        onChange={(e) => setTemplateId(e.target.value)}>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              )}

              <span className="deck-count">
                {ticked.length} of {accounts.length} account{accounts.length === 1 ? '' : 's'}
                {' · '}{rendering ? 'rendering' : image ? 'design ready' : 'no design'}
              </span>

              {/* Empty means now. A separate "schedule this?" toggle beside it
                  would be a second control saying what this one already says. */}
              <input type="datetime-local" className="deck-tpl" aria-label="Send at"
                     value={sendAt} onChange={(e) => setSendAt(e.target.value)} />
              {sendAt && <button className="chip" onClick={() => setSendAt('')}>now</button>}

              <button className="btn small" disabled={!!blocked || publishing || confirming}
                      onClick={() => { setResults(null); setError(''); setConfirming(true) }}>
                {publishing
                  ? (sendAt ? 'Scheduling…' : 'Publishing…')
                  : blocked ? `Publish — ${blocked}` : sendAt ? 'Schedule' : 'Publish'}
              </button>
            </div>

            {/* A real checkbox rather than a chip that toggles. Chips carry
                their state in a border and a tint, and against this theme's
                pale accent a ticked account and an unticked one were nearly the
                same object — on the one control that decides where something
                public goes. The tick is unambiguous, and Designs already uses
                this class for "which of these are on". */}
            <div className="deck-row">
              {accounts.map((a) => (
                <label key={a.id} className="toggle">
                  <input type="checkbox" checked={chosen.has(a.id)}
                         onChange={(e) => setChosen((was) => {
                           const next = new Set(was)
                           if (e.target.checked) next.add(a.id); else next.delete(a.id)
                           return next
                         })} />
                  {a.name} · {PLATFORM[a.platform]}
                </label>
              ))}
            </div>
          </div>

          {/* One step, named. Publishing is public and cannot be taken back from
              this screen, so the destinations are spelled out rather than
              summarised as a count — "2 accounts" is not something you can check. */}
          {confirming && (
            <div className="confirm">
              <b>Post to {ticked.map((a) => `${a.name} (${PLATFORM[a.platform]})`).join(' and ')}?</b>
              <p>
                {product?.name ?? sku} · {caption.trim().length} characters
                {image ? ' · one design' : ' · no image'}.{' '}
                {sendAt
                  ? 'It goes out at ' + new Date(sendAt).toLocaleString('en-GB', { hour12: false }).replace(',', '') + ', and only while this app is running. Anything more than half an hour late is marked missed rather than posted, for you to decide.'
                  : 'This is public straight away and cannot be undone here.'}
              </p>
              <button className="chip" onClick={() => setConfirming(false)}>Cancel</button>
              {' '}
              <button className="btn small" onClick={() => void publish()} disabled={publishing}>
                {publishing ? 'Publishing…' : 'Publish now'}
              </button>
            </div>
          )}

          {publishing && (
            <div className="notice" style={{ marginTop: 14 }}>
              Uploading the design and posting — a few seconds per account.
            </div>
          )}

          {error && <div className="err" style={{ marginTop: 14 }}>{error}</div>}

          {results && (
            <div style={{ marginTop: 14 }}>
              {results.filter((r) => r.ok).map((r) => (
                <div key={r.accountId} className="notice" style={{ marginBottom: 8 }}>
                  {/* A scheduled post shares `ok: true` with a published one —
                      the route sets it without calling Instagram — so this said
                      "Posted to @theshop" about something nobody had seen. It
                      is also the only place that would have said otherwise: if
                      the app is not running at the appointed minute the row is
                      marked missed, and nobody looks, because this line already
                      claimed it went out. */}
                  {r.scheduled
                    ? <>Scheduled for {accountName(r.accountId)}, {when(r.scheduled)}. Nothing is public yet.</>
                    : <>Posted to {accountName(r.accountId)}.{' '}</>}
                  {/* Underlined: inside a notice the link is already the same
                      accent colour as the sentence around it, so colour alone
                      does not say it is a link. */}
                  {r.permalinkUrl && !r.scheduled
                    ? <a href={r.permalinkUrl} target="_blank" rel="noreferrer"
                         style={{ textDecoration: 'underline' }}>See it</a>
                    : null}
                </div>
              ))}
              {results.filter((r) => !r.ok).map((r) => (
                <div key={r.accountId} className="issue error">
                  <b>{accountName(r.accountId)} — not posted</b>
                  <span style={{ display: 'block', marginTop: 3 }}>{r.error ?? 'No reason given.'}</span>
                </div>
              ))}
            </div>
          )}

          <div className="grid2" style={{ marginTop: 18 }}>
            <div className="panel">
              {rendering ? (
                <div className="live placeholder">Rendering the design…</div>
              ) : image ? (
                <img className="live" src={image} alt={`Design for ${product?.name ?? sku}`} />
              ) : (
                <div className="live placeholder">
                  {/* One span, not bare text beside a link: .live.placeholder is
                      a flex container, so each would be a flex item and the
                      space between them is trimmed — "rendered —check it". */}
                  <span>No design rendered — <a href="/templates">check it on Designs</a></span>
                </div>
              )}
            </div>

            <div className="panel">
              {captions.length === 0 ? (
                <>
                  <b>No approved caption for this product</b>
                  <p className="hint">
                    The studio writes captions and you approve one there. An empty box here
                    would let an unapproved line go public, which is the one thing approval is for.
                  </p>
                  <p style={{ marginTop: 14 }}>
                    <a className="btn small" href={`/studio?sku=${encodeURIComponent(sku)}`}>
                      Write one
                    </a>
                  </p>
                </>
              ) : (
                <>
                  <label className="fld">
                    <span>Caption <b>· {captions.length} approved</b></span>
                    <select value={captionId} onChange={(e) => {
                      const p = captions.find((c) => c.id === e.target.value)
                      setCaptionId(e.target.value)
                      if (p) setCaption(p.filled)
                      setSaveChecks(null)
                      setDraftSaved(false)
                    }}>
                      {captions.map((p) => (
                        <option key={p.id} value={p.id}>{oneLine(p.filled)}</option>
                      ))}
                    </select>
                  </label>

                  {/* The FILLED text, not the stored one. The studio keeps
                      {price_now} so a line stays true after a price change, but
                      a post is a fixed thing the moment it is public — the
                      number comes from the catalogue row here, once. */}
                  <label className="fld" style={{ marginBottom: 8 }}>
                    <span>What gets posted <em>edit freely</em></span>
                    <textarea rows={8} value={caption} onChange={(e) => {
                      setCaption(e.target.value)
                      setSaveChecks(null)
                      setDraftSaved(false)
                    }} />
                  </label>

                  <p className="hint" style={{ marginTop: 0 }}>
                    {caption.trim().length} characters
                    {tags && !caption.includes(tags.filled) && (
                      <button className="chip"
                              onClick={() => setCaption((c) => `${c.trimEnd()}\n\n${tags.filled}`)}>
                        + hashtags
                      </button>
                    )}
                  </p>

                  {/* Publishing always sends whatever is in the box above — this
                      is only about what happens to the EDIT afterwards. Approved
                      copy is human-reviewed, so an edit is never written back
                      into it; it can only be saved as a new draft for someone to
                      review and approve like any other. */}
                  {captionEdited && (
                    <p className="hint" style={{ marginTop: 0 }}>
                      Edited away from the approved caption. Publishing still sends what is in the
                      box — saving keeps the edit as a new draft for review and never changes the
                      approved caption above.{' '}
                      <button className="chip" disabled={savingDraft} onClick={() => void saveDraftEdit()}>
                        {savingDraft ? 'Saving…' : 'Save as draft'}
                      </button>
                    </p>
                  )}

                  {draftSaved && (
                    <div className="notice">
                      Saved as a new draft.{' '}
                      <a href={`/studio?sku=${encodeURIComponent(sku)}`}>Review it on Studio</a>.
                    </div>
                  )}

                  {saveChecks && saveChecks.some((c) => !c.pass) && (
                    <div className="issue error">
                      <b>Not saved</b>
                      {saveChecks.filter((c) => !c.pass).map((c) => (
                        <span key={c.name} style={{ display: 'block', marginTop: 3 }}>
                          {c.name}{c.span ? ` — "${c.span}"` : ''}{c.hint ? `. ${c.hint}` : ''}
                        </span>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* One list, not two. A post waiting and a post sent are the same
              row about the same thing at different moments, and splitting them
              meant reading two headings to answer "did it go out". The badge
              already carries the difference, so the heading does not have to.
              Waiting first: what has not happened is what needs a decision. */}
          {(queue.length > 0 || past.length > 0) && (
            <section style={{ marginTop: 26 }}>
              <div className="section-head"><h2>Posts</h2></div>
              {queue.length > 0 && (
                /* The one limitation of the only thing here that acts without a
                   person, said where the waiting posts are read. */
                <p className="hint" style={{ marginBottom: 10 }}>
                  Scheduled posts send only while this app is running. Anything more than
                  half an hour late is marked missed rather than posted late — a stale
                  offer in front of customers is worse than one that did not go out.
                </p>
              )}
              {[...queue, ...past].map((post) => (
                <div className="kv" key={post.id}>
                  <span>
                    {accountName(post.account_id)} · {productLabel(post.skus)}
                    {/* The moment it went out, or the moment it is due. Was
                        created_at, which files a Monday-scheduled Thursday post
                        under Monday. */}
                    {' · '}{when(post.posted_at ?? post.scheduled_at ?? post.created_at)}
                    {post.status === 'failed' && post.error ? ` — ${post.error}` : ''}
                  </span>
                  <b style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {post.status === 'posted' && post.permalink_url
                      ? <a href={post.permalink_url} target="_blank" rel="noreferrer"
                           style={{ textDecoration: 'underline' }}>See it</a>
                      : post.status === 'failed' ? <span className="badge bad">failed</span>
                      : post.status === 'missed' ? <span className="badge bad">missed</span>
                      : post.status === 'scheduled' ? <span className="badge part">scheduled</span>
                      : post.status === 'publishing' ? <span className="badge part">publishing</span>
                      : <span className="badge live">posted</span>}
                    {/* `failed` can be dropped but not sent: a failed publish is
                        an attempt that threw, and its images are on a paid host
                        with only this row naming them. Without a Drop here they
                        stayed there forever. Retrying is deliberately not
                        offered — the caption and the images are still on the
                        composer, and a retry button that silently reuses an
                        expired token is the failure again with a nicer name. */}
                    {(post.status === 'scheduled' || post.status === 'missed' || post.status === 'failed') && (
                      <>
                        {/* Not on a failed post. `claim()` matches only scheduled
                            and missed, so this button would call a no-op and
                            report nothing wrong — a button that does nothing is
                            worse than no button. */}
                        {post.status !== 'failed' && (
                          <button className="chip" disabled={Boolean(batchBusy)}
                                  onClick={() => void sendNow(post.id)}>Post it now</button>
                        )}
                        <button className="chip danger" onClick={() => void drop(post.id)}>
                          {post.status === 'failed' ? 'Drop and free its images' : 'Drop'}
                        </button>
                      </>
                    )}
                  </b>
                </div>
              ))}
            </section>
          )}

          {/* Connected once and then left alone, so it is folded — as four open
              lines it sat above the post and said nothing that changes. */}
          <details className="panel" style={{ marginTop: 26 }}>
            <summary className="fold">
              Accounts
              <span> — {accounts.length} connected</span>
            </summary>
            {accounts.map((a) => (
              <div className="kv" key={a.id}>
                <span>{a.name} · {PLATFORM[a.platform]} · connected {when(a.connected_at)}</span>
                <b>
                  <button className="chip danger" onClick={() => void disconnect(a.id)}>
                    Disconnect
                  </button>
                </b>
              </div>
            ))}
            <p className="hint" style={{ marginTop: 12 }}>
              <a href="/api/social/instagram/start">Connect another</a> — access is stored by the
              server and never reaches this screen. Instagram expires it after sixty days;
              press Connect again when publishing starts saying the token is no longer valid.
            </p>
          </details>
        </>
      )}
    </main>
  )
}
