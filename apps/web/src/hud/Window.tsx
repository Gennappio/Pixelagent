import type { ReactNode } from "react";
import { useUiStore } from "../state/uiStore";
import type { PanelId } from "./panels";
import { PixelIcon } from "./PixelIcon";

interface WindowProps {
  id: PanelId;
  title: string;
  hotkey: string;
  className?: string;
  children: ReactNode;
}

/**
 * A window laid on the office: a pixel-art frame, a title, and a way to close it. Closed,
 * it is not there at all: it comes back from its icon on the bar, or from its key.
 */
export function Window({ id, title, hotkey, className = "", children }: WindowProps) {
  const open = useUiStore((state) => state.panels[id]);
  const toggle = useUiStore((state) => state.toggle);
  if (!open) return null;
  return (
    <section className={`window ${className}`} aria-label={title}>
      <header className="window-title">
        <span>{title}</span>
        <kbd>{hotkey}</kbd>
        <button type="button" className="icon" title={`Close ${title} (${hotkey})`} aria-label={`Close ${title}`} onClick={() => toggle(id)}>
          <PixelIcon name="close" />
        </button>
      </header>
      <div className="window-body">{children}</div>
    </section>
  );
}

interface SectionProps {
  id: PanelId;
  title: string;
  /** Controls shown at the right of the heading. */
  actions?: ReactNode;
  children: ReactNode;
}

/** A group inside a window that folds away under its heading. */
export function Section({ id, title, actions, children }: SectionProps) {
  const open = useUiStore((state) => state.panels[id]);
  const toggle = useUiStore((state) => state.toggle);
  return (
    <section className="section">
      <h3>
        <button type="button" className="section-toggle" aria-expanded={open} onClick={() => toggle(id)}>
          <PixelIcon name={open ? "open" : "closed"} />
          {title}
        </button>
        {open && actions}
      </h3>
      {open && children}
    </section>
  );
}
