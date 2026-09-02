#!/usr/bin/env node
/**
 * What a retail marketing feed must not surface.
 *
 * CLAUDE.md rule 5 and knowledge/kuwait/compliance-guardrails.md forbid
 * political and religious content as a topic, an angle or a hook. That rule was
 * being applied to what the system WRITES and not to what it SHOWS: the news
 * search handed the marketing team "Trump threatens 50% tariffs on all Canadian
 * vehicles" and "Accident on Kuwait motorway as Iranian missiles fly overhead"
 * under a heading about what is trending in cars, and the day's top Kuwait
 * trend was a cleric's call for "وحدة الدول الإسلامية" beside "حكام الخليج".
 * Nobody was going to build a campaign on any of it, and putting it in front of
 * somebody looking for a hook is how one gets built.
 *
 * Shared by both feed scripts so there is one vocabulary rather than two that
 * drift. Deliberately over-eager, on the guardrails' own instruction: "when
 * something is close to the line, it is a blocker." A false positive costs one
 * headline nobody sees; a false negative costs a published campaign that no
 * edit recovers.
 *
 * ── Arabic is not an afterthought here ────────────────────────────────────
 * The Kuwait trends feed is mostly Arabic, and an English-only filter passed
 * every word of the example above. So both languages are matched, over text
 * normalised for the alef and yaa forms Arabic sources spell inconsistently
 * (إسلامية / اسلامية), and the Arabic side matches STEMS as substrings because
 * the language glues its prefixes on: و، ف، ب، ل، ك، ال all attach to the front
 * of a word, so "والحكومة" has to be caught by "حكوم".
 *
 * Stems are chosen to be long enough not to collide. Two that were rejected for
 * colliding, so nobody adds them back: `حج` (pilgrimage) sits inside حجم size,
 * حجز booking and حجر stone, and `سنة` is both "year" and "sunnah".
 *
 * WHAT IS DELIBERATELY ABSENT: Ramadan and Eid. The guardrails draw the line
 * between *acknowledging the season* — "Eid hours", "Ramadan offers", the
 * register a shop sign uses — and *using the faith*. The retail calendar treats
 * both as commercial seasons, and "Kuwait announces Eid holiday dates" is a
 * fact a retailer plans around. The season names pass; the words of worship
 * below do not, and a headline carrying both is dropped on the second.
 */

/**
 * Arabic sources spell the same word several ways. Normalising the alef and
 * yaa forms is the difference between matching الإسلامية and missing it; the
 * taa marbuta is left alone because ة and ه are genuinely different letters.
 */
const normalise = (s) =>
  String(s ?? '')
    .replace(/[أإآٱ]/g, 'ا')  // أ إ آ ٱ -> ا
    .replace(/ى/g, 'ي')                       // ى -> ي
    .replace(/[ً-ْٰ]/g, '')              // harakat and dagger alef

/** Politics: office, contest, statecraft, and armed conflict. */
const POLITICS_EN =
  /\b(politic\w*|government|governmental|minister\w*|ministry|parliament\w*|cabinet|election\w*|electoral|referendum|ballot|candidate|president\w*|prime minister|emir|amiri|crown prince|national assembly|legislat\w*|senate|congress|diplomat\w*|embassy|ambassador|sanction\w*|tariff\w*|treaty|summit|regime|coup|protest\w*|demonstrat\w*|riot\w*|uprising|militar\w*|army|troops|soldier\w*|missile\w*|airstrike\w*|air strike|drone strike|war|warfare|wartime|ceasefire|truce|hostage\w*|terror\w*|militant\w*|insurgen\w*|occupation|blockade|espionage|deportation|white house|kremlin|downing street|immigration|asylum|refugee\w*|deport\w*|visa policy|border policy|work permits?|residency permits?|iqama|green card|citizenship|naturalisation|naturalization|geopolitic\w*|statecraft|bilateral|counterpart|envoy|state visit|foreign ministry|defen[cs]e (?:pact|deal|agreement|ministry)|security pact|regional developments|phone call|phone talks|strikes? on)\b|\b(?:post|pre|inter|anti)[- ]?war\b|\bFM\b|\b(?:trump|netanyahu|bibi|putin|zelensk\w*|biden|khamenei|erdogan|modi)\b/i

