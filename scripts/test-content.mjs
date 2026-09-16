// The checks between a generated draft and an approved one, and the only path
// from a catalogue row to a printed figure. No model runs here — these are the
// parts that must hold whatever the model writes.
const { check, fill, blockers } = await import('../lib/content/guard.ts')
const { formatKwd } = await import('../lib/money.ts')

const ok = (label, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) process.exitCode = 1 }

const ROW = {
  sku: 'ABC-1', name_en: 'HP Pavilion 15 Laptop', brand: 'HP', category: 'Laptops',
  price_now: 89.75, price_was: 129.9,
}
const PLAIN = { sku: 'X-2', name_en: 'Kettle', brand: 'Braun', price_now: 12.5 }

const failed = (text, row = ROW) => blockers(check(text, row)).map((c) => c.name)
const passes = (text, row = ROW) => blockers(check(text, row)).length === 0

// Rule 2: the model never emits a number. A digit it typed is a rejected draft.
ok('a typed price fails',              failed('Yours for 89.750 KD').includes('no invented numbers'))
ok('a typed spec fails',               failed('16GB of RAM, ready to go').includes('no invented numbers'))
ok('a placeholder passes',             passes('Yours for {price_now}.'))
ok('the failing span is quoted',       check('Yours for 89.750 KD', ROW).find((c) => c.name === 'no invented numbers').span === '89.750')
ok('digits inside a name are fine',    passes('{name_en} is here.'))

// A model name is what the product IS, and it is verbatim in its own row.
// Blocking it fired on three of eight real drafts for an iPad Pro.
const IPAD = { ...ROW, name_en: 'Apple iPad Pro (M4) 5G Tablet, 1TB, 13-inch', brand: 'APPLE', category: 'Tablets' }
ok('a model name passes',              passes('Experience the power of M4.', IPAD))
ok('a hashtagged model name passes',   passes('#M4 #iPadPro', IPAD))
ok('a size from the title passes',     passes('The 13-inch screen.', IPAD))
// ...but only from the identity fields. A figure lifted from a spec paragraph
// is exactly what rule 2 is about.
ok('a spec-only figure is refused',    failed('With 32GB of memory.', IPAD).includes('no invented numbers'))
ok('a typed price is still refused',   failed('Only 19.900 KD.', IPAD).includes('no invented numbers'))
ok('an invented percentage refused',   failed('Save 40% today.', IPAD).includes('no invented numbers'))

// A dangling placeholder prints a gap where a number should be.
ok('unresolvable placeholder fails',   failed('Was {price_was}, now {price_now}.', PLAIN).includes('every placeholder has a value'))
ok('resolvable one passes',            passes('Was {price_was}, now {price_now}.'))
ok('an invented field fails',          failed('Only {stock_level} left').includes('every placeholder is a real field'))
// The pre-discount price is not a placeholder. Reaching it through one puts a
// number the customer will not be charged into a caption — CLAUDE.md rule 3.
ok('the pre-discount price is refused', failed('Only {price_kwd} today.', { ...ROW, price_kwd: 129.9 })
                                          .includes('every placeholder is a real field'))
ok('sale_price_kwd is refused',        failed('Was {sale_price_kwd}.', { ...ROW, sale_price_kwd: 89.75 })
                                          .includes('every placeholder is a real field'))
ok('a bare {price} is refused',        failed('Just {price}.', { ...ROW, price: 89.75 })
                                          .includes('every placeholder is a real field'))
// Bookkeeping is not a fact about a product.
ok('the row number is refused',        failed('Row {row}', { ...ROW, row: 2 }).includes('every placeholder is a real field'))
ok('on_sale is refused',               failed('{on_sale} now', { ...ROW, on_sale: true }).includes('every placeholder is a real field'))
ok('the SKU is refused',               failed('Code {sku}').includes('every placeholder is a real field'))
// A capitalised column is what the sheet actually calls it, so the model reaches
// for it. It must resolve or fail — never print as literal braces.
ok('a capitalised column resolves',    passes('In {Colour}.', { ...ROW, Colour: 'White' }) &&
                                       fill('In {Colour}.', { ...ROW, Colour: 'White' }) === 'In White.')
ok('a capitalised internal is refused', failed('{hasImage}', { ...ROW, hasImage: true }).includes('every placeholder is a real field'))

// A real retailer's sheet carries columns that are real, populated, and unsafe
// to assert. parse.ts keeps every one of them verbatim, deliberately — so the
// guard, not the parser, is what stands between them and a caption.
const RETAILER = { ...ROW, Stock: 'Yes', 'Monthly Installment': '5.000 KWD',
                'Discount %': 51, 'Category Path': 'Computers > Tablets', 'Product URL': 'https://x.com/p',
                Colour: 'White' }
