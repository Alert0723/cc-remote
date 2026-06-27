import { describe, it, expect } from 'vitest';
import {
  isValidServerEvent,
  isValidClientCommand,
  detectAskUserQuestion,
  generateId,
  createServerEvent,
  PROTOCOL_VERSION,
  RECONNECT_CONFIG,
} from '../protocol.js';

// ============ isValidServerEvent ============

describe('isValidServerEvent', () => {
  it('rejects null', () => {
    expect(isValidServerEvent(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isValidServerEvent(undefined)).toBe(false);
  });

  it('rejects non-object', () => {
    expect(isValidServerEvent('string')).toBe(false);
    expect(isValidServerEvent(123)).toBe(false);
    expect(isValidServerEvent(true)).toBe(false);
  });

  it('rejects object without type', () => {
    expect(isValidServerEvent({ seq: 1, ts: Date.now() })).toBe(false);
  });

  it('rejects invalid type', () => {
    expect(isValidServerEvent({ type: 'invalid', seq: 1, ts: Date.now() })).toBe(false);
  });

  it('rejects missing seq', () => {
    expect(isValidServerEvent({ type: 'connected', ts: Date.now() })).toBe(false);
  });

  it('rejects missing ts', () => {
    expect(isValidServerEvent({ type: 'connected', seq: 1 })).toBe(false);
  });

  it('accepts valid connected event', () => {
    expect(isValidServerEvent({ type: 'connected', seq: 1, ts: Date.now() })).toBe(true);
  });

  it('accepts all valid event types', () => {
    for (const type of ['stream', 'approval_request', 'question_request', 'status_change',
      'session_list', 'error', 'sync_response', 'connected', 'history',
      'restart_notice', 'session_switched']) {
      expect(isValidServerEvent({ type, seq: 1, ts: Date.now() })).toBe(true);
    }
  });
});

// ============ isValidClientCommand ============

describe('isValidClientCommand', () => {
  it('rejects null', () => {
    expect(isValidClientCommand(null)).toBe(false);
  });

  it('rejects non-object', () => {
    expect(isValidClientCommand('string')).toBe(false);
  });

  it('rejects missing type field', () => {
    expect(isValidClientCommand({ action: 'send_message' })).toBe(false);
  });

  it('rejects wrong type', () => {
    expect(isValidClientCommand({ type: 'event', action: 'send_message' })).toBe(false);
  });

  it('rejects invalid action', () => {
    expect(isValidClientCommand({ type: 'command', action: 'invalid_action' })).toBe(false);
  });

  it('accepts all valid actions', () => {
    for (const action of ['send_message', 'interrupt', 'approve', 'answer',
      'sync_from', 'create_session', 'switch_session', 'auth']) {
      expect(isValidClientCommand({ type: 'command', action })).toBe(true);
    }
  });

  it('accepts auth command with token data', () => {
    expect(isValidClientCommand({
      type: 'command', action: 'auth', data: { token: 'test-token' },
    })).toBe(true);
  });

  it('accepts command with sessionId', () => {
    expect(isValidClientCommand({
      type: 'command', action: 'send_message', sessionId: 'abc', data: { text: 'hi' },
    })).toBe(true);
  });
});

// ============ detectAskUserQuestion ============

describe('detectAskUserQuestion', () => {
  it('returns null for empty input', () => {
    expect(detectAskUserQuestion({})).toBeNull();
  });

  it('returns null for non-array questions', () => {
    expect(detectAskUserQuestion({ questions: 'not-an-array' })).toBeNull();
  });

  it('returns null for empty questions array', () => {
    expect(detectAskUserQuestion({ questions: [] })).toBeNull();
  });

  it('returns null for question without options', () => {
    expect(detectAskUserQuestion({ questions: [{ question: 'Yes or no?' }] })).toBeNull();
  });

  it('returns null for empty options array', () => {
    expect(detectAskUserQuestion({ questions: [{ question: 'Q?', options: [] }] })).toBeNull();
  });

  it('extracts question with header fallback', () => {
    const result = detectAskUserQuestion({
      questions: [{ header: 'Choose one', options: [{ label: 'A' }, { label: 'B' }] }],
    });
    expect(result).not.toBeNull();
    expect(result!.question).toBe('Choose one');
    expect(result!.options).toHaveLength(2);
  });

  it('prefers question over header', () => {
    const result = detectAskUserQuestion({
      questions: [{
        question: 'Real question', header: 'Header fallback',
        options: [{ label: 'Yes' }],
      }],
    });
    expect(result!.question).toBe('Real question');
  });

  it('maps options with label', () => {
    const result = detectAskUserQuestion({
      questions: [{ question: 'Q?', options: [{ label: 'Option A' }, { label: 'Option B' }] }],
    });
    expect(result!.options).toEqual([
      { label: 'Option A', value: 'Option A' },
      { label: 'Option B', value: 'Option B' },
    ]);
  });

  it('handles options without label (numeric fallback)', () => {
    const result = detectAskUserQuestion({
      questions: [{ question: 'Q?', options: [{}, {}] }],
    });
    expect(result!.options).toEqual([
      { label: '选项 1', value: '0' },
      { label: '选项 2', value: '1' },
    ]);
  });
});

// ============ generateId ============

describe('generateId', () => {
  it('generates without prefix', () => {
    const id = generateId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('generates with prefix', () => {
    const id = generateId('test');
    expect(id.startsWith('test-')).toBe(true);
  });

  it('generates unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateId());
    }
    expect(ids.size).toBe(100);
  });
});

// ============ createServerEvent ============

describe('createServerEvent', () => {
  it('creates event with type and data', () => {
    const event = createServerEvent('connected', { status: 'ok', serverVersion: '1.0' });
    expect(event.type).toBe('connected');
    expect((event.data as { status: string }).status).toBe('ok');
    expect(typeof event.seq).toBe('number');
    expect(typeof event.ts).toBe('number');
  });

  it('respects sessionId option', () => {
    const event = createServerEvent('stream', { text: 'hello' }, { sessionId: 'session-1' });
    expect(event.sessionId).toBe('session-1');
  });

  it('respects seq option', () => {
    const event = createServerEvent('status_change', { status: 'busy' }, { seq: 42 });
    expect(event.seq).toBe(42);
  });
});

// ============ 常量 ============

describe('constants', () => {
  it('PROTOCOL_VERSION is defined', () => {
    expect(PROTOCOL_VERSION).toBe('1.0.0');
  });

  it('RECONNECT_CONFIG has expected structure', () => {
    expect(RECONNECT_CONFIG.maxRetries).toBeGreaterThan(0);
    expect(RECONNECT_CONFIG.initialDelay).toBeGreaterThan(0);
    expect(RECONNECT_CONFIG.backoffFactor).toBeGreaterThan(1);
  });
});
