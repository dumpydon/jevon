"""Four FastAPI routes. The frontend contract and inference policy stay unchanged."""

import asyncio
import json
import logging
import os
import time
import uuid
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.datastructures import Headers, MutableHeaders
from starlette.exceptions import HTTPException

from batch import batch_events
from decisions import evaluate_fixture
from jev import JevError, analyze_with_jev, elapsed_ms, utc_now
from models import (
    CONCURRENCY,
    DECISION_COUNT,
    MAX_CHARACTERS,
    MAX_REQUEST_BYTES,
    MAX_REVIEWS,
    MODEL,
    AnalysisResult,
    AnalyzeRequest,
    Baseline,
    BatchRequest,
    BenchmarkMeasurement,
    BenchmarkRequest,
    BenchmarkRun,
    Health,
    ReviewInput,
)

load_dotenv(Path(__file__).resolve().parent.parent / ".env.local", override=False)
logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("jevon")
FRONTEND_ORIGINS = [
    origin.strip().rstrip("/")
    for origin in os.environ.get("FRONTEND_ORIGIN", "http://localhost:3000").split(",")
    if origin.strip()
]
EXAMPLES = json.loads(Path(__file__).with_name("evaluation.json").read_text())


def error_response(
    code: str, message: str, request_id: str, status: int
) -> JSONResponse:
    return JSONResponse(
        {"error": {"code": code, "message": message, "requestId": request_id}},
        status_code=status,
    )


