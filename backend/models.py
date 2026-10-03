"""Request validation and the existing camelCase browser contract."""

from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictFloat,
    field_validator,
    model_validator,
)
from pydantic.alias_generators import to_camel

MAX_CHARACTERS = 8000
MAX_REVIEWS = 50
MAX_CSV_BYTES = 1_048_576
MAX_REQUEST_BYTES = MAX_CSV_BYTES + 16384  # Existing allowance for the JSON envelope.
CONCURRENCY = 2
MODEL = "jev-1.13.0"
DECISION_COUNT = 19
AspectId = Literal[
    "camera",
    "battery",
    "display",
    "design",
    "performance",
    "build_quality",
    "value_for_money",
]
Topic = AspectId | Literal["other"]
Sentiment = Literal["negative", "neutral", "positive"]
Probability = Annotated[StrictFloat, Field(ge=0, le=1, allow_inf_nan=False)]
ScoreValue = Annotated[StrictFloat, Field(ge=0, le=4, allow_inf_nan=False)]


class DTO(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, extra="forbid", strict=True
    )


def character_count(value: str) -> int:
    # JavaScript .length counts UTF-16 units, including two units for an emoji.
    return len(value.encode("utf-16-le", errors="surrogatepass")) // 2


def validate_review_text(value: str) -> str:
    value = value.strip(
        "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
    )
    if not value:
        raise ValueError("Enter customer feedback before analyzing.")
    if character_count(value) > MAX_CHARACTERS:
        raise ValueError("Feedback must be 8,000 characters or fewer.")
    return value


class AnalyzeRequest(DTO):
    review_text: str
    _review_text = field_validator("review_text")(validate_review_text)


class ReviewInput(AnalyzeRequest):
    review_id: str
    product: str
    overall_rating: (
        Annotated[StrictFloat, Field(ge=1, le=5, allow_inf_nan=False)] | None
    ) = None

    @field_validator("overall_rating", mode="before")
    @classmethod
    def reject_explicit_null_rating(cls, value):
        if value is None:
            raise ValueError("Invalid input: expected number, received null")
        return value

    @field_validator("review_id", "product")
    @classmethod
    def validate_labels(cls, value: str, info):
        value = value.strip()
        maximum = 100 if info.field_name == "review_id" else 200
        if not value or character_count(value) > maximum:
            raise ValueError(f"{info.field_name} must contain 1–{maximum} characters.")
        return value


class BatchRequest(DTO):
    reviews: list[ReviewInput]

    @field_validator("reviews")
    @classmethod
    def validate_rows(cls, reviews):
        if not reviews:
            raise ValueError("Too small: expected array to have >=1 items")
        if len(reviews) > MAX_REVIEWS:
            raise ValueError("Jevon supports up to 50 reviews per batch.")
        if len({review.review_id for review in reviews}) != len(reviews):
            raise ValueError("Review IDs must be unique.")
        return reviews


class BenchmarkRequest(DTO):
    example_ids: list[str] = Field(min_length=1, max_length=5)

    @model_validator(mode="after")
    def unique_examples(self):
        if len(set(self.example_ids)) != len(self.example_ids):
            raise ValueError("Choose each evaluation example only once.")
        return self


class NoulDecision(DTO):
    type: Literal["noul"]
    noul: Probability


class ChoiceDecision(DTO):
    type: Literal["choice"]
    choice: str
    confidence: Probability
    probabilities: dict[str, Probability]


class ScoreDecision(DTO):
    type: Literal["score"]
    score: ScoreValue
    confidence: Probability
    probabilities: dict[str, Probability]
    legend: dict[str, str]


Decision = Annotated[
    NoulDecision | ChoiceDecision | ScoreDecision, Field(discriminator="type")
]


class DecisionTrace(DTO):
    id: str
    decision: Decision
    threshold: float | None = None
    accepted: bool | None = None
    mapped_rating: float | None = None


class AspectDecision(DTO):
    id: AspectId
    label: str
    mention_probability: Probability
    mentioned: bool
    rating: float | None
    satisfaction_label: str | None
    confidence: Probability | None


class OperationalSignal(DTO):
    sentiment: Sentiment
    sentiment_confidence: Probability
    primary_topic: Topic
    topic_confidence: Probability
    urgency: ScoreValue
    urgency_confidence: Probability
    churn_risk: ScoreValue
    churn_confidence: Probability
    escalation_probability: Probability


class Action(DTO):
    id: Literal["escalate", "retention", "urgent"]
    label: str
    triggered: bool
    rule: str
    value: float
    threshold: float


class Usage(DTO):
    input_tokens: int = Field(ge=0)
    output_tokens: int = Field(ge=0)


class AnalysisResult(DTO):
    request_id: str
    review: ReviewInput
    model: str
    source: Literal["jev"]
    analyzed_at: str
    duration_ms: int
    decision_count: int
    usage: Usage
    aspects: list[AspectDecision]
    signal: OperationalSignal
    actions: list[Action]
    traces: list[DecisionTrace]


class ApiError(DTO):
    code: str
    message: str
    request_id: str | None = None


class BatchSuccess(DTO):
    review: ReviewInput
    status: Literal["success"]
    result: AnalysisResult


class BatchFailure(DTO):
    review: ReviewInput
    status: Literal["failed"]
    error: ApiError


BatchItem = Annotated[BatchSuccess | BatchFailure, Field(discriminator="status")]


class AspectAggregate(DTO):
    id: AspectId
    label: str
    average_rating: float | None
    mention_count: int
    mention_percent: float


class BatchAggregate(DTO):
    successful: int
    failed: int
    total_decisions: int
    sentiment_counts: dict[Sentiment, int]
    aspects: list[AspectAggregate]
    weakest_aspect: str | None
    strongest_aspect: str | None
    high_risk_count: int
    escalation_count: int


class BatchResult(DTO):
    request_id: str
    items: list[BatchItem]
    aggregate: BatchAggregate
    duration_ms: int
    cancelled: bool


class BenchmarkMeasurement(DTO):
    id: str
    name: str
    status: Literal["success", "failed"]
    latency_ms: int | None
    schema_valid: bool
    agreements: int
    assertions: int
    result: AnalysisResult | None = None
    error: ApiError | None = None


class Baseline(DTO):
    status: Literal["not_configured"]
    reason: str


class BenchmarkRun(DTO):
    id: str
    created_at: str
    model: str
    measurements: list[BenchmarkMeasurement]
    duration_ms: int
    baseline: Baseline


class Health(DTO):
    status: Literal["ok"]
    jev_configured: bool
    model: str
    decision_count: int
    limits: dict[str, int]
    baseline_configured: Literal[False]


def browser_json(model: DTO) -> dict:
    # Omit absent optional keys, while preserving explicit null aspect ratings/latencies.
    return model.model_dump(mode="json", by_alias=True, exclude_unset=True)
