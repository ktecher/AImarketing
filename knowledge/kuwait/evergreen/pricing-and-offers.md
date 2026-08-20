# Pricing conventions

## The dinar is three decimals

The Kuwaiti dinar divides into 1000 fils. Prices carry **three decimal places**, not two.

```
119.500 KD    correct
119.50 KD     wrong — reads as an error to any Kuwaiti customer
119.5 KD      wrong
```

This is enforced in code, not in a prompt. One formatter, one assertion test, and the model never emits a price at all — see `CLAUDE.md`.

Both `KD` and `KWD` appear in retail use. Pick one per brand and hold it.

## Numerals

Arabic-language material may use either Western Arabic numerals (1234) or Eastern Arabic-Indic numerals (١٢٣٤). Kuwaiti retail overwhelmingly uses Western numerals even in otherwise Arabic copy. The template manifest carries `numerals: latn | arab` per slot so this is a design choice rather than an accident.

**A price inside an Arabic text run is a bidi hazard.** Numbers are bidi-neutral and will reorder incorrectly next to Arabic. Wrap numeric runs in isolate characters (U+2068 / U+2069). See `docs/architecture.md`.

## Common offer structures

- Straight percentage off
- Was/now price pairs — the strongest performer in electronics
- Bundles: device plus accessory at a combined price
- Instalment framing, which is widespread in Gulf electronics retail
- Trade-in against a new purchase

## Claims to avoid

Unsubstantiable superlatives — "best price in Kuwait", "the lowest anywhere" — are a compliance risk, not a style preference. The advisor treats them as a **blocker**, not advice. Comparative claims against a named competitor carry the same problem.

Any price, spec, or availability claim must be traceable to a catalog row.
