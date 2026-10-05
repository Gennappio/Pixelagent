import type { ReactNode } from "react";
import { useUiStore } from "../state/uiStore";
import type { PanelId } from "./panels";

interface PanelProps {
  id: PanelId;
  title: string;
  hotkey: string;
  className?: string;
  children: ReactNode;
}

/** A floating HUD panel. Collapsed, it shrinks to a tab that brings it back. */
export function Panel({ id, title, hotkey, className = "", children }: PanelProps) {
  const open = useUiStore((state) => state.panels[id]);
  const toggle = useUiStore((state) => state.toggle);

  if (!open) {
    return (
      <button className={`panel-tab ${className}`} title={`Show ${title} (${hotkey})`} onClick={() => toggle(id)}>
        {title} <kbd>{hotkey}</kbd>
      </button>
    );
  }
  return (
    <section className={`panel ${className}`} aria-label={title}>
      <header className="panel-header">
        <span>{title}</span>
        <kbd>{hotkey}</kbd>
        <button
          className="icon"
          title={`Hide ${title} (${hotkey})`}
          aria-label={`Hide ${title}`}
          onClick={() => toggle(id)}
        >
          –
        </button>
      </header>
      <div className="panel-body">{children}</div>
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

/** A collapsible group inside a panel. */
export function Section({ id, title, actions, children }: SectionProps) {
  const open = useUiStore((state) => state.panels[id]);
  const toggle = useUiStore((state) => state.toggle);
  return (
    <section className="section">
      <h3>
        <button className="section-toggle" aria-expanded={open} onClick={() => toggle(id)}>
          <span className="chevron">{open ? "▾" : "▸"}</span>
          {title}
        </button>
        {open && actions}
      </h3>
      {open && children}
    </section>
  );
}