const UNSAFE = 'no claim taken from a spare column'
ok('stock is not assertable',          failed('In stock: {Stock}', RETAILER).includes(UNSAFE))
ok('a financing figure is refused',    failed('From {Monthly Installment}', RETAILER).includes(UNSAFE))
ok('the stale discount column refused', failed('Save {Discount %}', RETAILER).includes(UNSAFE))
ok('a category path is refused',       failed('In {Category Path}', RETAILER).includes(UNSAFE))
ok('a product link is refused',        failed('See {Product URL}', RETAILER).includes(UNSAFE))
ok('the reason is the real one',       check('In stock: {Stock}', RETAILER).find((c) => c.name === UNSAFE).hint.includes('snapshot'))
// The derived one still works — it is not read from the sheet.
ok('{discount_pct} still allowed',     passes('Save {discount_pct}.', RETAILER))
ok('a safe spare column still works',  passes('In {Colour}.', RETAILER))
// Spaces in a column name must not let it slip past unexamined.
ok('a spaced token is examined',       failed('From {Monthly Installment}', RETAILER).length > 0)
// The vocabulary is the sheet's own column names, which is what the model was shown.
ok('a real sheet column passes',       passes('The {name_en} from {brand}.'))
ok('a column this row lacks fails',    failed('The {name_ar} is here.').includes('every placeholder is a real field'))
// A description is a spec dump. Substituted mid-sentence it parses and reads like a parts list.
ok('a description is not a placeholder', failed('Enjoy {description_en} today.', { ...ROW, description_en: 'Bluetooth. Transmits Position, Angle, Force.' }).includes('every placeholder is a real field'))
ok('an empty column fails',            failed('A {category} you will use.', { ...PLAIN, category: '' }).includes('every placeholder has a value'))

// knowledge/kuwait/compliance-guardrails.md treats these as blockers, not notes.
ok('superlative blocked',              failed('The best price in Kuwait').includes('no unsubstantiable superlative'))
ok('"number one" blocked',             failed('Number one in Kuwait.').includes('no unsubstantiable superlative'))
ok('a lifetime promise blocked',       failed('Lifetime warranty included.').includes('no guarantee the company has not made'))
ok('competitor comparison blocked',    failed('Faster than anything else').includes('no comparison to a competitor'))
ok('guarantee blocked',                failed('Delivery guaranteed tomorrow').includes('no guarantee the company has not made'))
ok('religious angle blocked',          failed('A blessed choice for your home').includes('nothing religious or political'))
ok('clean copy has no blockers',       passes('Serious work, quietly done. {name_en}, now {price_now}.'))
ok('every check is binary',            check('anything', ROW).every((c) => typeof c.pass === 'boolean'))
ok('no check carries a score',         !JSON.stringify(check('anything', ROW)).match(/score|rating|grade/i))

// Substitution is the only way a figure reaches the copy, and KWD is three decimals.
ok('price filled to three decimals',   fill('Now {price_now}.', ROW) === 'Now 89.750 KD.')
ok('struck price filled',              fill('Was {price_was}.', ROW) === 'Was 129.900 KD.')
ok('discount derived, never read',     fill('Save {discount_pct}.', { ...ROW, discount_pct: 99 }) === 'Save 31%.')
ok('no discount leaves the token',     fill('Save {discount_pct}.', PLAIN) === 'Save {discount_pct}.')
ok('name filled from the row',         fill('{name_en} is here.', ROW) === 'HP Pavilion 15 Laptop is here.')
ok('a price with no value stays a token', fill('Was {price_was}.', PLAIN) === 'Was {price_was}.')
ok('one formatter, three decimals',    formatKwd(12.5) === '12.500 KD' && formatKwd('KD 449.5') === '449.500 KD')
ok('nothing is not zero',              formatKwd(undefined) === '' && formatKwd('') === '')

// --- a token spelled without the title's spaces ---
//
// "#M4Pro" is the product's own "M4 Pro", closed up as a hashtag. Blocking it
// blocked all eight hashtags, which are approved as one piece. The characters
// must still come from the product's identity fields — this closes the spaces,
// it does not widen what counts as the product.
const MBP = { sku: 'X', name_en: 'Apple MacBook Pro 16, M4 Pro Chip, 48GB RAM', brand: 'APPLE',
              category: 'Laptops', price_now: 759.9, price_was: 999.9 }
const numOf = (t, v) => check(t, v).find((c) => c.name === 'no invented numbers')

ok("a hashtag closing the title's spaces passes", numOf('#M4Pro #Apple', MBP).pass)
ok('the spaced form still passes',               numOf('The M4 Pro chip', MBP).pass)
ok('a figure not in the name is still blocked',  !numOf('Only 5 left in stock', MBP).pass)
ok('an invented price is still blocked',         !numOf('Yours for 499.000 KD', MBP).pass)

