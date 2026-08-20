# Fonts

## What is committed, and what is not

Cairo and Tajawal **are** committed, with their `OFL-*.txt` beside them. Both are
SIL OFL 1.1, which permits redistribution as long as the licence travels with the
font — so a clone of this repo renders without a download step. Tajawal's licence
is also stated inside the font file itself: *"This Font Software is licensed under
the SIL Open Font License, Version 1.1"*, © 2017 Boutros International.

**Noto Naskh Arabic is NOT committed.** It is OFL 1.1 like the others, but no copy
of its licence is on this machine and the font file carries no licence string to
verify against. Redistributing an OFL font without its licence is the one thing
the licence actually forbids. Nothing binds Noto today — every template slot uses
Cairo — so a clone is complete without it. To add it, download the family and its
`OFL.txt` together, drop both here, and add two `!data/fonts/…` lines to
`.gitignore`.

`.gitignore` excludes this folder by default and re-includes those files **by
name**. That is deliberate: a brand face dropped in here stays out of git until
somebody has checked its licence, which is the answer to the two questions below.

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
