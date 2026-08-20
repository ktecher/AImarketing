import { Stub } from '@/components/Stub'

export default function Page() {
  return (
    <Stub
      title="Sales inbox"
      sub="Leads the assistant could not close on its own."
      does={["A conversation the assistant flagged, with the full transcript", "Take over the chat directly from here", "Which campaign produced the lead"]}
      blockedBy={["The sales assistant"]}
      ready={["Message provenance is designed in: every reply records what it retrieved and which model produced it"]}
    />
  )
}
