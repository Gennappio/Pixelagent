import { removeAgent, updateAgent } from "../build/workflowEdits";
import { relationsOf } from "../protocol/relations";
import type { Agent, RouterRule } from "../protocol/workflow";
import { useUiStore } from "../state/uiStore";
import { useWorkflowStore } from "../state/workflowStore";
import { SPRITES } from "../world/sprites";
import { RelationEditor } from "./RelationEditor";

// What can decide for an agent. Only what needs no API key exists until a real provider
// is wired in (AGENTS.md §38, Phase 12).
const MODELS = [
  { provider: "fake", name: "scripted-v1", label: "Scripted (no API key)", about: "Uses each of its tools once, then says what is scripted below." },
  { provider: "rule", name: "router", label: "Rule: router", about: "Hands the sheet on unchanged, to whoever its rules name." },
  { provider: "rule", name: "splitter", label: "Rule: splitter", about: "Writes one sheet per line of what it is given, on each table it writes on." },
  { provider: "rule", name: "collector", label: "Rule: collector", about: "Waits for the office to go quiet, then takes its whole pile and passes it on as one sheet." },
];

function RouterRules({ agent, change }: { agent: Agent; change: (patch: Partial<Omit<Agent, "id">>) => void }) {
  const workflow = useWorkflowStore((state) => state.workflow);
  const rules = agent.model.rules ?? [];
  // A router can only hand to agents it has an "if it chooses" hand-off to.
  const targets = relationsOf(workflow, agent.id, "sends_to")
    .filter((relation) => relation.required === false && relation.object)
    .map((relation) => workflow.agents.find((candidate) => candidate.id === relation.object))
    .filter((candidate): candidate is Agent => candidate !== undefined);
  const setRules = (next: RouterRule[]) => change({ model: { ...agent.model, rules: next } });

  return (
    <fieldset>
      <legend>Rules</legend>
      {targets.length === 0 && <p className="muted">Give it “hands a sheet to … if it chooses” for each agent it can route to.</p>}
      {rules.map((rule, index) => (
        <div key={index} className="rule">
          <span className="muted">if it says</span>
          <input
            aria-label="Text to look for"
            value={rule.contains}
            onChange={(event) => setRules(rules.map((other, at) => (at === index ? { ...other, contains: event.target.value } : other)))}
          />
          <span className="muted">→</span>
          <select aria-label="Hand it to" value={rule.to} onChange={(event) => setRules(rules.map((other, at) => (at === index ? { ...other, to: event.target.value } : other)))}>
            {!targets.some((candidate) => candidate.id === rule.to) && <option value={rule.to}>{rule.to || "?"}</option>}
            {targets.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
          <button type="button" className="icon" title="Remove this rule" onClick={() => setRules(rules.filter((_, at) => at !== index))}>
            ✕
          </button>
        </div>
      ))}
      <button type="button" disabled={targets.length === 0} onClick={() => setRules([...rules, { contains: "", to: targets[0]?.id ?? "" }])}>
        Add a rule
      </button>
      <label>
        Otherwise
        <select value={agent.model.otherwise ?? ""} onChange={(event) => change({ model: { ...agent.model, otherwise: event.target.value || undefined } })}>
          <option value="">the first it can hand to</option>
          {targets.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  );
}

export function AgentConfigForm({ agent }: { agent: Agent }) {
  const edit = useWorkflowStore((state) => state.edit);
  const select = useUiStore((state) => state.select);
  const change = (patch: Partial<Omit<Agent, "id">>) => edit((workflow) => updateAgent(workflow, agent.id, patch));
  const model = MODELS.find((candidate) => candidate.provider === agent.model.provider && candidate.name === agent.model.name);

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

      <RelationEditor agent={agent} />

      <label>
        Who decides
        <select
          value={`${agent.model.provider}/${agent.model.name}`}
          onChange={(event) => {
            const [provider, name] = event.target.value.split("/");
            change({ model: { ...agent.model, provider, name } });
          }}
        >
          {!model && <option value={`${agent.model.provider}/${agent.model.name}`}>{`${agent.model.provider} / ${agent.model.name}`}</option>}
          {MODELS.map((candidate) => (
            <option key={candidate.name} value={`${candidate.provider}/${candidate.name}`}>
              {candidate.label}
            </option>
          ))}
        </select>
        {model && <small>{model.about}</small>}
      </label>
      {agent.model.provider === "fake" && (
        <>
          <label>
            System prompt
            <textarea rows={3} value={agent.systemPrompt} onChange={(event) => change({ systemPrompt: event.target.value })} />
          </label>
          <label>
            Scripted message
            <textarea
              rows={2}
              placeholder="Default: its last tool result, or what it was given"
              value={agent.model.script?.message ?? ""}
              onChange={(event) => {
                const { message: _old, ...rest } = agent.model.script ?? {};
                const script = event.target.value ? { ...rest, message: event.target.value } : rest;
                change({ model: { ...agent.model, script: Object.keys(script).length > 0 ? script : undefined } });
              }}
            />
            <small>
              What it says, hands on and writes down. <code>{"{input}"}</code> and <code>{"{result}"}</code> are filled in.
            </small>
          </label>
        </>
      )}
      {agent.model.provider === "rule" && agent.model.name === "router" && <RouterRules agent={agent} change={change} />}

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
      <div className="button-row">
        <button type="button"
          className="danger"
          onClick={() => {
            if (!confirm(`Remove ${agent.name} from the office, with everything it does?`)) return;
            edit((workflow) => removeAgent(workflow, agent.id));
            select(null);
          }}
        >
          Remove {agent.name}
        </button>
      </div>
      <small className="muted">id: {agent.id}</small>
    </form>
  );
}
