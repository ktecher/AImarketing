# Fonts

Font files are not committed. Download them here.

## Open licence options — all SIL OFL 1.1

Free for commercial use, embeddable, modifiable with a rename. The only real
constraint is that the font cannot be sold on its own.

| Family | Use |
|---|---|
| Cairo | Headlines, brand voice. Geometric, pairs naturally with Latin sans |
| IBM Plex Sans Arabic | Headlines. Corporate, 8 styles, excellent Latin companion |
| Tajawal | Body. Low contrast, 7 weights |
| Almarai | Body. Modern, 4 weights |
| Noto Naskh Arabic | Fallback. The no-tofu guarantee |

**Self-host the files.** Do not link Google Fonts from a stylesheet — that is an
outbound request and it breaks the offline requirement.

**Check the Arabic axis.** Some families ship fewer Arabic weights than Latin, so
confirm the weights you need actually exist in Arabic before designing around them.

## The brand font

If the brand book specifies a commercial Arabic face (29LT, Boutros, GE SS, or
similar), that font wins over anything above — rendering the catalogue in Noto
when the brand book says otherwise is the first thing a marketing manager notices.

Two licence questions to ask, not one:

1. Does the licence permit **embedding**?
2. Does it permit **converting glyphs to outlines**?

These are separately granted. Outlining is the likely default path for Arabic
here (see `docs/decisions.md` D14), so the second question is not optional.

Record the answer in this file when it arrives.
