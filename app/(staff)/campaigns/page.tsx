import { Stub } from '@/components/Stub'

export default function Page() {
  return (
    <Stub
      title="Campaigns"
      sub="What ties marketing to sales, in both directions."
      does={["Group products into a campaign with its offer and dates", "Carry the campaign through generated assets, conversations, and leads", "Show which products customers actually asked about", "List the questions the assistant could not answer — the most useful output in the system"]}
      blockedBy={["The pillars it connects"]}
      ready={["The campaign identifier is planned into the first migration rather than bolted on later"]}
    />
  )
}
