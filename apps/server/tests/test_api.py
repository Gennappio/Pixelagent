import json
import time

import pytest
from fastapi.testclient import TestClient

from server.main import create_app
from server.runtime.simple_runtime import SimpleRuntime
from server.tools.base import default_registry
from server.workflow.demo import demo_workflow


@pytest.fixture
def client(tmp_path):
    app = create_app(
        tmp_path / "test.db",
        runtime=SimpleRuntime(default_registry(), pace=0.01),
        workflows_dir=tmp_path / "workflows",
    )
    with TestClient(app) as client:
        yield client


def wait_for_run(client, run_id):
    for _ in range(200):
        run = client.get(f"/runs/{run_id}").json()
        if run["status"] != "running":
            return run
        time.sleep(0.02)
    raise AssertionError("run did not finish")


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
    definition["edges"].append({"id": "bad", "source": "start", "target": "nowhere"})
    assert client.post("/workflows", json=definition).status_code == 422


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
    assert client.get(f"/runs/{run['id']}/events?after=18").json() == streamed[18:]


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
    assert [r["id"] for r in client.get("/runs?workflow_id=demo").json()] == [run["id"]]
