/**
 * A page that does not exist yet, said plainly.
 *
 * Placeholder screens that imply working features are how a demo loses trust the
 * moment somebody clicks one. These state what the module will do, what it is
 * waiting on, and what already works underneath it.
 */
export function Stub({
  title, sub, does, blockedBy, ready,
}: {
  title: string
  sub: string
  does: string[]
  blockedBy?: string[]
  ready?: string[]
}) {
  return (
    <main>
      <h1>{title}</h1>
      <p className="sub">{sub}</p>

      <div className="panel">
        <span className="badge todo">not built yet</span>

        <h2>What it will do</h2>
        <ul className="list">{does.map((d) => <li key={d}>{d}</li>)}</ul>

        {ready && ready.length > 0 && (
          <>
            <h2>Already working underneath</h2>
            <ul className="list done">{ready.map((r) => <li key={r}>{r}</li>)}</ul>
          </>
        )}

        {blockedBy && blockedBy.length > 0 && (
          <>
            <h2>Waiting on</h2>
            <ul className="list blocked">{blockedBy.map((b) => <li key={b}>{b}</li>)}</ul>
          </>
        )}
      </div>
    </main>
  )
}
