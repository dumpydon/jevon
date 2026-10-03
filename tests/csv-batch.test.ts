import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LIMITS } from '../src/lib/config';
import { CsvValidationError, parseReviewCsv } from '../src/lib/csv';
import { EVALUATION_EXAMPLES } from '../src/lib/fixtures';

// Keep review text valid while testing the file's UTF-8 byte boundary independently.
function csvAtBytes(bytes: number): string {
  const prefix = 'text,extra\nGood,';
  const padding = bytes - new TextEncoder().encode(prefix).byteLength;
  return prefix + 'é'.repeat(Math.floor(padding / 2)) + 'x'.repeat(padding % 2);
}

describe('CSV validation', () => {
  it('reads canonical columns with quoted commas, quotes and multiline text', () => {
    expect(
      parseReviewCsv(
        'review_id,product,overall_rating,review_text\r\nA,Phone,4.5,"Great camera, and a ""clear"" screen.\nLasts all day."\r\n',
      ),
    ).toEqual([
      {
        reviewId: 'A',
        product: 'Phone',
        overallRating: 4.5,
        reviewText: 'Great camera, and a "clear" screen.\nLasts all day.',
      },
    ]);
  });

  it('normalizes BOM, case and whitespace, accepts aliases and omits blank optional ratings', () => {
    expect(
      parseReviewCsv('\uFEFF ID , Product Name , RATING , TEXT \n A , Phone , , Good battery \n'),
    ).toEqual([{ reviewId: 'A', product: 'Phone', reviewText: 'Good battery' }]);
    expect(parseReviewCsv('review\nWorks well')).toEqual([
      { reviewId: 'RV-001', product: 'Unspecified product', reviewText: 'Works well' },
    ]);
  });

  it('rejects duplicate normalized headers and aliases of the same field', () => {
    expect(() => parseReviewCsv('text,TEXT\nGood,Good')).toThrow(/duplicate/i);
    expect(() => parseReviewCsv('review_id,id,text\nA,B,Good')).toThrow(/one alias/i);
    expect(() => parseReviewCsv('text,extra,EXTRA\nGood,A,B')).toThrow(/duplicate/i);
  });

  it('rejects missing text columns, empty records and duplicate IDs', () => {
    expect(() => parseReviewCsv('id,product\nA,Phone')).toThrow(/review_text column/);
    expect(() => parseReviewCsv('id,text\nA,  ')).toThrow(/Record 1 is missing review text/);
    expect(() => parseReviewCsv('id,text\nA,Good\nA,Bad')).toThrow(/Record 2.*duplicate review ID/);
    expect(() => parseReviewCsv('id,text\n,Good\nRV-001,Bad')).toThrow(/duplicate review ID/);
  });

  it.each(['0', '6', 'NaN', 'Infinity', '0x5', 'five', '-1', '1e0'])(
    'rejects an invalid rating: %s',
    (rating) => {
      expect(() => parseReviewCsv(`rating,text\n${rating},Good`)).toThrow(/number from 1 to 5/);
    },
  );

  it('rejects malformed quotes and mismatched row widths', () => {
    expect(() => parseReviewCsv('text\n"unfinished')).toThrow(/malformed/i);
    expect(() => parseReviewCsv('id,text\nA,Good,Extra')).toThrow(/Record 1 has 3 columns/);
    expect(() => parseReviewCsv('id,text\nA')).toThrow(/Record 1 has 1 columns/);
  });

  it('rejects empty/header-only files, blank headers and null characters', () => {
    expect(() => parseReviewCsv(' \n')).toThrow(/empty/i);
    expect(() => parseReviewCsv('review_text\n')).toThrow(/at least one review/);
    expect(() => parseReviewCsv(',text\nA,Good')).toThrow(/column names cannot be blank/);
    expect(() => parseReviewCsv('text\nGood\0')).toThrow(/null characters/);
  });

  it.each([1_048_575, 1_048_576])('accepts a valid CSV of %i bytes', (bytes) => {
    const csv = csvAtBytes(bytes);
    expect(new TextEncoder().encode(csv).byteLength).toBe(bytes);
    expect(parseReviewCsv(csv)).toMatchObject([{ reviewText: 'Good' }]);
  });

  it('rejects a CSV one UTF-8 byte above 1 MiB', () => {
    const csv = csvAtBytes(1_048_577);
    expect(new TextEncoder().encode(csv).byteLength).toBe(1_048_577);
    expect(csv.length).toBeLessThan(1_048_576);
    expect(() => parseReviewCsv(csv)).toThrow('CSV files must be 1 MB or smaller.');
  });

  it('accepts all 50 review rows without truncating', () => {
    const csv = `text\n${Array.from({ length: 50 }, (_, index) => `Review ${index}`).join('\n')}`;
    const rows = parseReviewCsv(csv);
    expect(rows).toHaveLength(50);
    expect(rows[49].reviewText).toBe('Review 49');
  });

  it('rejects 51 review rows with the batch limit message', () => {
    const csv = `text\n${Array.from({ length: 51 }, () => 'Good').join('\n')}`;
    expect(() => parseReviewCsv(csv)).toThrow('Jevon supports up to 50 reviews per batch.');
  });

  it('preserves the per-review character limit', () => {
    expect(() => parseReviewCsv(`text\n${'A'.repeat(LIMITS.maxCharacters + 1)}`)).toThrow(
      /8,000 characters/,
    );
    expect(parseReviewCsv(`text\n${'A'.repeat(LIMITS.maxCharacters)}`)[0].reviewText).toHaveLength(
      LIMITS.maxCharacters,
    );
  });

  it('matches server limits for review IDs and product names', () => {
    expect(() => parseReviewCsv(`id,text\n${'I'.repeat(101)},Good`)).toThrow(
      /ID longer than 100 characters/,
    );
    expect(() => parseReviewCsv(`product,text\n${'P'.repeat(201)},Good`)).toThrow(
      /product name longer than 200 characters/,
    );
    expect(
      parseReviewCsv(`id,product,text\n${'I'.repeat(100)},${'P'.repeat(200)},Good`),
    ).toHaveLength(1);
  });

  it('accepts the bundled original fixture CSV', () => {
    const csv = readFileSync(new URL('../public/sample-reviews.csv', import.meta.url), 'utf8');
    const parsed = parseReviewCsv(csv);
    expect(parsed).toHaveLength(5);
    expect(parsed.map((item) => item.reviewText)).toEqual(
      EVALUATION_EXAMPLES.slice(0, 5).map((item) => item.text),
    );
  });

  it('provides a status-coded safe error for API callers', () => {
    try {
      parseReviewCsv('');
      throw new Error('Expected CSV validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(CsvValidationError);
      expect(error).toMatchObject({ code: 'INVALID_CSV', status: 400 });
    }
  });
});
