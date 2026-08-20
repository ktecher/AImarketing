# Channels in Kuwait

## Reach

DataReportal, *Digital 2026: Kuwait* — published November 2025, figures reference October 2025.

| Platform | Reach | % of population |
|---|---|---|
| TikTok | 4.44M | 112.1%* |
| YouTube | 3.31M | 65.6% |
| Instagram | 3.00M | 59.4% |
| Facebook | 2.45M | 48.5% |
| **Snapchat** | **2.43M** | **48.2%** |
| X | 1.42M | 28.1% |
| LinkedIn | 1.30M | 25.8% |

Population 5.05M. Internet penetration 99.0%. Social media identities 4.44M.

**\* These are ad-reach figures, not user counts.** They come from platform ad tools, include duplicate and inactive accounts, and are quoted against total population while measuring adults 18+ — which is why TikTok exceeds 100%. Do not read any row as "this many people in Kuwait use it."

**Use one source consistently.** NapoleonCat reports materially different numbers for the same period, including a Facebook figure exceeding Kuwait's population. DataReportal's methodology notes are more transparent.

## What matters here

**Snapchat at 48% is unusually high by global standards** and culturally significant across the Gulf. It is not a secondary channel in this market. Anything treating Snapchat as an afterthought is wrong for Kuwait.

**WhatsApp is where retail conversations actually happen** — enquiries, negotiation, order confirmation. It is deliberately out of scope for this system because every message would transit Meta, which the data-locality rule forbids. See `docs/decisions.md` D4.

**X is a minority channel** for retail commerce here, used more for announcements, service, and complaints.

## Format conventions

Only what is robust. Anything with a precise-sounding number attached belongs in `timely/` with a source and a date, not here.

- **Watch time and completion rate dominate** ranking on TikTok, Reels, and Spotlight. Consistent across every source and every year.
- **The first ~3 seconds disproportionately determine distribution.** Snapchat's own guidance is stricter — hook within 1–2 seconds, because quick swipes hurt ranking.
- **Vertical, full-screen, sound-independent.** Much viewing is muted, so meaning must survive without audio. On-screen text is not optional.
- **One clear call to action**, and one that is actually possible on that platform.
- Instagram's caption first line sits above the "more" fold.

## A live policy constraint

**As of 31 July 2026, Snapchat no longer recommends wholly AI-generated video on Spotlight.** Content *enhanced or edited* with AI tools remains eligible, with transparency indicators. This is a recommendation-eligibility change, not a posting ban.

On a platform reaching nearly half of Kuwait, this is a commercial issue rather than a footnote, and it is why this system is positioned as assistive throughout — human-shot footage, assisted script, assisted layout. See `docs/decisions.md` D10.
