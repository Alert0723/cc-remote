import { describe, it, expect, beforeEach } from 'vitest';
import { RingBuffer } from '../buffer.js';
import type { ServerEvent } from '@cc-remote/shared';

function makeEvent(seq: number): ServerEvent {
  return { type: 'connected', seq, ts: Date.now(), data: { status: 'ok', serverVersion: '1.0' } };
}

describe('RingBuffer', () => {
  let buf: RingBuffer;

  beforeEach(() => {
    buf = new RingBuffer(5); // small capacity for testing wrap
  });

  // ── push + size ──

  it('starts empty', () => {
    expect(buf.size).toBe(0);
    expect(buf.getLatestSeq()).toBe(0);
  });

  it('push increases size', () => {
    buf.push(makeEvent(1));
    expect(buf.size).toBe(1);
  });

  it('size capped at capacity (wrap overwrite)', () => {
    for (let i = 1; i <= 7; i++) buf.push(makeEvent(i));
    expect(buf.size).toBe(5); // capacity=5
  });

  // ── getLatestSeq ──

  it('getLatestSeq returns highest pushed seq', () => {
    buf.push(makeEvent(10));
    buf.push(makeEvent(20));
    buf.push(makeEvent(5));
    expect(buf.getLatestSeq()).toBe(5);
  });

  it('getLatestSeq returns 0 when empty', () => {
    expect(buf.getLatestSeq()).toBe(0);
  });

  // ── getSince ──

  it('getSince returns events after fromSeq', () => {
    buf.push(makeEvent(1));
    buf.push(makeEvent(2));
    buf.push(makeEvent(3));
    const result = buf.getSince(1);
    expect(result).toHaveLength(2);
    expect(result[0].seq).toBe(2);
    expect(result[1].seq).toBe(3);
  });

  it('getSince returns empty when all events <= fromSeq', () => {
    buf.push(makeEvent(1));
    buf.push(makeEvent(2));
    expect(buf.getSince(5)).toHaveLength(0);
  });

  it('getSince handles wrap-around correctly', () => {
    // Fill capacity: push 1-7 into capacity 5 → keeps 3,4,5,6,7
    for (let i = 1; i <= 7; i++) buf.push(makeEvent(i));
    // fromSeq=4 should return events with seq 5,6,7
    const result = buf.getSince(4);
    expect(result).toHaveLength(3);
    expect(result.map(e => e.seq)).toEqual([5, 6, 7]);
  });

  // ── isInBuffer ──

  it('isInBuffer returns false for empty buffer', () => {
    expect(buf.isInBuffer(1)).toBe(false);
  });

  it('isInBuffer returns true when fromSeq >= oldest seq', () => {
    buf.push(makeEvent(10));
    buf.push(makeEvent(20));
    expect(buf.isInBuffer(10)).toBe(true);
    expect(buf.isInBuffer(9)).toBe(false); // below oldest
  });

  // ── clear ──

  it('clear resets size and head', () => {
    buf.push(makeEvent(1));
    buf.push(makeEvent(2));
    buf.clear();
    expect(buf.size).toBe(0);
    expect(buf.getLatestSeq()).toBe(0);
  });

  // ── restoreFromArray ──

  it('restoreFromArray replaces buffer contents', () => {
    buf.push(makeEvent(1));
    const events = [makeEvent(10), makeEvent(20), makeEvent(30)];
    buf.restoreFromArray(events);
    expect(buf.size).toBe(3);
    expect(buf.getLatestSeq()).toBe(30);
    expect(buf.getSince(10)).toHaveLength(2);
  });

  // ── exportRecent ──

  it('exportRecent returns last N events', () => {
    for (let i = 1; i <= 5; i++) buf.push(makeEvent(i));
    const result = buf.exportRecent(3);
    expect(result).toHaveLength(3);
    expect(result.map(e => e.seq)).toEqual([3, 4, 5]);
  });

  it('exportRecent returns all when count > size', () => {
    buf.push(makeEvent(1));
    buf.push(makeEvent(2));
    expect(buf.exportRecent(10)).toHaveLength(2);
  });
});
