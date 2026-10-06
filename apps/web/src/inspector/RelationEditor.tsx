import { useState } from "react";
import { addRelation, canRelate, moveRelation, objectChoices, removeRelation, updateRelation } from "../build/workflowEdits";
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
          ↑
        </button>
        <button type="button" className="icon" title="Later" disabled={last} onClick={() => edit((current) => moveRelation(current, relation.id, 1))}>
          ↓
        </button>
        <button type="button" className="icon" title={`Remove: ${sentence(workflow, relation)}`} onClick={() => edit((current) => removeRelation(current, relation.id))}>
          ✕
        </button>
      </div>
    </li>
  );
}

/** What can be added to a slot: a phrase, then what it applies to. */
function AddSentence({ workflow, agent, slot }: { workflow: Workflow; agent: Agent; slot: Slot }) {
  const tools = useWorkflowStore((state) => state.tools);
  const edit = useWorkflowStore((state) => state.edit);
  const phrases = phrasesIn(slot);
  const [key, setKey] = useState(phrases[0].key);
  const [picked, setPicked] = useState("");
  const phrase = phrases.find((candidate) => candidate.key === key) ?? phrases[0];
  const kind = verbInfo(phrase.verb).objectKind;
  const how = { required: phrase.required, tools };
  const choices = objectChoices(workflow, agent.id, phrase.verb, how);
  // The object on offer: what was picked if it is still a choice, else the first one.
  const object = kind === null ? undefined : (choices.find((choice) => choice.id === picked) ?? choices[0])?.id;
  const addable = canRelate(workflow, agent.id, phrase.verb, object, how);

  return (
    <>
      <div className="relation-add">
        <select aria-label={`What to add to what ${SLOTS.find((candidate) => candidate.slot === slot)!.title.toLowerCase()}`} value={phrase.key} onChange={(event) => setKey(event.target.value)}>
          {phrases.map((candidate) => (
            <option key={candidate.key} value={candidate.key}>
              {candidate.phrase}
            </option>
          ))}
        </select>
        {kind !== null && (
          <select aria-label="To whom or what" value={object ?? ""} disabled={choices.length === 0} onChange={(event) => setPicked(event.target.value)}>
            {choices.length === 0 && <option value="">{kind === "table" ? "no table to choose" : `no ${kind} to choose`}</option>}
            {choices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {kind === "tool" ? toolLabel(choice.label) : choice.label}
              </option>
            ))}
          </select>
        )}
        <button type="button" disabled={!addable} onClick={() => edit((current) => addRelation(current, agent.id, phrase.verb, object, how))}>
          Add
        </button>
      </div>
      <small>{phrase.meaning}</small>
    </>
  );
}

/**
 * What an agent does, as sentences in its three slots: what arrives, what it consults,
 * where its sheet goes. This is where a workflow is put together: in each slot pick a
 * phrase, pick what it applies to, add. Within a slot the order of the sentences is the
 * order things happen in.
 */
export function RelationEditor({ workflow, agent, editable }: Props) {
  const select = useUiStore((state) => state.select);
  // The hand-offs others make to this agent are part of what arrives for it, and are theirs to change.
  const incoming = handedBy(workflow, agent.id);

  return (
    <fieldset className="relations">
      <legend>What {agent.name} does</legend>
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
                      <button type="button" className="link" onClick={() => select({ kind: "agent", agentId: sender.id })}>
                        go to {sender.name}
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
            {editable && <AddSentence workflow={workflow} agent={agent} slot={slot} />}
          </section>
        );
      })}
    </fieldset>
  );
}
