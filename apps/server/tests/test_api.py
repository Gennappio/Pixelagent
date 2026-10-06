import json
import time

import pytest
from fastapi.testclient import TestClient

from test_workflow import V1

from server.main import create_app
from server.runtime.office_runtime import OfficeRuntime
from server.tools.base import default_registry
from server.workflow.demo import demo_workflow


def serve(tmp_path, pace):
    return create_app(
        tmp_path / "test.db",
        runtime=OfficeRuntime(default_registry(), pace=pace),
        workflows_dir=tmp_path / "workflows",
    )


@pytest.fixture
def client(tmp_path):
    with TestClient(serve(tmp_path, pace=0.01)) as client:
        yield client


def wait_for_run(client, run_id):
    for _ in range(200):
        run = client.get(f"/runs/{run_id}").json()
        if run["status"] != "running":
            return run
        time.sleep(0.02)
    raise AssertionError("run did not finish")


def test_tools_are_listed_with_whether_they_can_be_consulted_first(client):
    tools = {tool["name"]: tool for tool in client.get("/tools").json()}
    assert {name: tool["consultable"] for name, tool in tools.items()} == {"web_search": True, "send_email": False, "calculator": True}
    assert tools["web_search"]["schema"]["required"] == ["query"]
    assert tools["web_search"]["description"]


def test_demo_workflow_is_seeded(client, tmp_path):
    assert [summary["id"] for summary in client.get("/workflows").json()] == ["demo"]
    assert client.get("/workflows/demo").json() == demo_workflow().to_wire()
    assert (tmp_path / "workflows" / "demo.json").is_file()


def test_create_and_update_workflow(client):
    definition = {k: v for k, v in demo_workflow().to_wire().items() if k != "id"}
    created = client.post("/workflows", json=definition)
    assert created.status_code == 201
    workflow_id = created.json()["id"]
    assert workflow_id.startswith("wf_")
    assert client.get(f"/workflows/{workflow_id}").json() == {**definition, "id": workflow_id}

    updated = client.put(f"/workflows/{workflow_id}", json={**definition, "name": "Edited"})
    assert updated.json()["name"] == "Edited"
    assert client.get(f"/workflows/{workflow_id}").json()["name"] == "Edited"


def test_invalid_workflow_is_rejected(client):
    definition = demo_workflow().to_wire()
    definition["relations"].append({"id": "bad", "subject": "anna", "verb": "sends_to", "object": "nobody"})
    assert client.post("/workflows", json=definition).status_code == 422


def test_an_unfinished_workflow_can_be_saved(client):
    definition = {key: value for key, value in demo_workflow().to_wire().items() if key != "id"}
    saved = client.post("/workflows", json={**definition, "relations": []})
    assert saved.status_code == 201
    # It cannot run yet, and a run says why instead of refusing to start.
    run = client.post(f"/workflows/{saved.json()['id']}/run").json()
    assert wait_for_run(client, run["id"])["status"] == "error"
    last = client.get(f"/runs/{run['id']}/events").json()[-1]
    assert (last["type"], last["payload"]["errorType"]) == ("RUN_ERROR", "WorkflowError")


def test_a_revision_1_workflow_is_accepted_and_stored_as_revision_2(client, tmp_path):
    created = client.post("/workflows", json=V1)
    assert created.status_code == 201
    body = created.json()
    assert body["schemaVersion"] == 2
    assert [relation["verb"] for relation in body["relations"]] == ["is_entry", "uses_tool", "uses_tool", "sends_to", "uses_tool", "is_exit"]
    stored = json.loads((tmp_path / "workflows" / f"{body['id']}.json").read_text("utf-8"))
    assert "nodes" not in stored and "edges" not in stored
    assert stored == body


def test_a_revision_1_file_is_read_as_it_is_and_not_rewritten_behind_your_back(client, tmp_path):
    path = tmp_path / "workflows" / "old.json"
    path.write_text(json.dumps(V1), "utf-8")
    before = path.read_text("utf-8")

    assert client.get("/workflows/old").json()["relations"][0] == {"id": "r1", "subject": "a", "verb": "is_entry"}
    assert "old" in [summary["id"] for summary in client.get("/workflows").json()]
    assert path.read_text("utf-8") == before

    # Saving it is what upgrades the file.
    client.put("/workflows/old", json={key: value for key, value in client.get("/workflows/old").json().items() if key != "id"})
    assert json.loads(path.read_text("utf-8"))["schemaVersion"] == 2


def test_saved_workflows_are_json_files_in_the_workflows_folder(client, tmp_path):
    definition = {k: v for k, v in demo_workflow().to_wire().items() if k != "id"}
    workflow_id = client.post("/workflows", json={**definition, "name": "On disk"}).json()["id"]

    stored = json.loads((tmp_path / "workflows" / f"{workflow_id}.json").read_text("utf-8"))
    assert stored == {**definition, "name": "On disk", "id": workflow_id}


