import pytest

from server.storage.database import connect
from server.storage.event_repository import EventRepository
from server.storage.run_repository import RunRepository
from server.workflow.demo import demo_workflow


@pytest.fixture
def connection():
    connection = connect(":memory:")
    yield connection
    connection.close()


@pytest.fixture
def events(connection):
    return EventRepository(connection)


@pytest.fixture
def runs(connection):
    return RunRepository(connection)


@pytest.fixture
def run(runs):
    return runs.create(demo_workflow(), "Find the latest sales number and send it to management.")
