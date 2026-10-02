import type { EvaluationExample, ReviewInput } from './types';

export const EVALUATION_EXAMPLES: EvaluationExample[] = [
  {
    id: 'positive',
    name: 'A strong recommendation',
    text: 'I love this phone. The camera takes outstanding photos, the screen is bright and clear, and the battery comfortably lasts two days. Excellent value for the price. I would absolutely buy it again.',
    expected: {
      sentiment: 'positive',
      mentioned: { camera: true, battery: true, display: true, value_for_money: true },
    },
  },
  {
    id: 'battery',
    name: 'Battery frustration',
    text: 'The battery is terrible and barely survives half a day. Charging takes forever. I regret buying this phone and will switch to another brand.',
    expected: {
      sentiment: 'negative',
      topic: 'battery',
      mentioned: { battery: true, camera: false, display: false },
    },
  },
  {
    id: 'mixed',
    name: 'A mixed experience',
    text: 'The battery barely lasts until evening and charging is painfully slow. Performance is smooth and the camera is fantastic for this price, but I would not buy this phone again because of the battery.',
    expected: { topic: 'battery', mentioned: { battery: true, performance: true, camera: true } },
  },
  {
    id: 'absent',
    name: 'No product aspects',
    text: 'I like the packaging.',
    expected: {
      topic: 'other',
      mentioned: {
        battery: false,
        camera: false,
        display: false,
        performance: false,
        value_for_money: false,
      },
    },
  },
  {
    id: 'ambiguous',
    name: 'Unclear feedback',
    text: 'It is a phone. Some days I like it, other days I am not sure. I need more time with it.',
    expected: { sentiment: 'neutral' },
  },
  {
    id: 'multiple',
    name: 'Several product aspects',
    text: 'The metal frame feels solid and the slim design fits my hand. Gaming is fast and the OLED display looks beautiful, but the photos are blurry at night.',
    expected: {
      mentioned: {
        build_quality: true,
        design: true,
        performance: true,
        display: true,
        camera: true,
      },
    },
  },
  {
    id: 'escalation',
    name: 'A customer at risk',
    text: 'My phone battery swelled and the back casing came apart. I stopped using it. Support has ignored me for a week. I need a replacement immediately and I will never buy from this company again.',
    expected: { sentiment: 'negative', mentioned: { battery: true, build_quality: true } },
  },
];
export const SAMPLE_REVIEWS: ReviewInput[] = EVALUATION_EXAMPLES.slice(0, 5).map((item, index) => ({
  reviewId: `RV-${String(index + 1).padStart(3, '0')}`,
  product: 'Sample smartphone',
  reviewText: item.text,
}));