// Bare digits never get the squashed comparison: "99s" must not match by
// running "48GB RAM" into a neighbouring number.
const RUNON = { sku: 'Y', name_en: 'Thing 16GB RAM 99 Series', brand: 'B', category: 'C',
                price_now: 10, price_was: 20 }
ok('bare digits are not matched across a gap',   !numOf('save 1699 today', RUNON).pass)
ok('"3D" is still blocked — not a quantity, but the check cannot tell',
   !numOf('a 3D soundscape', MBP).pass)

// A bare number must BE one of the numbers in the name, not sit inside one.
// includes('4') is true of "14-inch", "512GB" and "M4 Max", which is how the
// assistant came to answer "how many laptops do you have" with "I have 4".
const SPECS = { sku: 'S1', name_en: 'Asus Vivobook 15, Ryzen 5, 16GB RAM, 512GB SSD, 14-inch',
                brand: 'ASUS', category: 'Standard Laptops', price_now: 149.9, price_was: 199.9 }
ok('a number that is in the name passes',      numOf('It has 16GB RAM', SPECS).pass)
ok('another one in the name passes',           numOf('512GB of storage', SPECS).pass)
ok('a digit merely INSIDE a number is caught', !numOf('We have 4 in stock', SPECS).pass,
   'the name holds 15, 5, 16, 512 and 14 — none of them is 4')
ok('a digit inside 14-inch is caught',         !numOf('Just 1 left', SPECS).pass)
ok('an invented count is caught',              !numOf('We have 23 laptops', SPECS).pass)

// --- formatKwd must never print a figure the shop did not set ---
//
// `Number('')` is 0 AND finite, so anything that stripped to nothing used to
// print "0.000 KD" — indistinguishable, on a poster, from a real price.
ok('a real number formats',        formatKwd(12.5) === '12.500 KD')
ok('a numeric string formats',     formatKwd('12.5') === '12.500 KD')
ok('a price with a unit formats',  formatKwd('12.500 KD') === '12.500 KD')
ok('"N/A" prints nothing',         formatKwd('N/A') === '')
ok('"Call for price" prints nothing', formatKwd('Call for price') === '')
ok('an em dash prints nothing',    formatKwd('—') === '')
// The sign was stripped before the number was read, so a broken cell became a
// plausible price. A negative price does not exist in a catalogue.
ok('a negative is refused, not flipped', formatKwd('-5') === '')
ok('nothing is still nothing',     formatKwd('') === '' && formatKwd(null) === '' && formatKwd(undefined) === '')
// Zero itself is a real number a person can set, and must still print.
ok('a genuine zero still prints',  formatKwd(0) === '0.000 KD')

// --- the Products edit screen, the other price path ---
//
// asPrice normalises a price cell on blur. Its own comment claimed "19,900"
// landed on 19.900; it printed 19900.000. "-5" printed 5.000 and "N/A" printed
// 0.000 — the same "a figure nobody set" failure as above, on the one screen a
// person types prices into. It defers to formatKwd now, and refuses the comma
// formatKwd does not catch, leaving anything it will not take exactly as typed.
{
  const { asPrice } = await import('../app/(staff)/products/page.tsx')
  ok('a plain price gains three decimals', asPrice('19.9') === '19.900')
  ok('an integer gains three decimals',    asPrice('12') === '12.000')
  ok('a price with its unit is accepted',  asPrice('12.500 KD') === '12.500')
  ok('a genuine zero still formats',       asPrice('0') === '0.000')
  ok('an ambiguous comma is left alone, not read as 19900',
     asPrice('19,900') === '19,900')
  ok('a negative is left alone, not stripped to 5.000',
     asPrice('-5') === '-5')
  ok('"N/A" is left alone, not turned into 0.000',
     asPrice('N/A') === 'N/A')
  ok('an empty cell stays empty',          asPrice('') === '')
}

// --- Arabic compliance, after the ta marbuta fold ---
//
// Four curated stems are spelled with ه where Arabic writes ة, so before the
// fold NONE of them could match real text and four checks were silently dead.
// The control at the end matters as much as the rest: a fold that made the
// guard fire on ordinary Arabic would be the opposite failure.
{
  const AR = { sku: 'AR-1', name_en: 'Test', price_now: 10, price_was: 20 }
  const fires = (t) => blockers(check(t, AR)).map((c) => c.name)

  ok('أعلى جودة — a superlative in real spelling is caught',
     fires('أعلى جودة في الكويت').includes('no unsubstantiable superlative'))
  ok('ضمان مدى الحياة — a lifetime guarantee is caught',
     fires('ضمان مدى الحياة على كل الأجهزة').length > 0)
  ok('بركة — a religious angle is caught',
     fires('عرض بركة رمضان').length > 0)
  ok('صلاة — likewise',
     fires('احصل عليه قبل صلاة الجمعة').length > 0)

  // Control. Plain product copy with ة in ordinary words — شاشة, بطارية, ساعة —
  // must still pass, or the fold has made the guard useless in the other
  // direction.
  ok('ordinary Arabic copy still passes',
     fires('شاشة كبيرة وبطارية تدوم طوال اليوم').length === 0,
     JSON.stringify(fires('شاشة كبيرة وبطارية تدوم طوال اليوم')))
}

