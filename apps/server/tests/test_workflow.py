import pytest
from office import agent, office

from server.workflow.demo import demo_workflow
from server.workflow.migrate import is_revision_1, upgrade
from server.workflow.models import SCHEMA_VERSION, Verb, Workflow, WorkflowDefinition
from server.workflow.relations import Office


def edit(**changes) -> Workflow:
    return Workflow.model_validate({**demo_workflow().to_wire(), **changes})


# -- the model


def test_the_demo_is_a_handful_of_sentences():
    workflow = demo_workflow()
    assert workflow.schema_version == SCHEMA_VERSION
    assert [room.id for room in workflow.rooms] == ["office"]
    assert [(r.subject, r.verb.value, r.object) for r in workflow.relations] == [
        ("anna", "is_entry", None),
        ("anna", "sends_to", "luca"),
        ("luca", "uses_tool", "web_search"),
        ("luca", "sends_to", "gianni"),
        ("gianni", "uses_tool", "send_email"),
        ("gianni", "is_exit", None),
    ]


def test_a_relation_on_the_wire_says_only_what_is_not_the_default():
    workflow = office(
        ["anna", "luca"],
        [("anna", "sends_to", "luca"), ("luca", "sends_to", "anna", {"required": False, "maxRounds": 3, "hint": "only if unsure", "order": 2})],
    )
    assert workflow.to_wire()["relations"] == [
        {"id": "r1", "subject": "anna", "verb": "sends_to", "object": "luca"},
        {"id": "r2", "subject": "luca", "verb": "sends_to", "object": "anna", "required": False, "order": 2, "maxRounds": 3, "hint": "only if unsure"},
    ]


def test_each_verb_has_its_own_default_for_required():
    # Handing over and writing happen unless left to the agent; a tool is the agent's to call unless it is consulted first.
    said = [
        ("anna", "sends_to", "luca", {"required": True}),
        ("anna", "writes_table", "board", {"required": True}),
        ("anna", "uses_tool", "web_search", {"required": False}),
        ("luca", "sends_to", "anna", {"required": False}),
        ("luca", "writes_table", "board", {"required": False}),
        ("luca", "uses_tool", "web_search", {"required": True}),
    ]
    workflow = office(["anna", "luca"], said, tables=[{"id": "board"}])
    assert [relation.required for relation in workflow.relations] == [True, True, False, False, False, True]
    assert [relation.get("required") for relation in workflow.to_wire()["relations"]] == [None, None, None, False, False, True]
    unsaid = office(["anna", "luca"], [sentence[:3] for sentence in said[:3]], tables=[{"id": "board"}])
    assert [relation.required for relation in unsaid.relations] == [True, True, False]
    assert Workflow.model_validate(workflow.to_wire()) == workflow


def test_required_means_nothing_on_the_verbs_that_are_not_a_choice():
    workflow = office(
        ["anna", "luca"],
        [("anna", "is_entry", None, {"required": False}), ("anna", "waits_for", "luca", {"required": False}), ("anna", "reads_table", "board", {"required": False})],
        tables=[{"id": "board"}],
    )
    assert all(relation.required for relation in workflow.relations)
    assert all("required" not in relation for relation in workflow.to_wire()["relations"])


def test_a_workflow_round_trips_through_its_wire_form():
    for workflow in (demo_workflow(), edit(tables=[{"id": "board", "name": "Board"}, {"id": "todo", "mode": "pile", "scope": "global"}])):
        assert Workflow.model_validate(workflow.to_wire()) == workflow


def test_an_unfinished_office_is_a_valid_workflow():
    # No entry, no exit, an agent nobody talks to: it must still be possible to save.
    workflow = office(["anna", "luca"], [("anna", "uses_tool", "web_search")])
    assert Office(workflow).entry is None and Office(workflow).exit is None
    assert WorkflowDefinition().rooms[0].id == "office"


def test_tables_default_to_shared_tables_of_the_room():
    workflow = edit(tables=[{"id": "board", "name": "Board"}, {"id": "todo", "mode": "pile", "scope": "global"}])
    assert [(t.id, t.mode.value, t.scope.value, t.room_id) for t in workflow.tables] == [
        ("board", "shared", "room", "office"),
        ("todo", "pile", "global", "office"),
    ]


