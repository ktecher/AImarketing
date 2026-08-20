'use client'

import { useEffect, useState } from 'react'

const SAMPLES = [
  { label: 'English — short',   text: 'MacBook Pro' },
  { label: 'English — long',    text: 'ASUS RT-AX88U Wi-Fi 6 Dual Band Gigabit Router' },
  { label: 'Arabic',            text: 'راوتر أسوس واي فاي 6 ثنائي النطاق' },
  { label: 'Code-switched',     text: 'MacBook Pro 14 بوصة' },
  { label: 'Arabic + price',    text: 'ماك بوك برو 14 بوصة — 449.500 دينار' },
  { label: 'Ligature test',     text: 'لا يوجد' },
]

type Result = {
  svg: string
  fitted: { lines: string[]; size: number; truncated: boolean; widest: number; direction: string }
  mode: string
  shrunk: boolean
}

export default function Typography() {
  const [text, setText] = useState('ماك بوك برو 14 بوصة — 449.500 دينار')
  const [width, setWidth] = useState(420)
  const [size, setSize] = useState(48)
  const [maxLines, setMaxLines] = useState(2)
  const [mode, setMode] = useState('auto')
  const [fontName, setFontName] = useState('Cairo')
  const [r, setR] = useState<Result | null>(null)

  useEffect(() => {
    const id = setTimeout(async () => {
      const res = await fetch('/api/typography', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, width, height: 180, size, maxLines, mode, fontName }),
      })
      if (res.ok) setR(await res.json())
    }, 120)
    return () => clearTimeout(id)
  }, [text, width, size, maxLines, mode, fontName])

  return (
    <main>
      <h1>Typography</h1>
      <p className="sub">
        The layout engine, live. Shaping, measurement, wrapping, auto-fit and
        bidi isolation — the part of the system that decides whether 200 designs
        look made or generated.
      </p>

      <div className="grid2">
        <div className="panel">
          <label className="fld">
            <span>Text</span>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} />
          </label>

          <div className="chips">
            {SAMPLES.map((s) => (
              <button key={s.label} className="chip" onClick={() => setText(s.text)}>{s.label}</button>
            ))}
          </div>

          <div className="row">
            <label className="fld">
              <span>Box width <b>{width}</b></span>
              <input type="range" min={120} max={700} value={width}
                     onChange={(e) => setWidth(+e.target.value)} />
            </label>
            <label className="fld">
              <span>Nominal size <b>{size}</b></span>
              <input type="range" min={12} max={96} value={size}
                     onChange={(e) => setSize(+e.target.value)} />
            </label>
          </div>

          <div className="row">
            <label className="fld">
              <span>Max lines</span>
              <select value={maxLines} onChange={(e) => setMaxLines(+e.target.value)}>
                {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="fld">
              <span>Font</span>
              <select value={fontName} onChange={(e) => setFontName(e.target.value)}>
                <option>Cairo</option><option>Tajawal</option><option>Noto Naskh Arabic</option>
              </select>
            </label>
            <label className="fld">
              <span>Text mode</span>
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="auto">auto</option>
                <option value="live">live text</option>
                <option value="outline">outlined</option>
              </select>
            </label>
          </div>
        </div>

        <div>
          <div className="panel preview" dangerouslySetInnerHTML={{ __html: r?.svg ?? '' }} />

          {r && (
            <div className="panel" style={{ marginTop: 12 }}>
              <div className="kv"><span>Fitted size</span><b>{r.fitted.size}{r.shrunk && <em> shrunk from {size}</em>}</b></div>
              <div className="kv"><span>Lines</span><b>{r.fitted.lines.length}</b></div>
              <div className="kv"><span>Widest line</span><b>{r.fitted.widest}px of {width}</b></div>
              <div className="kv"><span>Direction</span><b>{r.fitted.direction}</b></div>
              <div className="kv">
                <span>Rendered as</span>
                <b>{r.mode === 'outline' ? 'outlined paths' : 'live text'}</b>
              </div>
              {r.fitted.truncated && (
                <div className="issue error" style={{ marginTop: 10 }}>
                  Truncated — this would be listed in the batch report rather than
                  silently cut.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="panel" style={{ marginTop: 22 }}>
        <h2 style={{ marginTop: 0 }}>What to try</h2>
        <p style={{ margin: '0 0 8px' }}>
          <b>Drag the width down</b> with Arabic text — it wraps first, then shrinks,
          and only truncates once it hits the floor. Never shrinks a line that could
          have been two.
        </p>
        <p style={{ margin: '0 0 8px' }}>
          <b>Pick &ldquo;Arabic + price&rdquo;</b> — the number stays in the right place.
          A price inside an Arabic run is bidi-neutral and reorders wrongly without
          isolation. That is the bug that shows up on demo day, not in testing.
        </p>
        <p style={{ margin: 0 }}>
          <b>Switch to outlined</b> — the Arabic becomes vector paths. Not editable
          as text, but immune to whether a designer&rsquo;s Illustrator has the
          Middle Eastern composer switched on, which it is not by default.
        </p>
      </div>
    </main>
  )
}
