import { useEffect, useRef } from "react";
import { replay } from "../state/replayStore";
import { useUiStore } from "../state/uiStore";
import type { Insets } from "./Camera";
import { PixelWorld } from "./PixelWorld";

/** The pixel world, filling its container. `insets` are the edges the HUD panels cover. */
export function WorldView({ insets }: { insets: Insets }) {
  const host = useRef<HTMLDivElement>(null);
  const world = useRef<PixelWorld | null>(null);
  const selection = useUiStore((state) => state.selection);

  useEffect(() => {
    const select = useUiStore.getState().select;
    const instance = new PixelWorld(host.current!, replay, {
      onAgentClick: (agentId) => select({ kind: "agent", agentId }),
      onBubbleClick: (eventId) => select({ kind: "event", eventId }),
      onStationClick: (tool) => select({ kind: "tool", tool }),
      onDocumentClick: (documentId) => select({ kind: "document", documentId }),
      onFloorClick: () => select(null),
    });
    world.current = instance;
    return () => {
      instance.destroy();
      world.current = null;
    };
  }, []);

  const { left, right, top, bottom } = insets;
  useEffect(() => {
    world.current?.setInsets({ left, right, top, bottom });
  }, [left, right, top, bottom]);

  useEffect(() => {
    world.current?.setSelection({
      agentId: selection?.kind === "agent" ? selection.agentId : undefined,
      tool: selection?.kind === "tool" ? selection.tool : undefined,
      documentId: selection?.kind === "document" ? selection.documentId : undefined,
    });
  }, [selection]);

  return <div className="world-host" ref={host} />;
}