@pytest.mark.parametrize(
    "changes, problem",
    [
        ({"rooms": []}, "at least one room"),
        ({"schemaVersion": 3}, "version 3 is not supported"),
        ({"tables": [{"id": "board"}, {"id": "board"}]}, "table ids must be unique"),
        ({"tables": [{"id": "anna"}]}, "cannot share an id"),
        ({"tables": [{"id": "board", "mode": "heap"}]}, "mode"),
        ({"tables": [{"id": "board", "roomId": "attic"}]}, "unknown room 'attic'"),
    ],
)
def test_a_malformed_workflow_is_rejected(changes, problem):
    with pytest.raises(ValueError, match=problem):
        edit(**changes)


@pytest.mark.parametrize(
    "sentence, problem",
    [
        (("ghost", "sends_to", "anna"), "subject 'ghost' is not an agent"),
        (("anna", "sends_to", "ghost"), "object 'ghost' is not an agent"),
        (("anna", "sends_to", "anna"), "cannot sends_to itself"),
        (("anna", "sends_to", None), "needs an object"),
        (("anna", "is_entry", "luca"), "takes no object"),
        (("anna", "reads_table", "luca"), "object 'luca' is not a table"),
        (("anna", "takes_from_table", "board"), "only be taken from a pile"),
        (("anna", "reads_table", "todo"), "a pile is taken from, not read"),
        (("anna", "sends_to", "luca", {"maxRounds": 0}), "max_rounds|maxRounds"),
        (("anna", "teleports_to", "luca"), "verb"),
    ],
)
def test_a_sentence_that_makes_no_sense_is_rejected(sentence, problem):
    tables = [{"id": "board", "mode": "shared"}, {"id": "todo", "mode": "pile"}]
    with pytest.raises(ValueError, match=problem):
        office(["anna", "luca"], [sentence], tables=tables)


def test_the_same_sentence_cannot_be_said_twice_and_only_one_agent_is_the_entry():
    with pytest.raises(ValueError, match="says the same as an earlier one"):
        office(["anna", "luca"], [("anna", "sends_to", "luca"), ("anna", "sends_to", "luca")])
    with pytest.raises(ValueError, match="only one agent can be the entry"):
        office(["anna", "luca"], [("anna", "is_entry"), ("luca", "is_entry")])
    with pytest.raises(ValueError, match="only one agent can be the exit"):
        office(["anna", "luca"], [("anna", "is_exit"), ("luca", "is_exit")])
    with pytest.raises(ValueError, match="relation ids must be unique"):
        Workflow.model_validate({"id": "x", "agents": [agent("anna")], "relations": [{"id": "r1", "subject": "anna", "verb": "is_entry"}, {"id": "r1", "subject": "anna", "verb": "is_exit"}]})


def test_an_agent_has_between_one_and_ten_instances():
    assert demo_workflow().agents[0].instances == 1
    for instances in (0, 11):
        with pytest.raises(ValueError, match="instances"):
            office([{**agent("anna"), "instances": instances}], [])


# -- reading the relations


def test_the_office_answers_who_does_what_in_declaration_order():
    workflow = office(
        ["anna", "luca", "gianni"],
        [
            ("luca", "uses_tool", "web_search"),
            ("anna", "is_entry"),
            ("luca", "uses_tool", "calculator", {"required": True}),
            ("luca", "waits_for", "anna"),
            ("anna", "sends_to", "luca"),
            ("luca", "is_exit"),
        ],
    )
    view = Office(workflow)
    assert (view.entry.id, view.exit.id) == ("anna", "luca")
    assert view.tools("luca") == ["web_search", "calculator"]
    assert view.optional_tools("luca") == ["web_search"]
    assert view.waits_for("luca") == ["anna"]
    # Agents come in the order they first speak, then the ones that never do.
    assert [a.id for a in view.agents] == ["luca", "anna", "gianni"]
    assert view.sentence(workflow.relations[4]) == "Anna hands to Luca"
    assert view.sentence(workflow.relations[1]) == "Anna is the entry"
    # A tool reads differently when the agent does not choose it.
    assert view.sentence(workflow.relations[0]) == "Luca can use web_search"
    assert view.sentence(workflow.relations[2]) == "Luca consults first calculator"


def test_what_an_agent_consults_and_where_its_sheet_goes_follow_the_order_of_its_sentences():
    workflow = office(
        ["anna", "luca"],
        [
            ("anna", "uses_tool", "calculator", {"required": True}),
            ("anna", "writes_table", "board"),
            ("anna", "uses_tool", "send_email"),
            ("anna", "reads_table", "board"),
            ("anna", "sends_to", "luca", {"required": False}),
            ("anna", "uses_tool", "web_search", {"required": True, "order": 1}),
            ("anna", "writes_table", "notes", {"order": 1}),
        ],
        tables=[{"id": "board"}, {"id": "notes"}],
    )
    view = Office(workflow)
    # A tool the agent may use is not consulted: it is not in this list at all.
    assert [(r.verb.value, r.object) for r in view.consults("anna")] == [("uses_tool", "web_search"), ("uses_tool", "calculator"), ("reads_table", "board")]
    assert [(r.verb.value, r.object) for r in view.outputs("anna")] == [("writes_table", "notes"), ("writes_table", "board"), ("sends_to", "luca")]


