"""Explicit opt-in: one review through the real Python SDK. Never run in CI."""

import asyncio
import json
import os
import uuid
from pathlib import Path

from dotenv import load_dotenv

from decisions import evaluate_fixture
from jev import JevError, analyze_with_jev
from models import ReviewInput, browser_json


async def verify():
    load_dotenv(Path(__file__).resolve().parent.parent / ".env.local", override=False)
    if os.environ.get("JEV_VERIFY_REAL") != "1":
        print(
            "Opt-in required: JEV_VERIFY_REAL=1 npm run test:jev (one paid Jev analysis)."
        )
        return
    key = os.environ.get("TYPESAFE_API_KEY", "")
    examples = json.loads(Path(__file__).with_name("evaluation.json").read_text())
    selected = os.environ.get("JEV_VERIFY_EXAMPLE", "mixed")
    fixture = next((item for item in examples if item["id"] == selected), None)
    if fixture is None:
        raise SystemExit("Unknown JEV_VERIFY_EXAMPLE.")
    try:
        result = await analyze_with_jev(
            ReviewInput(
                review_id=selected,
                product="Manual integration verification",
                review_text=fixture["text"],
            ),
            api_key=key,
            request_id=str(uuid.uuid4()),
        )
    except JevError as error:
        raise SystemExit(f"{error.code}: {error.message}") from None
    assert result.source == "jev" and result.decision_count == len(result.traces) == 19
    assert key not in json.dumps(browser_json(result)), "A secret reached the response."
    assert all(
        aspect.rating is None for aspect in result.aspects if not aspect.mentioned
    )
    print(
        json.dumps(
            {
                "verified": True,
                "model": result.model,
                "decisions": result.decision_count,
                "durationMs": result.duration_ms,
                "mentionedAspects": [
                    aspect.id for aspect in result.aspects if aspect.mentioned
                ],
                "fixtureAgreement": evaluate_fixture(fixture, result),
                "note": "Agreement on a tiny fixture is diagnostic, not a model accuracy claim.",
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    asyncio.run(verify())
