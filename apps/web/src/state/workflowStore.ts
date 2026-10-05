import { create } from "zustand";
import { api } from "../api/client";
import { deriveAgentTools, emptyWorkflow } from "../graph/workflowEdits";
import type { ToolDescription, Workflow, WorkflowSummary } from "../protocol/workflow";

interface WorkflowState {
  workflow: Workflow;
  workflows: WorkflowSummary[];
  tools: ToolDescription[];
  /** Unsaved changes. */
  dirty: boolean;
  error: string | null;

  init: () => Promise<void>;
  open: (id: string) => Promise<void>;
  /** Persists the workflow and returns the saved version (with its server id). */
  save: () => Promise<Workflow>;
  createNew: () => void;
  importWorkflow: (workflow: Workflow) => void;
  /** Applies a pure edit from graph/workflowEdits. */
  edit: (change: (workflow: Workflow) => Workflow) => void;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  workflow: emptyWorkflow(),
  workflows: [],
  tools: [],
  dirty: false,
  error: null,

  init: async () => {
    try {
      const [tools, workflows] = await Promise.all([api.listTools(), api.listWorkflows()]);
      set({ tools, workflows, error: null });
      if (workflows.length > 0) await get().open(workflows[0].id);
    } catch (error) {
      set({ error: `Cannot reach the server. Is it running? (${message(error)})` });
    }
  },

  open: async (id) => {
    try {
      set({ workflow: await api.getWorkflow(id), dirty: false, error: null });
    } catch (error) {
      set({ error: message(error) });
    }
  },

  save: async () => {
    const current = get().workflow;
    try {
      const saved = current.id ? await api.updateWorkflow(current) : await api.createWorkflow(current);
      set({ workflow: saved, dirty: false, error: null, workflows: await api.listWorkflows() });
      return saved;
    } catch (error) {
      set({ error: message(error) });
      throw error;
    }
  },

  createNew: () => set({ workflow: emptyWorkflow(), dirty: true }),

  importWorkflow: (workflow) => set({ workflow: deriveAgentTools({ ...workflow, id: "" }), dirty: true }),

  edit: (change) => {
    const before = get().workflow;
    const after = change(before);
    if (after !== before) set({ workflow: after, dirty: true });
  },
}));
