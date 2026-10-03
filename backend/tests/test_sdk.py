import asyncio
import json
import logging

import httpx2
import pytest
from typesafe_sdk import AsyncTypeSafeClient

import jev
from jev import JevError, analyze_with_jev


def install_transport(monkeypatch, handler):
    monkeypatch.setattr(
        jev,
        "AsyncTypeSafeClient",
        lambda **kwargs: AsyncTypeSafeClient(
            **kwargs, transport=httpx2.MockTransport(handler)
        ),
    )
    monkeypatch.setattr(jev, "retry_delay", lambda headers: 0)


def test_official_sdk_request_and_response(monkeypatch, raw, review, contract):
    requests = []

    def handler(request):
        requests.append(request)
        return httpx2.Response(200, json=raw)

    install_transport(monkeypatch, handler)
    result = asyncio.run(
        analyze_with_jev(review, api_key="test-only-key", request_id="SDK")
    )
    assert result.decision_count == 19
    request = requests[0]
    assert str(request.url) == "https://api.typesafe.ai/v1/systemone"
    assert request.headers["authorization"] == "Bearer test-only-key"
    payload = json.loads(request.content)
    assert payload["questions"] == contract["questions"]
    assert payload["model"] == "jev-1.13.0"
    assert payload["state"]["review_text"] == review.review_text


@pytest.mark.parametrize(
    "status,code",
    [
        (401, "INVALID_API_KEY"),
        (402, "INSUFFICIENT_BALANCE"),
        (403, "ACCESS_DENIED"),
        (429, "RATE_LIMIT"),
        (422, "UPSTREAM_VALIDATION"),
    ],
)
def test_safe_errors_without_retries(monkeypatch, review, status, code):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx2.Response(status, json={"error": "private key and customer data"})

    install_transport(monkeypatch, handler)
    with pytest.raises(JevError) as raised:
        asyncio.run(analyze_with_jev(review, api_key="test-only-key", request_id="SDK"))
    assert raised.value.code == code and len(calls) == 1
    assert "private key" not in raised.value.message


def test_only_one_transient_retry(monkeypatch, raw, review):
    calls = []

    def handler(request):
        calls.append(request)
        return (
            httpx2.Response(529, json={"error": "overloaded"})
            if len(calls) == 1
            else httpx2.Response(200, json=raw)
        )

    install_transport(monkeypatch, handler)
    asyncio.run(analyze_with_jev(review, api_key="test-only-key", request_id="SDK"))
    assert len(calls) == 2
    calls.clear()
    install_transport(
        monkeypatch,
        lambda request: (calls.append(request), httpx2.Response(529, json={}))[1],
    )
    with pytest.raises(JevError) as raised:
        asyncio.run(analyze_with_jev(review, api_key="test-only-key", request_id="SDK"))
    assert raised.value.code == "UPSTREAM_ERROR" and len(calls) == 2


@pytest.mark.parametrize("status", [403, 429])
def test_credit_error_is_recognized(monkeypatch, review, status):
    install_transport(
        monkeypatch,
        lambda request: httpx2.Response(
            status, json={"error": {"message": "Insufficient credits"}}
        ),
    )
    with pytest.raises(JevError) as raised:
        asyncio.run(analyze_with_jev(review, api_key="test-only-key", request_id="SDK"))
    assert raised.value.code == "INSUFFICIENT_BALANCE"


def test_timeout_connection_and_missing_configuration(monkeypatch, review):
    calls = []

    async def slow(request):
        calls.append(request)
        await asyncio.sleep(10)

    install_transport(monkeypatch, slow)
    monkeypatch.setattr(jev, "REQUEST_TIMEOUT", 0.01)
    with pytest.raises(JevError) as raised:
        asyncio.run(analyze_with_jev(review, api_key="test-only-key", request_id="SDK"))
    assert raised.value.code == "TIMEOUT" and len(calls) == 1

    def disconnected(request):
        raise httpx2.ConnectError("Private provider error")

    install_transport(monkeypatch, disconnected)
    with pytest.raises(JevError) as raised:
        asyncio.run(analyze_with_jev(review, api_key="test-only-key", request_id="SDK"))
    assert raised.value.code == "CONNECTION_ERROR"
    with pytest.raises(JevError) as raised:
        asyncio.run(analyze_with_jev(review, api_key=" ", request_id="SDK"))
    assert raised.value.code == "NOT_CONFIGURED"


def test_total_deadline_includes_retry_backoff(monkeypatch, review):
    calls = []
    install_transport(
        monkeypatch,
        lambda request: (calls.append(request), httpx2.Response(503, json={}))[1],
    )
    monkeypatch.setattr(jev, "TOTAL_TIMEOUT", 0.01)
    monkeypatch.setattr(jev, "retry_delay", lambda headers: 1)
    with pytest.raises(JevError) as raised:
        asyncio.run(analyze_with_jev(review, api_key="test-only-key", request_id="SDK"))
    assert raised.value.code == "TIMEOUT" and len(calls) == 1


def test_cancellation_reaches_the_official_sdk_transport(monkeypatch, review):
    async def run():
        started = asyncio.Event()
        cancelled = asyncio.Event()

        async def slow(request):
            started.set()
            try:
                await asyncio.sleep(30)
            finally:
                cancelled.set()

        install_transport(monkeypatch, slow)
        task = asyncio.create_task(
            analyze_with_jev(review, api_key="test-only-key", request_id="SDK")
        )
        await asyncio.wait_for(started.wait(), timeout=1)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert cancelled.is_set()

    asyncio.run(run())


def test_retry_after_is_capped(monkeypatch):
    monkeypatch.setattr(jev.random, "uniform", lambda *args: 0)
    assert jev.retry_delay({"retry-after": "2"}) == 2
    assert jev.retry_delay({"retry-after-ms": "1200"}) == 1.2
    assert jev.retry_delay({"retry-after": "30"}) == 0.5
    assert jev.retry_delay({"retry-after": "invalid"}) == 0.5


def test_malformed_response_and_safe_logs(monkeypatch, raw, review, caplog):
    raw["answers"]["battery_mentioned"]["unexpected"] = "private-key-sentinel"
    install_transport(monkeypatch, lambda request: httpx2.Response(200, json=raw))
    with caplog.at_level(logging.INFO, logger="jevon"):
        with pytest.raises(JevError) as raised:
            asyncio.run(
                analyze_with_jev(
                    review, api_key="private-key-sentinel", request_id="SDK"
                )
            )
    assert raised.value.code == "INVALID_RESPONSE"
    assert (
        "private-key-sentinel" not in caplog.text
        and review.review_text not in caplog.text
    )
