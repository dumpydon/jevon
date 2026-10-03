import asyncio

import pytest

from batch import batch_events
from jev import JevError, normalize_result
from models import ReviewInput


def reviews(count):
    return [
        ReviewInput(review_id=str(i), product="Phone", review_text="Good")
        for i in range(count)
    ]


def test_bounded_fifty_review_batch(raw):
    async def run():
        active = maximum = 0

        async def analyze(review, *, request_id):
            nonlocal active, maximum
            active += 1
            maximum = max(maximum, active)
            await asyncio.sleep(0.001)
            active -= 1
            return normalize_result(raw, review, request_id, 120)

        events = [event async for event in batch_events(reviews(50), analyze)]
        assert maximum == 2 and active == 0
        assert events[-1]["result"]["aggregate"]["successful"] == 50
        assert [
            item["review"]["reviewId"] for item in events[-1]["result"]["items"]
        ] == [str(i) for i in range(50)]

    asyncio.run(run())


@pytest.mark.parametrize(
    "code",
    [
        "NOT_CONFIGURED",
        "INVALID_API_KEY",
        "ACCESS_DENIED",
        "INSUFFICIENT_BALANCE",
        "RATE_LIMIT",
    ],
)
def test_fatal_provider_conditions_stop_queued_work(raw, code):
    async def run():
        calls = []

        async def analyze(review, *, request_id):
            calls.append(review.review_id)
            if review.review_id == "0":
                raise JevError(code, "Safe provider error", 503)
            return normalize_result(raw, review, request_id, 120)

        events = [
            event
            async for event in batch_events(reviews(6), analyze, request_id="fatal")
        ]
        assert calls == ["0", "1"]
        assert events[-1]["result"]["aggregate"]["failed"] == 5
        assert events[-1]["result"]["items"][-1]["error"]["requestId"] == "fatal.6"

    asyncio.run(run())


def test_cancel_retains_completed_results_and_stops_pending_work(raw):
    async def run():
        cancel = asyncio.Event()
        calls, cancelled = [], []

        async def analyze(review, *, request_id):
            calls.append(review.review_id)
            if review.review_id == "0":
                return normalize_result(raw, review, request_id, 120)
            try:
                await asyncio.sleep(10)
            except asyncio.CancelledError:
                cancelled.append(review.review_id)
                raise

        events = []
        async for event in batch_events(reviews(50), analyze, cancel=cancel):
            events.append(event)
            if event["type"] == "progress":
                cancel.set()
        assert calls == ["0", "1"] and cancelled == ["1"]
        assert events[-1]["result"]["cancelled"] is True
        assert len(events[-1]["result"]["items"]) == 1

    asyncio.run(run())


def test_stream_close_cancels_tasks_immediately(raw):
    async def run():
        stopped = asyncio.Event()

        async def analyze(review, *, request_id):
            if review.review_id == "0":
                return normalize_result(raw, review, request_id, 120)
            try:
                await asyncio.sleep(10)
            finally:
                stopped.set()

        events = batch_events(reviews(50), analyze)
        await anext(events)
        assert (await anext(events))["type"] == "progress"
        await events.aclose()
        assert stopped.is_set()

    asyncio.run(run())


def test_already_cancelled_and_empty_batches_do_not_call_model():
    async def run():
        async def analyze(*args, **kwargs):
            raise AssertionError("Model must not be called")

        cancel = asyncio.Event()
        cancel.set()
        events = [
            event async for event in batch_events(reviews(1), analyze, cancel=cancel)
        ]
        assert events[-1]["result"]["cancelled"] is True
        assert events[-1]["result"]["items"] == []
        empty = [event async for event in batch_events([], analyze)]
        assert empty[-1]["result"]["aggregate"]["totalDecisions"] == 0

    asyncio.run(run())
