# timely/

Anything here has a shelf life. Every file carries `last_verified` in frontmatter and every rule carries its own source URL.

**This date is displayed in the UI** beside generated copy — *"Kuwait context as of 2026-08-18"* — so freshness is a visible parameter rather than a hidden assumption.

## The three layers

| Layer | Shelf life | Where it lives |
|---|---|---|
| Viral specifics — sounds, memes, formats | **3–14 days** | Not here. A human types it into the campaign's "this week's context" field |
| Seasonal and cultural | Months, predictable | `evergreen/retail-calendar.md` — a calendar, not a trend |
| Structural — hook mechanics, format conventions | **6–18 months** | Here |

A monthly refresh is useless for the first layer and unnecessary for the third. **Scope every claim made to the user to the structural layer.**

## Rules

- One source URL per rule. No exceptions, no folklore.
- Never fine-tune anything from this directory into model weights. It is the fastest-decaying knowledge in the system, and retrieval makes a stale entry visible where weights make it invisible.
- Retrieved through the same path as the product catalog, so the advisor cites a trend fact the way it cites a price.
- If a rule cannot be traced to a primary source, it does not go in. Most published platform-mechanics content is unverifiable — see `../SOURCES.md`.

## Refresh

`scripts/refresh-kuwait-knowledge.ts`, run by a human, reviewed by a human, merged deliberately. Not by the app, and never at runtime — the runtime makes no outbound requests.
