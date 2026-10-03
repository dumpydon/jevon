"""Pure rules, aggregation and fixture matching. No model calls."""

import math

from models import (
    Action,
    AspectAggregate,
    BatchAggregate,
    BatchItem,
    BatchSuccess,
    OperationalSignal,
)

MENTION_THRESHOLD = 0.5
ESCALATION_THRESHOLD = 0.75
CHURN_THRESHOLD = 3
URGENCY_THRESHOLD = 3
ASPECTS = [
    ("camera", "Camera", "photo and video quality, camera features"),
    ("battery", "Battery", "battery life, charging speed and reliability"),
    ("display", "Display", "screen quality, brightness and refresh rate"),
    ("design", "Design", "appearance, ergonomics and form factor"),
    (
        "performance",
        "Performance",
        "speed, responsiveness, gaming and software stability",
    ),
    ("build_quality", "Build quality", "durability, materials and construction"),
    (
        "value_for_money",
        "Value for money",
        "price, affordability and value relative to cost",
    ),
]
SATISFACTION_LABELS = [
    "Very dissatisfied",
    "Dissatisfied",
    "Neutral / mixed",
    "Satisfied",
    "Very satisfied",
]


def map_satisfaction(score: float) -> float:
    if isinstance(score, bool) or not math.isfinite(score) or not 0 <= score <= 4:
        raise ValueError("Satisfaction score must be between 0 and 4.")
    return score + 1


def derive_actions(signal: OperationalSignal) -> list[Action]:
    return [
        Action(
            id="escalate",
            label="Escalate to a person",
            triggered=signal.escalation_probability >= ESCALATION_THRESHOLD,
            rule="escalation_need >= 0.75",
            value=signal.escalation_probability,
            threshold=ESCALATION_THRESHOLD,
        ),
        Action(
            id="retention",
            label="Retention follow-up",
            triggered=signal.churn_risk >= CHURN_THRESHOLD,
            rule="churn_risk >= 3 / 4",
            value=signal.churn_risk,
            threshold=CHURN_THRESHOLD,
        ),
        Action(
            id="urgent",
            label="Prioritize urgent review",
            triggered=signal.urgency >= URGENCY_THRESHOLD,
            rule="urgency >= 3 / 4",
            value=signal.urgency,
            threshold=URGENCY_THRESHOLD,
        ),
    ]


def aggregate_results(items: list[BatchItem]) -> BatchAggregate:
    results = [item.result for item in items if isinstance(item, BatchSuccess)]
    aspects = []
    for aspect_id, label, _ in ASPECTS:
        ratings = [
            aspect.rating
            for result in results
            for aspect in result.aspects
            if aspect.id == aspect_id and aspect.mentioned and aspect.rating is not None
        ]
        aspects.append(
            AspectAggregate(
                id=aspect_id,
                label=label,
                average_rating=sum(ratings) / len(ratings) if ratings else None,
                mention_count=len(ratings),
                mention_percent=len(ratings) / len(results) * 100 if results else 0,
            )
        )
    ranked = sorted(
        (aspect for aspect in aspects if aspect.average_rating is not None),
        key=lambda a: a.average_rating,
    )
    sentiments = {"negative": 0, "neutral": 0, "positive": 0}
    for result in results:
        sentiments[result.signal.sentiment] += 1
    return BatchAggregate(
        successful=len(results),
        failed=len(items) - len(results),
        total_decisions=sum(result.decision_count for result in results),
        sentiment_counts=sentiments,
        aspects=aspects,
        weakest_aspect=ranked[0].label if ranked else None,
        strongest_aspect=ranked[-1].label if ranked else None,
        high_risk_count=sum(
            result.signal.churn_risk >= CHURN_THRESHOLD for result in results
        ),
        escalation_count=sum(
            result.signal.escalation_probability >= ESCALATION_THRESHOLD
            for result in results
        ),
    )


def evaluate_fixture(example: dict, result) -> dict[str, int]:
    expected = example["expected"]
    matches = []
    if "sentiment" in expected:
        matches.append(result.signal.sentiment == expected["sentiment"])
    if "topic" in expected:
        matches.append(result.signal.primary_topic == expected["topic"])
    for aspect_id, mentioned in expected.get("mentioned", {}).items():
        aspect = next((a for a in result.aspects if a.id == aspect_id), None)
        matches.append(aspect is not None and aspect.mentioned == mentioned)
    return {"agreements": sum(matches), "assertions": len(matches)}
