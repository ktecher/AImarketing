import { Stub } from '@/components/Stub'

export default function Page() {
  return (
    <Stub
      title="Sales assistant"
      sub="Answers product questions from the catalogue, then hands the customer to a person."
      does={["Answer price, stock and specification questions from the real rows", "Compare two products using SQL over typed columns, not a model guessing at jsonb", "Escalate rather than guess when the catalogue does not have the answer", "A salesperson takes over the same conversation without the customer noticing"]}
      blockedBy={["The real product sheet, so the specification columns customers ask about can be typed properly"]}
      ready={["Retrieval grounding checks — cited SKUs verified against what was actually retrieved", "Fanar reads Kuwaiti dialect correctly and reports in English"]}
    />
  )
}