def test_a_relation_closes_a_cycle_when_sheets_can_come_back_round():
    workflow = office(
        ["anna", "luca", "gianni", "marta"],
        [("anna", "sends_to", "luca"), ("luca", "sends_to", "gianni"), ("gianni", "sends_to", "anna"), ("gianni", "sends_to", "marta")],
    )
    view = Office(workflow)
    assert [view.closes_cycle(relation) for relation in workflow.relations] == [True, True, True, False]
    assert [view.rounds(relation) for relation in workflow.relations] == [5, 5, 5, None]


def test_order_puts_numbered_relations_first_and_keeps_the_rest_as_written():
    workflow = office(
        ["anna", "luca", "gianni", "marta"],
        [("anna", "sends_to", "luca"), ("anna", "sends_to", "gianni", {"order": 2}), ("anna", "sends_to", "marta", {"order": 1})],
    )
    view = Office(workflow)
    assert [r.object for r in view.in_order(view.of("anna", Verb.SENDS_TO))] == ["marta", "gianni", "luca"]


# -- revision 1


V1 = {
    "name": "Old",
    "input": "task",
    "agents": [
        {"id": "a", "name": "A", "tools": [{"name": "calculator"}], "appearance": {"sprite": "agent_female_01"}},
        {"id": "b", "name": "B", "tools": []},
    ],
    "nodes": [
        {"id": "start", "type": "start"},
        {"id": "na", "type": "agent", "agentId": "a"},
        {"id": "nb", "type": "agent", "agentId": "b"},
        {"id": "nt", "type": "tool", "tool": "web_search"},
        {"id": "end", "type": "end"},
    ],
    "edges": [
        {"id": "e1", "source": "start", "target": "na"},
        {"id": "e2", "source": "na", "target": "nb"},
        {"id": "e3", "source": "na", "target": "nt"},
        {"id": "e4", "source": "nb", "target": "nt"},
        {"id": "e5", "source": "nb", "target": "end"},
    ],
}


def test_a_graph_becomes_sentences():
    workflow = WorkflowDefinition.model_validate(V1)
    assert [(r.id, r.subject, r.verb.value, r.object) for r in workflow.relations] == [
        ("r1", "a", "is_entry", None),
        # tools wired in the graph first, then the ones the agent only listed
        ("r2", "a", "uses_tool", "web_search"),
        ("r3", "a", "uses_tool", "calculator"),
        ("r4", "a", "sends_to", "b"),
        ("r5", "b", "uses_tool", "web_search"),
        ("r6", "b", "is_exit", None),
    ]
    assert workflow.schema_version == SCHEMA_VERSION
    assert "tools" not in workflow.to_wire()["agents"][0]
    assert workflow.agents[0].appearance.sprite == "agent_female_01"


def test_a_current_workflow_is_left_exactly_as_it_is():
    wire = demo_workflow().to_wire()
    assert not is_revision_1(wire)
    assert upgrade(wire) is wire


def test_what_the_old_graph_could_not_run_is_dropped_without_fuss():
    v1 = {
        "agents": [{"id": "a", "name": "A"}, {"id": "b", "name": "B"}],
        "nodes": [{"id": "start", "type": "start"}, {"id": "na", "type": "agent", "agentId": "a"}, {"id": "nb", "type": "agent", "agentId": "b"}],
        "edges": [
            {"id": "loop", "source": "na", "target": "na"},
            {"id": "ghost", "source": "na", "target": "nowhere"},
            {"id": "back", "source": "nb", "target": "start"},
        ],
    }
    assert WorkflowDefinition.model_validate(v1).relations == []


def test_migration_is_recognised_without_a_graph_when_agents_still_list_tools():
    v1 = {"agents": [{"id": "a", "name": "A", "tools": [{"name": "web_search"}]}], "tables": [{"id": "board", "name": "Board"}]}
    workflow = WorkflowDefinition.model_validate(v1)
    assert [(r.subject, r.verb.value, r.object) for r in workflow.relations] == [("a", "uses_tool", "web_search")]
    assert workflow.tables[0].room_id == "office"
