"""Two bounded asyncio tasks, streamed progress, partial failures and cancellation."""

import asyncio
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable

from decisions import aggregate_results
from jev import JevError, elapsed_ms
from models import (
    CONCURRENCY,
    AnalysisResult,
    ApiError,
    BatchFailure,
    BatchResult,
    BatchSuccess,
    ReviewInput,
    browser_json,
)

Analyze = Callable[..., Awaitable[AnalysisResult]]
FATAL_CODES = {
    "NOT_CONFIGURED",
    "MISSING_CONFIGURATION",
    "INVALID_API_KEY",
    "UNAUTHORIZED",
    "ACCESS_DENIED",
    "INSUFFICIENT_BALANCE",
    "RATE_LIMIT",
    "RATE_LIMITED",
}


async def batch_events(
    reviews: list[ReviewInput],
    analyze: Analyze,
    *,
    request_id: str | None = None,
    cancel: asyncio.Event | None = None,
) -> AsyncIterator[dict]:
    started = time.perf_counter()
    request_id = request_id or str(uuid.uuid4())
    items = [None] * len(reviews)
    pending = {}
    next_index = 0
    completed = 0
    fatal = None
    cancel_task = asyncio.create_task(cancel.wait()) if cancel is not None else None

    def schedule() -> None:
        nonlocal next_index
        index = next_index
        next_index += 1
        task = asyncio.create_task(
            analyze(reviews[index], request_id=f"{request_id}.{index + 1}")
        )
        pending[task] = index

    try:
        yield {"type": "start", "total": len(reviews), "requestId": request_id}
        if not (cancel and cancel.is_set()):
            for _ in range(min(CONCURRENCY, len(reviews))):
                schedule()
        while pending and not (cancel and cancel.is_set()):
            waiting = set(pending) | ({cancel_task} if cancel_task else set())
            done, _ = await asyncio.wait(waiting, return_when=asyncio.FIRST_COMPLETED)
            if cancel_task in done:
                break
            for task in sorted(done, key=lambda task: pending[task]):
                index = pending.pop(task)
                try:
                    item = BatchSuccess(
                        review=reviews[index], status="success", result=task.result()
                    )
                except JevError as error:
                    item = BatchFailure(
                        review=reviews[index],
                        status="failed",
                        error=ApiError(
                            code=error.code,
                            message=error.message,
                            request_id=f"{request_id}.{index + 1}",
                        ),
                    )
                    if error.code in FATAL_CODES:
                        fatal = item.error
                except Exception:
                    item = BatchFailure(
                        review=reviews[index],
                        status="failed",
                        error=ApiError(
                            code="ANALYSIS_FAILED",
                            message="This review could not be analyzed. Please try again.",
                            request_id=f"{request_id}.{index + 1}",
                        ),
                    )
                items[index] = item
                completed += 1
                yield {
                    "type": "progress",
                    "completed": completed,
                    "total": len(reviews),
                    "item": browser_json(item),
                }
            # Inspect every completed task before refilling slots. A success must
            # not schedule another paid call ahead of a simultaneous fatal error.
            while (
                not fatal
                and len(pending) < CONCURRENCY
                and next_index < len(reviews)
                and not (cancel and cancel.is_set())
            ):
                schedule()
        if fatal and not (cancel and cancel.is_set()):
            for index, item in enumerate(items):
                if item is None:
                    item = BatchFailure(
                        review=reviews[index],
                        status="failed",
                        error=ApiError(
                            code=fatal.code,
                            message=fatal.message,
                            request_id=f"{request_id}.{index + 1}",
                        ),
                    )
                    items[index] = item
                    completed += 1
                    yield {
                        "type": "progress",
                        "completed": completed,
                        "total": len(reviews),
                        "item": browser_json(item),
                    }
        finished = [item for item in items if item is not None]
        result = BatchResult(
            request_id=request_id,
            items=finished,
            aggregate=aggregate_results(finished),
            duration_ms=elapsed_ms(started),
            cancelled=bool(cancel and cancel.is_set()),
        )
        yield {"type": "complete", "result": browser_json(result)}
    finally:
        # StreamingResponse closes the generator on disconnect; no queued tasks survive it.
        tasks = [*pending, *([cancel_task] if cancel_task else [])]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