// --- coverage() ---
//
// The Publish screen only ever accepts a `kind === 'caption'` piece, but the
// Studio screen's counters cover all four kinds — a product with an approved
// hashtag set and an approved script and no approved caption showed "2
// approved" in the Publish dropdown and then refused to publish, because the
// label and the gate were answering different questions with the same
// number. `captions` is the narrower, third count that fixes the label
// without touching what `drafts`/`approved` mean to the screen that already
// gets them right.
{
  const { mkdirSync, writeFileSync, rmSync, existsSync, renameSync } = await import('node:fs')

  // Swap the real store aside so this never reads or writes somebody's real work.
  const DIR = 'data/state/content'
  const STASH = 'data/state/content.testbackup'

  // A stash already here means the last run was INTERRUPTED, and the stash is
  // the real work — recover it rather than delete it. This was `rmSync(STASH)`,
  // the destructive half of a data-loss bug: no `finally` and no exit handler
  // runs on SIGINT, `npm test` is a long chain people press Ctrl-C in, and the
  // next run then deleted what the interrupted one had set aside. `data/state/`
  // is gitignored, so that was final.
  if (existsSync(STASH)) {
    rmSync(DIR, { recursive: true, force: true })
    renameSync(STASH, DIR)
  }
  if (existsSync(DIR)) renameSync(DIR, STASH)
  mkdirSync(DIR, { recursive: true })

  const restore = () => {
    try {
      rmSync(DIR, { recursive: true, force: true })
      if (existsSync(STASH)) renameSync(STASH, DIR)
    } catch { /* the stash is still on disk under its own name */ }
  }
  // Signals as well as `finally`: SIGINT is the one exit path a person causes.
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => { restore(); process.exit(130) })
  }

  // Everything below runs inside try/finally, and that is not ceremony. The
  // real store has been RENAMED aside: if anything in here throws — a bad
  // fixture, an import failure, a change to coverage() itself — an early exit
  // leaves the person's actual drafts sitting in `content.testbackup` while
  // `data/state/content` holds two fake products. The screen would show their
  // work as gone. A test that can eat the data it is testing has to put it
  // back on every path out, not just the happy one.
  try {

  const piece = (over) => ({
    id: 'x', sku: 'ABC-1', kind: 'caption', lang: 'en', channel: 'instagram',
    text: '', checks: [], status: 'draft', source: 'model',
    model: 'gemma4:12b', prompt_version: 'content/v3', campaign_id: null,
    created_at: '2026-08-20T09:00:00.000Z', ...over,
  })

  // ABC-1: one approved caption, one draft caption. The straightforward case.
  writeFileSync(`${DIR}/ABC-1.json`, JSON.stringify([
    piece({ id: 'a', kind: 'caption', status: 'approved', approved_at: '2026-08-20T10:00:00.000Z' }),
    piece({ id: 'b', kind: 'caption' }),
  ]))

  // XYZ-2: the bug. An approved hashtag set and an approved script — nothing
  // Publish can use — and no approved caption at all.
  writeFileSync(`${DIR}/XYZ-2.json`, JSON.stringify([
    piece({ id: 'c', sku: 'XYZ-2', kind: 'hashtags', status: 'approved', approved_at: '2026-08-20T10:00:00.000Z' }),
    piece({ id: 'd', sku: 'XYZ-2', kind: 'script', status: 'approved', approved_at: '2026-08-20T10:00:00.000Z' }),
    piece({ id: 'e', sku: 'XYZ-2', kind: 'caption' }), // draft only — must not count
  ]))

  const { coverage } = await import('../lib/content/studio.ts')
  const cov = coverage()

  ok('an approved caption counts',            cov['ABC-1'].captions === 1)
  ok('a draft caption does not count',        cov['ABC-1'].drafts === 1 && cov['ABC-1'].approved === 1)

  ok('the bug: approved hashtag+script, no caption',
     cov['XYZ-2'].approved === 2 && cov['XYZ-2'].captions === 0)
  ok('the draft caption stays a draft',       cov['XYZ-2'].drafts === 1)

  rmSync(DIR, { recursive: true, force: true })
  ok('an absent store returns {} without throwing', JSON.stringify(coverage()) === '{}')

  } finally {
    restore()
  }
}
