import { scriptedSheet, setLine, setLineFor, setLinePerRecipient, setSheet, setSheetMode, sheetMode, type SheetMode } from "../build/scriptEdits";
import { removeAgent, updateAgent } from "../build/workflowEdits";
import { relationsOf } from "../protocol/relations";
import type { Agent, AgentScript, RouterRule } from "../protocol/workflow";
import { useUiStore } from "../state/uiStore";
import { useWorkflowStore } from "../state/workflowStore";
import { SPRITES } from "../world/sprites";
import { RelationEditor } from "./RelationEditor";

// What can decide for an agent. Only what needs no API key exists until a real provider
// is wired in (AGENTS.md §38, Phase 15).
const MODELS = [
  { provider: "fake", name: "scripted-v1", label: "Scripted (no API key)", about: "Uses each tool it can use once, then writes and says what is scripted below." },
  { provider: "rule", name: "router", label: "Rule: router", about: "Hands the sheet on as it is, saying nothing, to whoever its rules name." },
  { provider: "rule", name: "splitter", label: "Rule: splitter", about: "Writes one sheet per line of the sheet it holds, on each table it writes on." },
  { provider: "rule", name: "collector", label: "Rule: collector", about: "Waits for the office to go quiet, then takes its whole pile and writes it all on one sheet." },
];

const SHEET_MODES: { mode: SheetMode; label: string }[] = [
  { mode: "default", label: "what its last tool returned, or the sheet it holds" },
  { mode: "sheet", label: "a sheet of its own" },
  { mode: "none", label: "nothing: it only talks" },
];

/** What a scripted agent says and writes: the two halves of a hand-off, kept apart. */
function ScriptFields({ agent, change }: { agent: Agent; change: (patch: Partial<Omit<Agent, "id">>) => void }) {
  const workflow = useWorkflowStore((state) => state.workflow);
  const script = agent.model.script;
  const setScript = (next: AgentScript | undefined) => change({ model: { ...agent.model, script: next } });
  const recipients = relationsOf(workflow, agent.id, "sends_to")
    .map((relation) => workflow.agents.find((candidate) => candidate.id === relation.object))
    .filter((candidate): candidate is Agent => candidate !== undefined);
  const each = typeof script?.says === "object";
  const mode = sheetMode(script);
  const sheet = scriptedSheet(script);

  return (
    <fieldset className="script">
      <legend>Script</legend>
      {each ? (
        recipients.map((recipient) => (
          <label key={recipient.id}>
            Says to {recipient.name}
            <input
              value={(script?.says as Record<string, string>)[recipient.id] ?? ""}
              placeholder="Nothing: the sheet speaks for itself"
              onChange={(event) => setScript(setLineFor(script, recipient.id, event.target.value))}
            />
          </label>
        ))
      ) : (
        <label>
          Says
          <input
            value={typeof script?.says === "string" ? script.says : ""}
            placeholder={recipients.length === 0 ? "It hands to nobody yet" : "Nothing: the sheet speaks for itself"}
            onChange={(event) => setScript(setLine(script, event.target.value))}
          />
        </label>
      )}
      {(each || recipients.length > 1) && (
        <button type="button" className="link" onClick={() => setScript(setLinePerRecipient(script, !each, recipients.map((recipient) => recipient.id)))}>
          {each ? "one line for everyone" : "a line for each of them"}
        </button>
      )}
      <label>
        Writes
        <select aria-label="What it writes" value={mode} onChange={(event) => setScript(setSheetMode(script, event.target.value as SheetMode))}>
          {SHEET_MODES.map((candidate) => (
            <option key={candidate.mode} value={candidate.mode}>
              {candidate.label}
            </option>
          ))}
        </select>
      </label>
      {mode === "sheet" && (
        <>
          <label>
            Sheet title
            <input value={sheet.title} placeholder="Default: its first line" onChange={(event) => setScript(setSheet(script, { title: event.target.value }))} />
            <small>Under the title of a sheet it holds, it writes a new version of that sheet.</small>
          </label>
          <label>
            Sheet content
            <textarea rows={2} value={sheet.content} onChange={(event) => setScript(setSheet(script, { content: event.target.value }))} />
          </label>
        </>
      )}
      <small>
        <code>{"{input}"}</code> is everything that arrived, <code>{"{sheet}"}</code> the sheets it holds, <code>{"{result}"}</code> what its last tool returned.
      </small>
    </fieldset>
  );
}

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
      {targets.length === 0 && <p className="muted">Give it “hands to …”, set to “if it chooses”, for each agent it can route to.</p>}
      {rules.map((rule, index) => (
        <div key={index} className="rule">
          <span className="muted">if the sheet says</span>
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
  const workflow = useWorkflowStore((state) => state.workflow);
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

      <RelationEditor workflow={workflow} agent={agent} editable />

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
          <ScriptFields agent={agent} change={change} />
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
