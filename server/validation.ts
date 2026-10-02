import { z } from 'zod';
import { LIMITS } from '../src/lib/config';

export const reviewTextSchema = z
  .string()
  .trim()
  .min(1, 'Enter customer feedback before analyzing.')
  .max(
    LIMITS.maxCharacters,
    `Feedback must be ${LIMITS.maxCharacters.toLocaleString()} characters or fewer.`,
  );
export const reviewSchema = z
  .object({
    reviewId: z.string().trim().min(1).max(100),
    product: z.string().trim().min(1).max(200),
    reviewText: reviewTextSchema,
    overallRating: z.number().min(1).max(5).optional(),
  })
  .strict();
export const analyzeSchema = z.object({ reviewText: reviewTextSchema }).strict();
export const batchSchema = z
  .object({
    reviews: z
      .array(reviewSchema)
      .min(1)
      .max(LIMITS.maxReviews, `Jevon supports up to ${LIMITS.maxReviews} reviews per batch.`),
  })
  .strict()
  .refine(
    ({ reviews }) => new Set(reviews.map((review) => review.reviewId)).size === reviews.length,
    { message: 'Review IDs must be unique.' },
  );
export const benchmarkSchema = z
  .object({ exampleIds: z.array(z.string()).min(1).max(LIMITS.benchmarkMax) })
  .strict()
  .refine(({ exampleIds }) => new Set(exampleIds).size === exampleIds.length, {
    message: 'Choose each evaluation example only once.',
  });
