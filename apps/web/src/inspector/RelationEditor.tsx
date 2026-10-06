import { hasTargets, pickTargets, type PendingSentence } from "../build/picking";
import { PixelIcon } from "../hud/PixelIcon";
import { addRelation, canRelate, moveRelation, removeRelation, updateRelation } from "../build/workflowEdits";
import {
  canConsultFirst,
  closesCycle,
  CONSULTS_FIRST,
  handedBy,
  isChoice,
  isRequired,
  objectName,
  phraseOf,
  phrasesIn,
  sentence,
  slotOf,
  SLOTS,
  verbInfo,
  type Phrase,
  type Slot,
} from "../protocol/relations";
import { toolLabel, type Agent, type Relation, type Workflow } from "../protocol/workflow";
import { useUiStore } from "../state/uiStore";
import { useWorkflowStore } from "../state/workflowStore";

interface Props {
  /** The workflow being built, or the one a run executed. */
  workflow: Workflow;
  agent: Agent;
  /** Build mode. Otherwise the sentences are only shown: a run is read as it was executed. */
  editable: boolean;
}

/** Why a phrase cannot be added just now, for whoever hovers its button. */
function whyNot(phrase: Phrase): string {
  const kind = verbInfo(phrase.verb).objectKind;
  if (kind === null) return "It already is.";
  if (kind === "agent") return "There is nobody else to choose.";
  if (kind === "table") return phrase.verb === "takes_from_table" ? "No pile to choose: click the floor to add one." : phrase.verb === "reads_table" ? "No shared table to choose: click the floor to add one." : "No table to choose: click the floor to add one.";
  return phrase.required ? "No tool that can be consulted first is left to choose." : "It can already use every tool there is.";
}

function target(workflow: Workflow, relation: Relation): string {
  return verbInfo(relation.verb).objectKind === "tool" ? toolLabel(relation.object ?? "") : objectName(workflow, relation);
}

const EMPTY: Record<Slot, string> = {
  arrives: "Nothing starts its turn yet.",
  consults: "Nothing.",
  goes_out: "Its sheet goes nowhere yet.",
};

/** One sentence of the agent, with what can be changed about it. */
function Sentence({ workflow, relation, editable, first, last }: { workflow: Workflow; relation: Relation; editable: boolean; first: boolean; last: boolean }) {
  const tools = useWorkflowStore((state) => state.tools);
  const edit = useWorkflowStore((state) => state.edit);
  const required = isRequired(relation);
  const isTool = relation.verb === "uses_tool";
  // A tool can be switched to "consults first" only if it can be; one that already is can always be switched back.
  const switchable = isTool && (required || canConsultFirst(tools, relation.object));
  const leftToIt = isChoice(relation.verb) && !isTool;
  const onLoop = closesCycle(workflow, relation);

  if (!editable) {
    return (
      <li className="relation">
        <div className="sentence">
          {phraseOf(relation)} {relation.object && <strong>{target(workflow, relation)}</strong>}
          {leftToIt && !required && <span className="muted"> if it chooses</span>}
          {relation.maxRounds !== undefined && <span className="muted"> · at most {relation.maxRounds} times</span>}
        </div>
      </li>
    );
  }
  return (
    <li className="relation">
      <div className="sentence">
        {switchable ? (
          <select
            className="phrase"
            aria-label="Whether it chooses to use the tool or the tool is consulted first"
            value={required ? "first" : "can"}
            onChange={(event) => edit((current) => updateRelation(current, relation.id, { required: event.target.value === "first" }, tools))}
          >
            <option value="can">{verbInfo("uses_tool").phrase}</option>
            <option value="first">{CONSULTS_FIRST}</option>
          </select>
        ) : (
          phraseOf(relation)
        )}{" "}
        {relation.object && <strong>{target(workflow, relation)}</strong>}
      </div>
      <div className="relation-tools">
        {leftToIt && (
          <select
            aria-label="Whether it always happens or is left to the agent"
            title="Always: it happens every turn. If it chooses: left to the agent, turn by turn."
            value={required ? "always" : "choice"}
            onChange={(event) => edit((current) => updateRelation(current, relation.id, { required: event.target.value === "always" }))}
          >
            <option value="always">always</option>
            <option value="choice">if it chooses</option>
          </select>
        )}
        {onLoop && (
          <label className="rounds" title="This hand-off is on a loop: how many times it may happen in one run">
            at most
            <input
              type="number"
              min={1}
              placeholder="5"
              value={relation.maxRounds ?? ""}
              onChange={(event) => edit((current) => updateRelation(current, relation.id, { maxRounds: event.target.value ? Number(event.target.value) : undefined }))}
            />
            times
          </label>
        )}
        <span className="spacer" />
        <button type="button" className="icon" title="Earlier" disabled={first} onClick={() => edit((current) => moveRelation(current, relation.id, -1))}>
          <PixelIcon name="up" />
        </button>
        <button type="button" className="icon" title="Later" disabled={last} onClick={() => edit((current) => moveRelation(current, relation.id, 1))}>
          <PixelIcon name="down" />
        </button>
        <button type="button" className="icon" title={`Remove: ${sentence(workflow, relation)}`} onClick={() => edit((current) => removeRelation(current, relation.id))}>
          <PixelIcon name="close" />
        </button>
      </div>
    </li>
  );
}

