import { Stub } from '@/components/Stub'

export default function Page() {
  return (
    <Stub
      title="Creative advisor"
      sub="Reviews a draft the team wrote \u2014 including work this system did not generate."
      does={["Paste a caption and see the five most similar past posts with their real reach", "Named yes/no checks, each with the exact line that triggered it", "Blocks publishing on a wrong price, an unsubstantiable claim, or a compliance breach", "Never a score, never a prediction — those are not things a local model can honestly give"]}
      blockedBy={["The social export: last 100 posts with captions joined to per-post reach. If captions cannot be exported with the numbers, this pillar changes shape entirely."]}
      ready={["Embeddings running locally — bge-m3, 1024 dimensions, handles Arabic", "Quoted-span verification, so a claimed quote is checked against the real text"]}
    />
  )
}
