# Demo script

Ten minutes, for management. The goal is a decision, not applause.

Two rules that shape everything below. **Open with the number**, because a technology demo without a baseline is a toy and a business case with one is a budget line. And **close with the wifi off**, because data locality is the thing this system has that nothing purchasable does.

---

## Before the room

Run these the morning of. They are the three failure modes that have actually bitten.

- `ollama ps` — models loaded and **warm**. `OLLAMA_KEEP_ALIVE=-1` is set. A cold reload is a 20–60 second dead pause with everyone watching.
- `brew services list` — Postgres running.
- Render the demo batch once, end to end, and look at every output. Not a spot check.
- Close Chrome tabs, Slack, anything holding memory. The resident budget is 12–15 GB and screen sharing takes its share.
- Have the finished ZIP from a previous run on the desktop. If a live render fails, you open that instead of debugging in front of management. Say "here's one I ran this morning" and move on.

---

## The ten minutes

### 1. The number (1 min)

Before touching the screen:

> "Producing fifty product posts takes [N] days today. Here's the same fifty."

If the baseline was never measured, this line does not work and the demo becomes a tech demo. Measure it first — it is one phone call, and it stops being measurable once the manual process stops.

### 2. Excel to fifty designs (3 min)

Upload the real sheet. Show the **diff preview** — *14 prices changed, 3 new, 2 gone* — because that is what makes it a weekly pipeline rather than a one-time import, and it is the moment someone realises this survives contact with a real catalog.

Run the batch. Open the ZIP. Scroll the grid.

Then show the **overflow report**: *"12 of 200 needed attention, here they are."* This is counter-intuitive and it is the most credible thing in the demo — a system that tells you where it struggled is a system you can trust with the other 188. A demo that claims 200 perfect designs invites someone to find the broken one.

Open one SVG in the browser with Arabic on it. The Arabic is correct, from their Excel, with no model involved.

**Do not claim** the designer can retype Arabic in Illustrator. Say what is true: English copy is editable in place, Arabic is regenerated from the source, and the source is where it should be edited anyway.

### 3. Ask it something (2 min)

Open the widget. Ask a real question — price, then a spec comparison between two products they actually stock.

Then ask something the catalog does not contain. **It escalates instead of guessing.** Pause on this. Every chatbot they have ever seen makes something up, and refusing is the feature.

Take over the conversation from the inbox. The customer's view does not change.

### 4. Review a draft (2 min)

Paste a caption the marketing team actually wrote. Show the five most similar past posts with their real numbers.

Then paste one with a wrong price in it and let the blocker fire: *your caption says 129 KD, the catalog says 119.500 as of yesterday.*

That single check is the sharpest thing in the system. No other tool on earth can say it about this company's post.

If someone asks "does it predict how well a post will do" — the answer is no, and say it plainly. It checks. It does not forecast. That answer is what makes everything else believable.

### 5. The loop (1 min)

One screen: campaign → assets produced → conversations about those products → leads attributed back.

Then the return leg, which is the part nobody expects: **the questions the bot could not answer.** That list tells marketing exactly what the catalog is missing. It is the cheapest query in the system and the most useful output.

### 6. Turn off the wifi (1 min)

Physically. In front of them. Then run a generation and a chat.

> "Nothing here has ever left this machine. Not the catalog, not a customer message, not an unpublished campaign. There is no per-token bill and no vendor."

Then the argument that lands hardest with anyone who has thought about it:

> "Your unpublished drafts are commercial strategy — pricing, launch timing, positioning. This reviews them without sending them anywhere."

---

## Questions that will come, and honest answers

**"Can it write Arabic?"** — It renders Arabic perfectly from your data, today. It does not yet *write* Arabic copy, because no local model writes convincing Kuwaiti dialect and I would rather show you that gap than paper over it. Copy that reads translated is worse than copy in English.

**"Does it know what's trending right now?"** — No, and nothing that runs offline can. It knows the retail calendar, how prices are written here, which channels matter, and how a hook has to work — the parts that are stable for months. This week's specifics get typed in by the team, who already know them.

**"How accurate is the chatbot?"** — Every price and spec comes from a SQL query, not from the model. The model only phrases the answer. One invented price would be a failed test.

**"What does it cost to run?"** — Zero. No API bill, no subscription.

**"When can the team use it?"** — Name the one pillar that is actually finished. Do not promise four.

---

## If something breaks

Open the pre-rendered ZIP. "Here's this morning's run." Keep going.

Do not debug live. Do not apologise twice. The demo is about whether this is worth funding, not whether the laptop is having a good day.
