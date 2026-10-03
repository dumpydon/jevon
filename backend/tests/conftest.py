import copy
import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import jev
import main
from models import ReviewInput

CONTRACT = json.loads(
    Path(__file__).with_name("fixtures").joinpath("legacy.json").read_text()
)


@pytest.fixture
def contract():
    return copy.deepcopy(CONTRACT)


@pytest.fixture
def raw(contract):
    return contract["cases"][0]["raw"]


@pytest.fixture
def review(contract):
    return ReviewInput.model_validate(contract["cases"][0]["review"])


@pytest.fixture
def client(monkeypatch, raw):
    monkeypatch.setenv("TYPESAFE_API_KEY", "test-only-key")

    async def fake(input_review, *, api_key, request_id):
        if not api_key.strip():
            raise jev.JevError(
                "NOT_CONFIGURED",
                "Jev is not configured. Set TYPESAFE_API_KEY on the server.",
                503,
            )
        return jev.normalize_result(raw, input_review, request_id, 120)

    monkeypatch.setattr(main, "analyze_with_jev", fake)
    with TestClient(main.app, raise_server_exceptions=False) as value:
        yield value