class RequestGuard:
    """Bound streamed request bytes before parsing; add safe request context and headers."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope["path"].startswith("/api/"):
            return await self.app(scope, receive, send)
        request_id = str(uuid.uuid4())
        scope.setdefault("state", {})["request_id"] = request_id
        headers = Headers(scope=scope)
        started = time.perf_counter()
        status = 500
        response_started = False

        async def guarded_send(message):
            nonlocal status, response_started
            if message["type"] == "http.response.start":
                status = message["status"]
                response_started = True
                outgoing = MutableHeaders(scope=message)
                outgoing["X-Request-ID"] = request_id
                outgoing["Cache-Control"] = "no-store"
                outgoing["X-Content-Type-Options"] = "nosniff"
            await send(message)

        try:
            if scope["method"] == "POST":
                origin = headers.get("origin")
                same_origin = (
                    f"{scope.get('scheme', 'http')}://{headers.get('host', '')}"
                )
                if origin and origin != same_origin and origin not in FRONTEND_ORIGINS:
                    return await error_response(
                        "INVALID_ORIGIN",
                        "Submit requests from the Jevon application.",
                        request_id,
                        403,
                    )(scope, receive, guarded_send)
                body = bytearray()
                while True:
                    message = await receive()
                    if message["type"] == "http.disconnect":
                        status = 408
                        return
                    body.extend(message.get("body", b""))
                    if len(body) > MAX_REQUEST_BYTES:
                        return await error_response(
                            "REQUEST_TOO_LARGE",
                            "Request exceeds the upload limit.",
                            request_id,
                            413,
                        )(scope, receive, guarded_send)
                    if not message.get("more_body", False):
                        break
                replayed = False

                async def replay_receive():
                    nonlocal replayed
                    if not replayed:
                        replayed = True
                        return {
                            "type": "http.request",
                            "body": bytes(body),
                            "more_body": False,
                        }
                    return await receive()

                await self.app(scope, replay_receive, guarded_send)
            else:
                await self.app(scope, receive, guarded_send)
        except Exception:
            # FastAPI re-raises handled errors for server logging. Its safe handler already
            # responded; suppress raw exception bodies/feedback in the ASGI server's logs.
            if not response_started:
                logger.warning(
                    json.dumps(
                        {
                            "event": "api_error",
                            "requestId": request_id,
                            "code": "INTERNAL_ERROR",
                            "status": 500,
                        }
                    )
                )
                await error_response(
                    "INTERNAL_ERROR",
                    "The request could not be completed. Try again or check server configuration.",
                    request_id,
                    500,
                )(scope, receive, guarded_send)
        finally:
            logger.info(
                json.dumps(
                    {
                        "event": "api_request",
                        "requestId": request_id,
                        "path": scope["path"],
                        "durationMs": elapsed_ms(started),
                        "status": status,
                    }
                )
            )


app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(RequestGuard)
app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
    expose_headers=["X-Request-ID"],
)


@app.exception_handler(RequestValidationError)
async def invalid_request(request: Request, error: RequestValidationError):
    issue = error.errors()[0]
    if issue["type"] == "json_invalid":
        return error_response(
            "INVALID_JSON",
            "The request must contain valid JSON.",
            request.state.request_id,
            400,
        )
    message = issue["msg"].removeprefix("Value error, ")
    if issue["type"] == "extra_forbidden":
        message = f'Unrecognized key: "{issue["loc"][-1]}"'
    elif issue["type"] == "too_short" and "exampleIds" in issue["loc"]:
        message = "Too small: expected array to have >=1 items"
    elif issue["type"] == "too_long" and "exampleIds" in issue["loc"]:
        message = "Too big: expected array to have <=5 items"
    return error_response("INVALID_INPUT", message, request.state.request_id, 400)


@app.exception_handler(JevError)
async def jev_failure(request: Request, error: JevError):
    logger.warning(
        json.dumps(
            {
                "event": "api_error",
                "requestId": request.state.request_id,
                "code": error.code,
                "status": error.status,
            }
        )
    )
    return error_response(
        error.code, error.message, request.state.request_id, error.status
    )


@app.exception_handler(HTTPException)
async def route_failure(request: Request, error: HTTPException):
    return error_response(
        "NOT_FOUND",
        "API route not found.",
        getattr(request.state, "request_id", ""),
        404,
    )


@app.exception_handler(Exception)
async def unexpected_failure(request: Request, error: Exception):
    logger.warning(
        json.dumps(
            {
                "event": "api_error",
                "requestId": getattr(request.state, "request_id", ""),
                "code": "INTERNAL_ERROR",
                "status": 500,
            }
        )
    )
    return error_response(
        "INTERNAL_ERROR",
        "The request could not be completed. Try again or check server configuration.",
        getattr(request.state, "request_id", ""),
        500,
    )


def configured_key() -> str:
    return os.environ.get("TYPESAFE_API_KEY", "")


async def until_disconnected(request: Request, operation):
    """Cancel a single/batched JSON request when its caller leaves, as with the old signal."""
    task = asyncio.create_task(operation)
    try:
        while not task.done():
            await asyncio.wait({task}, timeout=0.1)
            if not task.done() and await request.is_disconnected():
                raise JevError("CANCELLED", "The analysis was cancelled.", 408)
        return await task
    finally:
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)


@app.get("/api/health", response_model=Health, response_model_exclude_unset=True)
async def health():
    return Health(
        status="ok",
        jev_configured=bool(configured_key().strip()),
        model=MODEL,
        decision_count=DECISION_COUNT,
        limits={
            "maxReviews": MAX_REVIEWS,
            "concurrency": CONCURRENCY,
            "maxCharacters": MAX_CHARACTERS,
        },
        baseline_configured=False,
    )


@app.post(
    "/api/analyze", response_model=AnalysisResult, response_model_exclude_unset=True
)
async def analyze(body: AnalyzeRequest, request: Request):
    review = ReviewInput(
        review_id=request.state.request_id,
        product="Customer feedback",
        review_text=body.review_text,
    )
    return await until_disconnected(
        request,
        analyze_with_jev(
            review, api_key=configured_key(), request_id=request.state.request_id
        ),
    )


@app.post("/api/batch")
async def batch(body: BatchRequest, request: Request):
    if not configured_key().strip():
        raise JevError(
            "NOT_CONFIGURED",
            "Jev is not configured. Set TYPESAFE_API_KEY on the server.",
            503,
        )

    async def analyze_review(review, *, request_id):
        return await analyze_with_jev(
            review, api_key=configured_key(), request_id=request_id
        )

    async def stream():
        events = batch_events(
            body.reviews, analyze_review, request_id=request.state.request_id
        )
        try:
            async for event in events:
                yield json.dumps(event, ensure_ascii=False, allow_nan=False) + "\n"
        except asyncio.CancelledError:
            raise
        except Exception:
            yield (
                json.dumps(
                    {
                        "type": "error",
                        "error": {
                            "code": "INTERNAL_ERROR",
                            "message": "The request could not be completed. Try again or check server configuration.",
                            "requestId": request.state.request_id,
                        },
                    }
                )
                + "\n"
            )
        finally:
            await events.aclose()

    return StreamingResponse(
        stream(), media_type="application/x-ndjson", headers={"X-Accel-Buffering": "no"}
    )


@app.post(
    "/api/benchmark", response_model=BenchmarkRun, response_model_exclude_unset=True
)
async def benchmark(body: BenchmarkRequest, request: Request):
    by_id = {example["id"]: example for example in EXAMPLES}
    if any(example_id not in by_id for example_id in body.example_ids):
        raise JevError(
            "INVALID_INPUT", "Select examples from the evaluation fixture.", 400
        )
    if not configured_key().strip():
        raise JevError(
            "NOT_CONFIGURED",
            "Jev is not configured. Set TYPESAFE_API_KEY on the server.",
            503,
        )
    started = time.perf_counter()
    reviews = [
        ReviewInput(
            review_id=example_id,
            product="Evaluation fixture",
            review_text=by_id[example_id]["text"],
        )
        for example_id in body.example_ids
    ]

    async def run():
        async def analyze_review(review, *, request_id):
            return await analyze_with_jev(
                review, api_key=configured_key(), request_id=request_id
            )

        events = batch_events(
            reviews, analyze_review, request_id=request.state.request_id
        )
        try:
            async for event in events:
                if event["type"] == "complete":
                    return event["result"]
        finally:
            await events.aclose()

    result = await until_disconnected(request, run())
    measurements = []
    for item in result["items"]:
        example = by_id[item["review"]["reviewId"]]
        common = {
            "id": example["id"],
            "name": example["name"],
            "status": item["status"],
        }
        if item["status"] == "failed":
            measurements.append(
                BenchmarkMeasurement(
                    **common,
                    latency_ms=None,
                    schema_valid=False,
                    agreements=0,
                    assertions=0,
                    error=item["error"],
                )
            )
        else:
            analysis = AnalysisResult.model_validate(item["result"])
            measurements.append(
                BenchmarkMeasurement(
                    **common,
                    latency_ms=analysis.duration_ms,
                    schema_valid=True,
                    **evaluate_fixture(example, analysis),
                    result=analysis,
                )
            )
    return BenchmarkRun(
        id=request.state.request_id,
        created_at=utc_now(),
        model=MODEL,
        measurements=measurements,
        duration_ms=elapsed_ms(started),
        baseline=Baseline(
            status="not_configured",
            reason="This build measures Jev. A conventional LLM baseline is optional and has no provider credential configured.",
        ),
    )
