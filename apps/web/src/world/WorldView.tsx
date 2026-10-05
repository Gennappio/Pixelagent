import { useEffect, useRef } from "react";
import { replay } from "../state/replayStore";
import { useUiStore } from "../state/uiStore";
import { PixelWorld } from "./PixelWorld";

export function WorldView() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const select = useUiStore.getState().select;
    const world = new PixelWorld(host.current!, replay, {
      onAgentClick: (agentId) => select({ kind: "agent", agentId }),
      onBubbleClick: (eventId) => select({ kind: "event", eventId }),
      onStationClick: (tool) => select({ kind: "tool", tool }),
    });
    return () => world.destroy();
  }, []);

  return <div className="world-host" ref={host} />;
}
