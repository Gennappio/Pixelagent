import { useState } from "react";
import { addRelation, canRelate, moveRelation, objectChoices, removeRelation, updateRelation } from "../build/workflowEdits";
import { closesCycle, isRequired, objectName, relationsOf, sentence, verbInfo, VERBS } from "../protocol/relations";
import { toolLabel, type Agent, type Relation, type Verb, type Workflow } from "../protocol/workflow";
import { useWorkflowStore } from "../state/workflowStore";

function target(workflow: Workflow, relation: Relation): string {
  return verbInfo(relation.verb).objectKind === "tool" ? toolLabel(relation.object ?? "") : objectName(workflow, relation);
}

/**
 * What an agent does, as sentences: "Anna hands a sheet to Luca". This is where a
 * workflow is put together: pick a verb, pick what it applies to, add. The order of an
 * agent's sentences is the order things happen in at the end of its turn.
 */
export function RelationEditor({ agent }: { agent: Agent }) {
  const workflow = useWorkflowStore((state) => state.workflow);
  const tools = useWorkflowStore((state) => state.tools);
  const edit = useWorkflowStore((state) => state.edit);
  const [verb, setVerb] = useState<Verb>("sends_to");
  const [picked, setPicked] = useState("");

  const own = relationsOf(workflow, agent.id);
  const info = verbInfo(verb);
  const choices = objectChoices(workflow, agent.id, verb, tools.map((tool) => tool.name));
  // The object on offer: what was picked if it is still a choice, else the first one.
  const object = info.objectKind === null ? undefined : (choices.find((choice) => choice.id === picked) ?? choices[0])?.id;
  const addable = canRelate(workflow, agent.id, verb, object);
  // What others say about this agent: not editable here, but part of what it does.
  const incoming = workflow.relations.filter((relation) => relation.object === agent.id && verbInfo(relation.verb).objectKind === "agent");

  return (
    <fieldset className="relations">
      <legend>What {agent.name} does</legend>
      {own.length === 0 && <p className="muted">Nothing yet. Add a sentence below.</p>}
      <ol className="list">
        {own.map((relation, index) => {
          const kind = verbInfo(relation.verb);
          return (
            <li key={relation.id} className="relation">
              <div className="sentence">
                <span className="muted">{agent.name}</span> {kind.phrase} {relation.object && <strong>{target(workflow, relation)}</strong>}
              </div>
              <div className="relation-tools">
                {kind.optional && (
                  <label className="checkbox" title="Left to the agent, turn by turn, instead of always happening">
                    <input
                      type="checkbox"
                      checked={!isRequired(relation)}
                      onChange={(event) => edit((current) => updateRelation(current, relation.id, { required: !event.target.checked }))}
                    />
                    if it chooses
                  </label>
                )}
                {closesCycle(workflow, relation) && (
                  <label className="rounds" title="This hand-off is on a loop: how many times it may happen in one run">
                    at most
                    <input
                      type="number"
                      min={1}
                      placeholder="5"
                      value={relation.maxRounds ?? ""}
                      onChange={(event) =>
                        edit((current) => updateRelation(current, relation.id, { maxRounds: event.target.value ? Number(event.target.value) : undefined }))
                      }
                    />
                    times
                  </label>
                )}
                <span className="spacer" />
                <button type="button" className="icon" title="Earlier" disabled={index === 0} onClick={() => edit((current) => moveRelation(current, relation.id, -1))}>
                  ↑
                </button>
                <button type="button" className="icon" title="Later" disabled={index === own.length - 1} onClick={() => edit((current) => moveRelation(current, relation.id, 1))}>
                  ↓
                </button>
                <button type="button" className="icon" title={`Remove: ${sentence(workflow, relation)}`} onClick={() => edit((current) => removeRelation(current, relation.id))}>
                  ✕
                </button>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="relation-add">
        <span className="muted">{agent.name}</span>
        <select aria-label="What it does" value={verb} onChange={(event) => setVerb(event.target.value as Verb)}>
          {VERBS.map((candidate) => (
            <option key={candidate.verb} value={candidate.verb}>
              {candidate.phrase}
            </option>
          ))}
        </select>
        {info.objectKind !== null && (
          <select aria-label="To whom or what" value={object ?? ""} disabled={choices.length === 0} onChange={(event) => setPicked(event.target.value)}>
            {choices.length === 0 && <option value="">{info.objectKind === "table" ? "no table to choose" : `no ${info.objectKind} to choose`}</option>}
            {choices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {info.objectKind === "tool" ? toolLabel(choice.label) : choice.label}
              </option>
            ))}
          </select>
        )}
        <button type="button" className="primary" disabled={!addable} onClick={() => edit((current) => addRelation(current, agent.id, verb, object))}>
          Add
        </button>
      </div>
      <small>{info.meaning}</small>

      {incoming.length > 0 && (
        <>
          <legend className="minor">What others do with {agent.name}</legend>
          <ul className="list">
            {incoming.map((relation) => (
              <li key={relation.id} className="muted">
                {sentence(workflow, relation)}
              </li>
            ))}
          </ul>
        </>
      )}
    </fieldset>
  );
}