/** Religion: worship, scripture, clergy, observance, and the language of faith. */
const RELIGION_EN =
  /\b(religio\w*|islam\w*|muslim\w*|christian\w*|jewish|judaism|hindu\w*|buddhis\w*|mosque\w*|masjid|church\w*|cathedral|synagogue|temple|quran|qur'an|koran|hadith|bible|biblical|gospel|torah|sermon|preach\w*|imam\w*|sheikh|cleric\w*|priest\w*|bishop|pastor|rabbi|fatwa|sharia|halal|haram|prayer\w*|praying|worship\w*|pilgrim\w*|hajj|umrah|ashura|mawlid|allah|holy|sacred|blessed|blessing|faith|pious|piety|salvation|martyr\w*)\b/i

/**
 * Arabic stems, matched as substrings on normalised text — see the note above
 * about prefixes. Ordered roughly by how often they actually appear in this
 * feed rather than alphabetically, because the first match wins and the common
 * ones should not be reached last.
 */
const POLITICS_AR = [
  'سياس', 'حكوم', 'حكام', 'وزير', 'وزار', 'برلمان', 'مجلس الامه', 'مجلس الامة',
  'انتخاب', 'استفتاء', 'مرشح', 'الرئيس', 'رئيس الوزراء', 'ولي العهد', 'امير البلاد',
  'سفاره', 'سفارة', 'دبلوماسي', 'عقوبات', 'رسوم جمركيه', 'رسوم جمركية', 'تعريفه جمركيه',
  'معاهده', 'معاهدة', 'قمه سياسيه', 'نظام الحكم', 'معارضه سياسيه',
  'حرب', 'حروب', 'عسكري', 'عسكريه', 'جيش', 'جنود', 'قصف', 'غاره جويه', 'غارة جوية',
  'صاروخ', 'صواريخ', 'مسير', 'هدنه', 'هدنة', 'وقف اطلاق النار', 'رهائن', 'رهينه',
  'ارهاب', 'مسلحين', 'مليشيا', 'ميليشيا', 'احتلال', 'حصار', 'انقلاب',
  'احتجاج', 'مظاهر', 'اعتصام', 'العدو', 'تجسس', 'ترحيل', 'هجره', 'هجرة', 'لجوء', 'لاجئ',
]

const RELIGION_AR = [
  'اسلام', 'مسلم', 'مسيحي', 'يهود', 'هندوس', 'بوذي', 'ديني', 'دينيه', 'دينية',
  'مسجد', 'مساجد', 'جامع الكبير', 'كنيسه', 'كنيسة', 'كنائس', 'معبد',
  'قران الكريم', 'القران', 'حديث شريف', 'انجيل', 'توراه', 'توراة',
  'امام المسجد', 'شيخ', 'مشايخ', 'مفتي', 'فتوي', 'شريعه', 'شريعة', 'رجل دين',
  'صلاه', 'صلاة', 'الصلوات', 'عباده', 'عبادة', 'دعاء', 'خطبه', 'خطبة',
  'الحج', 'عمره دينيه', 'مناسك', 'عاشوراء', 'المولد النبوي',
  'حلال', 'حرام', 'مقدس', 'شهيد', 'شهداء', 'الايمان', 'تقوي',
]

const hasStem = (text, stems) => stems.some((w) => text.includes(normalise(w)))

/**
 * Whether a headline may be shown to somebody looking for a marketing hook.
 * Returns the reason it may not, or null when it is fine — the reason travels
 * so the screen can say what kind of thing it left out rather than just a count.
 */
export function notForMarketing(text) {
  const raw = String(text ?? '')
  const norm = normalise(raw)
  if (POLITICS_EN.test(raw) || hasStem(norm, POLITICS_AR)) return 'political'
  if (RELIGION_EN.test(raw) || hasStem(norm, RELIGION_AR)) return 'religious'
  return null
}

/**
 * Split a list into what may be shown and a tally of what was not.
 *
 * `text` pulls the strings to judge out of one item — a trend is its search
 * term plus the headlines beside it, and either half can carry the topic.
 *
 * Nothing is dropped silently. A feed that shows four of twelve and says
 * nothing has quietly changed what "trending" means, and the person reading it
 * cannot tell. The count and its reasons come back so the screen can say so.
 */
export function screen(items, text) {
  const kept = []
  const dropped = { political: 0, religious: 0 }
  for (const item of items) {
    const why = notForMarketing(text(item))
    if (why) dropped[why]++
    else kept.push(item)
  }
  return { kept, dropped, total: dropped.political + dropped.religious }
}
