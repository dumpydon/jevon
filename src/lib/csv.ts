import Papa from 'papaparse';
import { LIMITS } from './config';
import type { ReviewInput } from './types';

export class CsvValidationError extends Error {
  readonly code = 'INVALID_CSV';
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = 'CsvValidationError';
  }
}

type Column = 'reviewId' | 'product' | 'overallRating' | 'reviewText';

const HEADER_ALIASES: Record<string, Column> = {
  review_id: 'reviewId',
  id: 'reviewId',
  product: 'product',
  product_name: 'product',
  overall_rating: 'overallRating',
  rating: 'overallRating',
  review_text: 'reviewText',
  review: 'reviewText',
  text: 'reviewText',
};

function normalizeHeader(header: string): string {
  return header
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

/** Parse and validate the whole file before a caller schedules any model requests. */
export function parseReviewCsv(text: string): ReviewInput[] {
  if (new TextEncoder().encode(text).byteLength > LIMITS.maxCsvBytes) {
    throw new CsvValidationError(
      `CSV files must be ${LIMITS.maxCsvBytes / (1024 * 1024)} MB or smaller.`,
    );
  }
  if (!text.trim()) throw new CsvValidationError('The CSV file is empty.');
  if (text.includes('\0'))
    throw new CsvValidationError('The CSV contains invalid null characters.');

  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy', delimiter: ',' });
  if (parsed.errors.length) {
    throw new CsvValidationError(
      'The CSV is malformed. Check quotation marks and comma-separated columns.',
    );
  }

  const [headers, ...rows] = parsed.data;
  if (!headers?.length) throw new CsvValidationError('The CSV needs a header row.');
  if (!rows.length)
    throw new CsvValidationError('The CSV needs at least one review below the header row.');
  if (rows.length > LIMITS.maxReviews) {
    throw new CsvValidationError(`Jevon supports up to ${LIMITS.maxReviews} reviews per batch.`);
  }

  const columns = new Map<Column, number>();
  const seenHeaders = new Set<string>();
  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    if (!normalized) throw new CsvValidationError('CSV column names cannot be blank.');
    if (seenHeaders.has(normalized)) {
      throw new CsvValidationError(`Duplicate CSV column: ${header.trim()}.`);
    }
    seenHeaders.add(normalized);
    const column = Object.hasOwn(HEADER_ALIASES, normalized)
      ? HEADER_ALIASES[normalized]
      : undefined;
    if (column) {
      if (columns.has(column)) {
        throw new CsvValidationError(
          `Multiple CSV columns refer to ${column}. Keep only one alias.`,
        );
      }
      columns.set(column, index);
    }
  });
  if (!columns.has('reviewText')) {
    throw new CsvValidationError('The CSV needs a review_text column (aliases: review or text).');
  }

  const seenIds = new Set<string>();
  return rows.map((row, index) => {
    const record = index + 1;
    if (row.length !== headers.length) {
      throw new CsvValidationError(
        `Record ${record} has ${row.length} columns; expected ${headers.length}.`,
      );
    }
    const value = (column: Column): string => {
      const columnIndex = columns.get(column);
      return columnIndex === undefined ? '' : row[columnIndex].trim();
    };
    const reviewId = value('reviewId') || `RV-${String(record).padStart(3, '0')}`;
    if (reviewId.length > 100)
      throw new CsvValidationError(`Record ${record} has a review ID longer than 100 characters.`);
    if (seenIds.has(reviewId))
      throw new CsvValidationError(`Record ${record} has a duplicate review ID: ${reviewId}.`);
    seenIds.add(reviewId);

    const reviewText = value('reviewText');
    if (!reviewText) throw new CsvValidationError(`Record ${record} is missing review text.`);
    if (reviewText.length > LIMITS.maxCharacters) {
      throw new CsvValidationError(
        `Record ${record} exceeds ${LIMITS.maxCharacters.toLocaleString('en-US')} characters.`,
      );
    }

    const product = value('product') || 'Unspecified product';
    if (product.length > 200)
      throw new CsvValidationError(
        `Record ${record} has a product name longer than 200 characters.`,
      );
    const input: ReviewInput = { reviewId, product, reviewText };
    const rawRating = value('overallRating');
    if (rawRating) {
      const overallRating = Number(rawRating);
      if (
        !/^(?:\d+\.?\d*|\.\d+)$/.test(rawRating) ||
        !Number.isFinite(overallRating) ||
        overallRating < 1 ||
        overallRating > 5
      ) {
        throw new CsvValidationError(
          `Record ${record} has an invalid overall rating. Use a number from 1 to 5.`,
        );
      }
      input.overallRating = overallRating;
    }
    return input;
  });
}