def test_a_workflow_file_dropped_in_the_folder_is_picked_up(client, tmp_path):
    wire = {**demo_workflow().to_wire(), "name": "Hand written"}
    (tmp_path / "workflows" / "by_hand.json").write_text(json.dumps(wire), "utf-8")
    (tmp_path / "workflows" / "broken.json").write_text("{ not json", "utf-8")

    assert [summary["id"] for summary in client.get("/workflows").json()] == ["by_hand", "demo"]
    assert client.get("/workflows/by_hand").json()["name"] == "Hand written"
    assert client.post("/workflows/by_hand/run").status_code == 202


def test_unknown_resources_return_404(client):
    assert client.get("/workflows/..%2Fpyproject").status_code == 404
    assert client.get("/workflows/nope").status_code == 404
    assert client.post("/workflows/nope/run").status_code == 404
    assert client.get("/runs/nope/events").status_code == 404
    assert client.post("/runs/nope/stop").status_code == 404


def test_a_run_can_be_stopped(tmp_path):
    with TestClient(serve(tmp_path, pace=0.2)) as client:
        run = client.post("/workflows/demo/run").json()
        assert client.post(f"/runs/{run['id']}/stop").json() == {"stopping": True}
        assert wait_for_run(client, run["id"])["status"] == "stopped"

        events = client.get(f"/runs/{run['id']}/events").json()
        assert events[-1]["type"] == "RUN_ERROR"
        assert events[-1]["payload"] == {"message": "Stopped by the user.", "errorType": "Stopped"}
        assert len(events) < 20
        # A second stop finds nothing left to stop.
        assert client.post(f"/runs/{run['id']}/stop").json() == {"stopping": False}


def test_a_stopped_run_closes_its_stream_with_the_event_that_says_so(tmp_path):
    with TestClient(serve(tmp_path, pace=0.2)) as client:
        run = client.post("/workflows/demo/run").json()
        streamed = []
        with client.websocket_connect(f"/runs/{run['id']}/stream") as socket:
            streamed.append(socket.receive_json())
            client.post(f"/runs/{run['id']}/stop")
            while streamed[-1]["type"] not in ("RUN_FINISHED", "RUN_ERROR"):
                streamed.append(socket.receive_json())
        assert streamed[-1]["payload"]["errorType"] == "Stopped"


def test_run_stream_delivers_the_complete_ordered_log(client):
    run = client.post("/workflows/demo/run").json()
    assert run["id"].startswith("run_")
    assert run["workflow"]["id"] == "demo"

    streamed = []
    with client.websocket_connect(f"/runs/{run['id']}/stream") as socket:
        while True:
            event = socket.receive_json()
            streamed.append(event)
            if event["type"] in ("RUN_FINISHED", "RUN_ERROR"):
                break

    assert streamed[-1]["type"] == "RUN_FINISHED"
    assert [event["sequence"] for event in streamed] == list(range(1, len(streamed) + 1))

    assert wait_for_run(client, run["id"])["status"] == "finished"
    # Live stream and stored log are the same data: replay needs nothing else.
    assert client.get(f"/runs/{run['id']}/events").json() == streamed
    assert len(streamed) == 18
    assert client.get(f"/runs/{run['id']}/events?after=12").json() == streamed[12:]


def test_stream_of_a_finished_run_replays_from_storage(client):
    run = client.post("/workflows/demo/run", json={"input": "Find the latest sales number."}).json()
    wait_for_run(client, run["id"])

    with client.websocket_connect(f"/runs/{run['id']}/stream?after=10") as socket:
        first = socket.receive_json()
    assert first["sequence"] == 11


def test_run_export_contains_pipeline_context_and_events(client):
    run = client.post("/workflows/demo/run").json()
    wait_for_run(client, run["id"])

    export = client.get(f"/runs/{run['id']}/export").json()
    assert export["run"]["workflow"] == demo_workflow().to_wire()
    assert export["events"] == client.get(f"/runs/{run['id']}/events").json()
    finished = [e for e in export["events"] if e["type"] == "AGENT_FINISHED"]
    assert all(e["payload"]["context"] for e in finished)
    # Documents are not a resource of their own: the events in the export carry them.
    carried = [e["payload"]["documentId"] for e in export["events"] if "documentId" in e["payload"]]
    assert list(dict.fromkeys(carried)) == ["doc_input", "doc_1", "doc_2"]
    assert [r["id"] for r in client.get("/runs?workflow_id=demo").json()] == [run["id"]]