/**
 * What can be added to a slot. A sentence is said in two moves: the verb here, on the
 * character, and then what it applies to, picked in the office. A verb that applies to
 * nothing (being the entry, being the exit) is added at once.
 */
function AddByPicking({ workflow, agent, slot }: { workflow: Workflow; agent: Agent; slot: Slot }) {
  const tools = useWorkflowStore((state) => state.tools);
  const edit = useWorkflowStore((state) => state.edit);
  const startPicking = useUiStore((state) => state.startPicking);

  return (
    <div className="relation-add">
      {phrasesIn(slot).map((phrase) => {
        const alone = verbInfo(phrase.verb).objectKind === null;
        const pending: PendingSentence = { subject: agent.id, verb: phrase.verb, ...(phrase.required ? { required: true } : {}) };
        const possible = alone ? canRelate(workflow, agent.id, phrase.verb) : hasTargets(pickTargets(workflow, pending, tools));
        return (
          <button
            key={phrase.key}
            type="button"
            disabled={!possible}
            title={possible ? (alone ? phrase.meaning : `${phrase.meaning} Then pick it in the office.`) : whyNot(phrase)}
            onClick={() => (alone ? edit((current) => addRelation(current, agent.id, phrase.verb)) : startPicking(pending))}
          >
            + {phrase.phrase}
            {!alone && " …"}
          </button>
        );
      })}
    </div>
  );
}

/**
 * What an agent does, as sentences in its three slots: what arrives, what it consults,
 * where its sheet goes. Editable, this is where a workflow is put together, on the
 * character itself. Within a slot the order of the sentences is the order things happen in.
 */
export function Slots({ workflow, agent, editable }: Props) {
  const select = useUiStore((state) => state.select);
  const openMenu = useUiStore((state) => state.openMenu);
  // The hand-offs others make to this agent are part of what arrives for it, and are theirs to change.
  const incoming = handedBy(workflow, agent.id);

  return (
    <div className="slots">
      {SLOTS.map(({ slot, title, about }) => {
        const own = slotOf(workflow, agent.id, slot);
        const others = slot === "arrives" ? incoming : [];
        return (
          <section key={slot} className="slot" aria-label={title}>
            <h4 title={about}>{title}</h4>
            {own.length === 0 && others.length === 0 && <p className="muted">{EMPTY[slot]}</p>}
            <ol className="list">
              {own.map((relation, index) => (
                <Sentence key={relation.id} workflow={workflow} relation={relation} editable={editable} first={index === 0} last={index === own.length - 1} />
              ))}
              {others.map((relation) => {
                const sender = workflow.agents.find((candidate) => candidate.id === relation.subject);
                return (
                  <li key={relation.id} className="relation incoming" title="Said on the sender: change it there">
                    <div className="sentence">
                      <strong>{sender?.name ?? relation.subject}</strong> {phraseOf(relation)} {agent.name}
                      {!isRequired(relation) && " if it chooses"}
                    </div>
                    {sender && (
                      <button
                        type="button"
                        className="link"
                        // While building, the sender's sentences are on the sender; in a run, in its inspector.
                        onClick={() => (editable ? openMenu({ kind: "agent", agentId: sender.id }) : select({ kind: "agent", agentId: sender.id }))}
                      >
                        go to {sender.name}
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
            {editable && <AddByPicking workflow={workflow} agent={agent} slot={slot} />}
          </section>
        );
      })}
    </div>
  );
}

/** The three slots under a heading, as the inspector shows them for a run: read, not changed. */
export function RelationEditor({ workflow, agent, editable }: Props) {
  return (
    <fieldset className="relations">
      <legend>What {agent.name} does</legend>
      <Slots workflow={workflow} agent={agent} editable={editable} />
    </fieldset>
  );
}
