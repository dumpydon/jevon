import copy
import math
from collections import Counter

import pytest
from pydantic import ValidationError

import jev
from decisions import aggregate_results, evaluate_fixture, map_satisfaction
from models import BatchFailure, BatchSuccess, ReviewInput, browser_json


def test_exact_question_definitions(contract):
    actual = {
        name: definition.model_dump(mode="json")
        for name, definition in jev.build_questions().items()
    }
    assert actual == contract["questions"]
    assert Counter(item["type"] for item in actual.values()) == {
        "noul": 8,
        "score": 9,
        "choice": 2,
    }


def test_exact_normalized_json_and_aggregation(contract, monkeypatch):
    items = []
    for case in contract["cases"]:
        monkeypatch.setattr(jev, "utc_now", lambda: case["expected"]["analyzedAt"])
        result = jev.normalize_result(
            case["raw"],
            ReviewInput.model_validate(case["review"]),
            "legacy-request",
            120,
        )
        assert browser_json(result) == case["expected"]
        items.append(
            BatchSuccess(review=result.review, status="success", result=result)
        )
    items.append(
        BatchFailure(
            review=items[0].review,
            status="failed",
            error={
                "code": "UPSTREAM_ERROR",
                "message": "Jev is temporarily unavailable.",
            },
        )
    )
    assert browser_json(aggregate_results(items)) == contract["aggregate"]


def test_fixture_matching_is_unchanged(contract):
    case = contract["cases"][0]
    result = jev.normalize_result(
        case["raw"], ReviewInput.model_validate(case["review"]), "id", 120
    )
    for item in contract["agreements"]:
        assert evaluate_fixture(item["example"], result) == item["expected"]


@pytest.mark.parametrize("score", [0, 1.4, 2.5, 4])
def test_score_mapping(score):
    assert map_satisfaction(score) == score + 1


@pytest.mark.parametrize("score", [-1, 4.01, math.nan, math.inf, True])
def test_invalid_scores(score):
    with pytest.raises(ValueError):
        map_satisfaction(score)


@pytest.mark.parametrize(
    "kind",
    [
        "missing",
        "extra",
        "type",
        "range",
        "probabilities",
        "choice",
        "legend",
        "weighted",
        "usage",
        "string",
        "bool",
    ],
)
def test_malformed_provider_responses(raw, review, kind):
    invalid = copy.deepcopy(raw)
    if kind == "missing":
        invalid["answers"].pop("battery_mentioned")
    elif kind == "extra":
        invalid["answers"]["unknown"] = {"type": "noul", "noul": 0.2}
    elif kind == "type":
        invalid["answers"]["battery_mentioned"] = invalid["answers"][
            "battery_satisfaction"
        ]
    elif kind == "range":
        invalid["answers"]["battery_mentioned"]["noul"] = 1.01
    elif kind == "probabilities":
        invalid["answers"]["primary_topic"]["probabilities"]["battery"] = 0.2
    elif kind == "choice":
        invalid["answers"]["primary_topic"]["choice"] = "unknown"
    elif kind == "legend":
        invalid["answers"]["battery_satisfaction"]["legend"]["0"] = "Changed rubric"
    elif kind == "weighted":
        invalid["answers"]["battery_satisfaction"]["score"] = 1
    elif kind == "usage":
        invalid["usage"]["input_tokens"] = -1
    else:
        invalid["answers"]["battery_mentioned"]["noul"] = (
            "0.2" if kind == "string" else True
        )
    with pytest.raises((ValidationError, jev.JevError)):
        jev.normalize_result(invalid, review, "test", 120)


def canonical(body):
    request_id = body.get("requestId") or body.get("error", {}).get("requestId")

    def strip(value):
        if isinstance(value, dict):
            return {
                key: "<time>"
                if key == "analyzedAt"
                else "<request>"
                if key == "requestId"
                else strip(item)
                for key, item in value.items()
            }
        if isinstance(value, list):
            return [strip(item) for item in value]
        return "<request>" if request_id and value == request_id else value

    return strip(body)


def test_original_api_cases(client, contract):
    for case in contract["apiCases"]:
        response = client.request(case["method"], case["path"], json=case.get("body"))
        assert response.status_code == case["status"], response.text
        assert canonical(response.json()) == canonical(case["expected"])
