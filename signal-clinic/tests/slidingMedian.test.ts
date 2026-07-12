import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SlidingWindowMedian } from '../src/core/slidingMedian';

function bruteForceMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

test('SlidingWindowMedian matches brute force across a randomized push/remove sequence', () => {
  const tracker = new SlidingWindowMedian();
  const reference: number[] = [];

  // Simulates the real usage pattern: a value enters, and once the window
  // is "full" the oldest value leaves — same shape as DeClick/SpectralRepair's
  // enter/leave loop, just driven directly here rather than through audio data.
  const stream: number[] = [];
  for (let i = 0; i < 2000; i++) stream.push(Math.round((Math.random() - 0.5) * 1000) / 10);

  const windowSize = 17;
  for (let i = 0; i < stream.length; i++) {
    tracker.push(stream[i]);
    reference.push(stream[i]);

    if (reference.length > windowSize) {
      const removed = reference.shift()!;
      tracker.remove(removed);
    }

    const expected = bruteForceMedian(reference);
    const actual = tracker.median();
    assert.equal(actual, expected, `mismatch at step ${i}: expected ${expected}, got ${actual}`);
  }
});

test('SlidingWindowMedian: handles duplicate values correctly', () => {
  const tracker = new SlidingWindowMedian();
  for (const v of [5, 5, 5, 5, 5]) tracker.push(v);
  assert.equal(tracker.median(), 5);

  tracker.remove(5);
  tracker.remove(5);
  assert.equal(tracker.size(), 3);
  assert.equal(tracker.median(), 5);
});

test('SlidingWindowMedian: empty tracker returns 0, not NaN or throw', () => {
  const tracker = new SlidingWindowMedian();
  assert.equal(tracker.median(), 0);
  assert.equal(tracker.size(), 0);
});

test('SlidingWindowMedian: remove of a value not present is a safe no-op', () => {
  const tracker = new SlidingWindowMedian();
  tracker.push(1);
  tracker.push(2);
  tracker.remove(999);
  assert.equal(tracker.size(), 2);
});
