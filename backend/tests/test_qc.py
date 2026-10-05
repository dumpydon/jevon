"""Regression checks for defects found during the final QC pass; no paid calls."""

import asyncio
import copy

import pytest
import httpx2

import jev
import main
from typesafe_sdk import AsyncTypeSafeClient

from batch import batch_events
from jev import JevError, normalize_result
from models import ReviewInput


def test_same_completion_fatal_error_prevents_new_work(raw):
    async def run():
        calls = []

        async def analyze(review, *, request_id):
            calls.append(review.review_id)
            if review.review_id == "1":
                raise JevError("INVALID_API_KEY", "Safe provider error", 503)
            return normalize_result(raw, review, request_id, 120)

        reviews = [
            ReviewInput(review_id=str(i), product="Phone", review_text="Good")
            for i in range(5)
        ]
        events = [event async for event in batch_events(reviews, analyze)]
        assert calls == ["0", "1"]
        assert events[-1]["result"]["aggregate"]["successful"] == 1
        assert events[-1]["result"]["aggregate"]["failed"] == 4

    asyncio.run(run())


@pytest.mark.parametrize("path", ["/api/analyze", "/api/batch", "/api/benchmark"])
def test_wrong_method_preserves_http_status(client, path):
    response = client.get(path)
    assert response.status_code == 405
    assert response.json()["error"]["code"] == "METHOD_NOT_ALLOWED"
    assert "POST" in response.headers["allow"]


def test_invalid_json_encoding_is_bad_request(client):
    response = client.post(
        "/api/analyze", content=b"\xff", headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_JSON"


@pytest.mark.parametrize("probability", [0.0, 0.4999, 0.5, 0.5001, 1.0])
def test_mention_threshold_hides_only_irrelevant_satisfaction(raw, review, probability):
    raw["answers"]["battery_mentioned"]["noul"] = probability
    result = normalize_result(raw, review, "gate", 120)
    aspect = next(item for item in result.aspects if item.id == "battery")
    assert aspect.mentioned is (probability >= 0.5)
    trace = next(item for item in result.traces if item.id == "battery_satisfaction")
    assert trace.accepted is aspect.mentioned
    if not aspect.mentioned:
        assert aspect.rating is None and aspect.confidence is None
        assert aspect.satisfaction_label is None and trace.mapped_rating is None
    else:
        assert aspect.rating == raw["answers"]["battery_satisfaction"]["score"] + 1


@pytest.mark.parametrize(
    "score,distribution,label",
    [
        (0.0, [1, 0, 0, 0, 0], "Very dissatisfied"),
        (2.5, [0, 0, 0.5, 0.5, 0], "Satisfied"),
        (2.6, [0, 0, 0.4, 0.6, 0], "Satisfied"),
        (4.0, [0, 0, 0, 0, 1], "Very satisfied"),
    ],
)
def test_weighted_rating_and_rounding(raw, review, score, distribution, label):
    answer = raw["answers"]["battery_satisfaction"]
    answer["score"] = score
    answer["probabilities"] = {str(i): float(p) for i, p in enumerate(distribution)}
    raw["answers"]["battery_mentioned"]["noul"] = 0.5
    result = normalize_result(raw, review, "score", 120)
    aspect = next(item for item in result.aspects if item.id == "battery")
    assert aspect.rating == score + 1
    assert aspect.satisfaction_label == label


@pytest.mark.parametrize("text", ["x", "x" * 8000, "🙂" * 4000])
def test_short_and_maximum_valid_input(client, text):
    response = client.post("/api/analyze", json={"reviewText": text})
    assert response.status_code == 200
    body = response.json()
    assert body["review"]["reviewText"] == text
    assert body["decisionCount"] == len(body["traces"]) == 19
    assert body["durationMs"] >= 0


@pytest.mark.parametrize("body", [{}, {"reviewText": None}, {"reviewText": 1}, [], {"reviewText": True}])
def test_malformed_input_types(client, body):
    response = client.post("/api/analyze", json=body)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_INPUT"


@pytest.mark.parametrize("decision_id", ["primary_topic", "overall_sentiment"])
def test_choice_cannot_claim_a_losing_winner(raw, review, decision_id):
    invalid = copy.deepcopy(raw)
    answer = invalid["answers"][decision_id]
    answer["choice"] = next(key for key in answer["probabilities"] if key != answer["choice"])
    with pytest.raises(JevError, match="unexpected response"):
        normalize_result(invalid, review, "choice", 120)


@pytest.mark.parametrize("example", main.EXAMPLES, ids=lambda example: example["id"])
def test_example_pipeline_through_mocked_official_sdk(client, monkeypatch, raw, example):
    expected = example["expected"]
    for name, winner in [
        ("overall_sentiment", expected.get("sentiment", "neutral")),
        ("primary_topic", expected.get("topic", "other")),
    ]:
        answer = raw["answers"][name]
        answer["choice"] = winner
        answer["confidence"] = 1.0
        answer["probabilities"] = {key: float(key == winner) for key in answer["probabilities"]}
    for aspect, _, _ in jev.ASPECTS:
        mentioned = expected.get("mentioned", {}).get(aspect, False)
        raw["answers"][f"{aspect}_mentioned"]["noul"] = 0.9 if mentioned else 0.1
    calls = []

    def transport(request):
        calls.append(request)
        return httpx2.Response(200, json=raw)

    monkeypatch.setattr(
        jev, "AsyncTypeSafeClient",
        lambda **kwargs: AsyncTypeSafeClient(**kwargs, transport=httpx2.MockTransport(transport)),
    )
    monkeypatch.setattr(main, "analyze_with_jev", jev.analyze_with_jev)
    response = client.post("/api/analyze", json={"reviewText": example["text"]})
    assert response.status_code == 200
    body = response.json()
    assert len(calls) == 1
    assert body["decisionCount"] == len(body["traces"]) == 19
    assert body["signal"]["sentiment"] == raw["answers"]["overall_sentiment"]["choice"]
    assert body["signal"]["primaryTopic"] == raw["answers"]["primary_topic"]["choice"]
    assert body["durationMs"] >= 0
    assert len(body["aspects"]) == 7
    for aspect in body["aspects"]:
        if not aspect["mentioned"]:
            assert aspect["rating"] is None and aspect["confidence"] is None
    actions = {action["id"]: action for action in body["actions"]}
    signal = body["signal"]
    assert actions["escalate"]["triggered"] is (signal["escalationProbability"] >= 0.75)
    assert actions["retention"]["triggered"] is (signal["churnRisk"] >= 3)
    assert actions["urgent"]["triggered"] is (signal["urgency"] >= 3)
