import { toggleAgentTool, updateAgent } from "../graph/workflowEdits";
import type { Agent } from "../protocol/workflow";
import { toolLabel } from "../protocol/workflow";
import { useWorkflowStore } from "../state/workflowStore";
import { SPRITES } from "../world/sprites";

// Only the deterministic fake model exists until a real provider is wired in (Phase 7).
const MODELS = [{ provider: "fake", name: "scripted-v1", label: "Fake · scripted-v1 (no API key)" }];

export function AgentConfigForm({ agent }: { agent: Agent }) {
  const edit = useWorkflowStore((state) => state.edit);
  const tools = useWorkflowStore((state) => state.tools);
  const change = (patch: Parameters<typeof updateAgent>[2]) => edit((workflow) => updateAgent(workflow, agent.id, patch));

  return (
    <form className="form" onSubmit={(event) => event.preventDefault()}>
      <label>
        Name
        <input value={agent.name} onChange={(event) => change({ name: event.target.value })} />
      </label>
      <label>
        Role
        <input value={agent.role} onChange={(event) => change({ role: event.target.value })} />
      </label>
      <label>
        System prompt
        <textarea rows={4} value={agent.systemPrompt} onChange={(event) => change({ systemPrompt: event.target.value })} />
      </label>
      <label>
        Model
        <select
          value={`${agent.model.provider}/${agent.model.name}`}
          onChange={(event) => {
            const [provider, name] = event.target.value.split("/");
            change({ model: { ...agent.model, provider, name } });
          }}
        >
          {MODELS.map((model) => (
            <option key={model.name} value={`${model.provider}/${model.name}`}>
              {model.label}
            </option>
          ))}
        </select>
      </label>
      {agent.model.provider === "fake" && (
        <label>
          Scripted message
          <textarea
            rows={2}
            placeholder="Default: pass on the tool result, or the incoming message"
            value={agent.model.script?.message ?? ""}
            onChange={(event) =>
              change({ model: { ...agent.model, script: event.target.value ? { message: event.target.value } : undefined } })
            }
          />
          <small>
            What the fake model says to the next agent. <code>{"{input}"}</code> and <code>{"{result}"}</code> are filled in.
          </small>
        </label>
      )}
      <fieldset>
        <legend>Tools</legend>
        {tools.map((tool) => (
          <label key={tool.name} className="checkbox" title={tool.description}>
            <input
              type="checkbox"
              checked={agent.tools.some((reference) => reference.name === tool.name)}
              onChange={() => edit((workflow) => toggleAgentTool(workflow, agent.id, tool.name))}
            />
            {toolLabel(tool.name)}
          </label>
        ))}
      </fieldset>
      <label>
        Sprite
        <select value={agent.appearance.sprite} onChange={(event) => change({ appearance: { sprite: event.target.value } })}>
          {Object.entries(SPRITES).map(([id, sprite]) => (
            <option key={id} value={id}>
              {sprite.label}
            </option>
          ))}
        </select>
      </label>
      <small className="muted">id: {agent.id}</small>
    </form>
  );
}
