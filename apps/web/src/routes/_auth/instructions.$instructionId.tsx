import { createFileRoute } from "@tanstack/react-router";

import { InstructionPage } from "@/features/studio/instruction-page";

export const Route = createFileRoute("/_auth/instructions/$instructionId")({
  head: () => ({ meta: [{ title: "Instruction · zetta" }] }),
  component: RouteComponent,
});

function RouteComponent() {
  const { instructionId } = Route.useParams();
  return <InstructionPage id={instructionId} />;
}
