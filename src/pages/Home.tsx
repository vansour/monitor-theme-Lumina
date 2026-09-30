import { HomeOverview } from "@/components/node/HomeOverview";
import { NodeGrid } from "@/components/node/NodeGrid";

export function Home() {
  return (
    <div className="flex flex-col gap-4 py-2 xl:gap-5">
      <HomeOverview />
      <NodeGrid />
    </div>
  );
}
