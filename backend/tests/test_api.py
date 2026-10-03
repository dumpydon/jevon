import json

import pytest

import main
from jev import JevError, normalize_result
from models import MAX_CSV_BYTES, MAX_REQUEST_BYTES


def test_health_hides_secrets(client):
    response = client.get("/api/health")
    assert response.json()["limits"] == {
        "maxReviews": 50,
        "concurrency": 2,
        "maxCharacters": 8000,
    }
    assert response.json()["decisionCount"] == 19
    assert "test-only-key" not in response.text
    assert response.headers["cache-control"] == "no-store"


def test_valid_review_and_optional_keys(client):
    response = client.post("/api/analyze", json={"reviewText": "  Good battery.  "})
    body = response.json()
    assert response.status_code == 200, response.text
    assert body["review"]["reviewText"] == "Good battery."
    assert "overallRating" not in body["review"]
    assert len(body["traces"]) == 19
    assert body["requestId"] == response.headers["x-request-id"]
    assert body["aspects"][0]["rating"] is None
    assert "mappedRating" not in body["traces"][1]


@pytest.mark.parametrize("text", ["", "  ", "x" * 8001, "🙂" * 4001])
def test_invalid_review(client, text):
    response = client.post("/api/analyze", json={"reviewText": text})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_INPUT"


def test_bad_json_origin_and_unknown_route(client):
    response = client.post(
        "/api/analyze", content="{", headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_JSON"
    assert (
        client.post(
            "/api/analyze",
            json={"reviewText": "Good"},
            headers={"Origin": "https://unrelated.example"},
        ).status_code
        == 403
    )
    assert client.get("/api/unknown").json()["error"]["code"] == "NOT_FOUND"
    assert (
        client.post(
            "/api/analyze",
            json={"reviewText": "Good"},
            headers={"Origin": "http://localhost:3000"},
        ).status_code
        == 200
    )


@pytest.mark.parametrize(
    "path,body",
    [
        ("/api/analyze", {"reviewText": "Good"}),
        (
            "/api/batch",
            {"reviews": [{"reviewId": "1", "product": "Phone", "reviewText": "Good"}]},
        ),
        ("/api/benchmark", {"exampleIds": ["mixed"]}),
    ],
)
def test_missing_configuration(client, monkeypatch, path, body):
    monkeypatch.delenv("TYPESAFE_API_KEY")
    assert client.get("/api/health").json()["jevConfigured"] is False
    response = client.post(path, json=body)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "NOT_CONFIGURED"


def test_frontend_cors_preflight_and_response(client):
    origin = "http://localhost:3000"
    response = client.options(
        "/api/analyze",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin
    assert "access-control-allow-credentials" not in response.headers
    response = client.post(
        "/api/analyze", json={"reviewText": "Good"}, headers={"Origin": origin}
    )
    assert response.headers["access-control-allow-origin"] == origin
    assert response.headers["access-control-expose-headers"] == "X-Request-ID"
    denied = client.options(
        "/api/analyze",
        headers={
            "Origin": "https://unrelated.example",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert denied.status_code == 400
    assert "access-control-allow-origin" not in denied.headers


def test_safe_upstream_and_unexpected_errors(client, monkeypatch):
    async def failure(*args, **kwargs):
        raise JevError(
            "RATE_LIMIT",
            "TypeSafe returned a rate-limit response. Wait a moment before trying again.",
            429,
            429,
        )

    monkeypatch.setattr(main, "analyze_with_jev", failure)
    response = client.post("/api/analyze", json={"reviewText": "Good"})
    assert response.status_code == 429
    assert response.json()["error"]["requestId"]

    async def unexpected(*args, **kwargs):
        raise RuntimeError("private secret and customer feedback")

    monkeypatch.setattr(main, "analyze_with_jev", unexpected)
    response = client.post("/api/analyze", json={"reviewText": "Good"})
    assert response.status_code == 500
    assert "private secret" not in response.text


def test_fifty_rows_and_one_mib_body(client):
    reviews = [
        {"reviewId": str(i), "product": "Phone", "reviewText": "Good"}
        for i in range(50)
    ]
    encoded = json.dumps({"reviews": reviews}).encode()
    response = client.post(
        "/api/batch",
        content=encoded + b" " * (MAX_CSV_BYTES - len(encoded)),
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/x-ndjson"
    events = [json.loads(line) for line in response.text.splitlines()]
    assert events[0]["type"] == "start"
    assert len([event for event in events if event["type"] == "progress"]) == 50
    assert events[-1]["result"]["aggregate"]["successful"] == 50
    assert events[-1]["result"]["aggregate"]["totalDecisions"] == 950
    response = client.post(
        "/api/batch", json={"reviews": reviews + [{**reviews[0], "reviewId": "51"}]}
    )
    assert response.status_code == 400
    assert (
        response.json()["error"]["message"]
        == "Jevon supports up to 50 reviews per batch."
    )


def test_body_guard_and_bad_batch(client):
    assert (
        client.post("/api/batch", content=b" " * (MAX_REQUEST_BYTES + 1)).status_code
        == 413
    )
    review = {"reviewId": "one", "product": "Phone", "reviewText": "Good"}
    assert (
        client.post("/api/batch", json={"reviews": [review, review]}).status_code == 400
    )
    assert (
        client.post(
            "/api/batch", json={"reviews": [{**review, "overallRating": None}]}
        ).status_code
        == 400
    )


def test_batch_partial_failures_and_benchmark(client, monkeypatch, raw):
    async def analyze(review, *, request_id, **kwargs):
        if review.review_id == "bad":
            raise JevError(
                "UPSTREAM_ERROR",
                "Jev is temporarily unavailable. Please try again later.",
                502,
            )
        return normalize_result(raw, review, request_id, 120)

    monkeypatch.setattr(main, "analyze_with_jev", analyze)
    response = client.post(
        "/api/batch",
        json={
            "reviews": [
                {"reviewId": id, "product": "Phone", "reviewText": "Good"}
                for id in ["good", "bad"]
            ]
        },
    )
    events = [json.loads(line) for line in response.text.splitlines()]
    assert events[-1]["result"]["aggregate"]["successful"] == 1
    assert events[-1]["result"]["aggregate"]["failed"] == 1
    response = client.post("/api/benchmark", json={"exampleIds": ["mixed", "absent"]})
    assert response.status_code == 200, response.text
    run = response.json()
    assert run["baseline"]["status"] == "not_configured"
    assert len(run["measurements"]) == 2
    assert all(
        item["latencyMs"] == 120 and item["schemaValid"] for item in run["measurements"]
    )


def test_benchmark_failures_do_not_invent_latency(client, monkeypatch):
    async def failure(*args, **kwargs):
        raise JevError(
            "INVALID_API_KEY",
            "TypeSafe rejected the server API key. Check the local server configuration.",
            503,
        )

    monkeypatch.setattr(main, "analyze_with_jev", failure)
    run = client.post("/api/benchmark", json={"exampleIds": ["mixed", "absent"]}).json()
    assert all(
        item["latencyMs"] is None and "result" not in item
        for item in run["measurements"]
    )
