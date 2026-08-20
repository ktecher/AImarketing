# Issue tracker: local markdown

Issues and specs for this repo live as markdown files in `.scratch/`. There is no
git remote and no external tracker — which is also the rule the rest of the
project runs on: nothing about this catalogue leaves the machine.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues are one file per ticket at
  `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`, never a
  single combined tickets file
- Triage state is a `Status:` line near the top of each issue file:
  `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`
- Comments and conversation history append to the bottom under `## Comments`

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/`, creating the directory if needed.

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The path or issue number is normally passed
directly.

## `.scratch/` is not committed

It holds working notes about a real catalogue with real prices. It is already in
`.gitignore` alongside `data/state/`, and must stay there if this ever becomes a
git repository.
