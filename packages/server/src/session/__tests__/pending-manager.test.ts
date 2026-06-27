import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PendingManager, type ApprovalEntry, type QuestionEntry } from '../pending-manager.js';

function makeApproval(overrides: Partial<ApprovalEntry> = {}): ApprovalEntry {
  return {
    toolUseId: 'toolu_001',
    toolName: 'Bash',
    command: 'npm install',
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeQuestion(overrides: Partial<QuestionEntry> = {}): QuestionEntry {
  return {
    toolUseId: 'toolu_002',
    question: 'Yes or no?',
    options: [{ label: 'Yes', value: 'Yes' }, { label: 'No', value: 'No' }],
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('PendingManager', () => {
  let pm: PendingManager;

  beforeEach(() => {
    pm = new PendingManager();
  });

  // ── Approval: add / get / remove ──

  it('addApproval stores entry', () => {
    pm.addApproval('s1', 'r1', makeApproval(), 60_000, vi.fn());
    expect(pm.getApproval('s1', 'r1')).toBeTruthy();
    expect(pm.getApproval('s1', 'r1')!.toolName).toBe('Bash');
  });

  it('getApproval returns undefined for unknown request', () => {
    expect(pm.getApproval('s1', 'nonexistent')).toBeUndefined();
  });

  it('getApproval returns undefined for unknown session', () => {
    expect(pm.getApproval('unknown', 'r1')).toBeUndefined();
  });

  it('removeApproval clears timeout and removes entry', () => {
    pm.addApproval('s1', 'r1', makeApproval(), 60_000, vi.fn());
    const removed = pm.removeApproval('s1', 'r1');
    expect(removed).toBeTruthy();
    expect(pm.getApproval('s1', 'r1')).toBeUndefined();
  });

  it('getApprovalCount returns correct count', () => {
    expect(pm.getApprovalCount('s1')).toBe(0);
    pm.addApproval('s1', 'r1', makeApproval(), 60_000, vi.fn());
    pm.addApproval('s1', 'r2', makeApproval(), 60_000, vi.fn());
    expect(pm.getApprovalCount('s1')).toBe(2);
  });

  it('sessions are isolated', () => {
    pm.addApproval('s1', 'r1', makeApproval(), 60_000, vi.fn());
    expect(pm.getApprovalCount('s2')).toBe(0);
  });

  // ── Question: add / get / remove ──

  it('addQuestion stores entry', () => {
    pm.addQuestion('s1', 'q1', makeQuestion(), 60_000, vi.fn());
    expect(pm.getQuestion('s1', 'q1')).toBeTruthy();
    expect(pm.getQuestion('s1', 'q1')!.question).toBe('Yes or no?');
  });

  it('getQuestion returns undefined for unknown request', () => {
    expect(pm.getQuestion('s1', 'nonexistent')).toBeUndefined();
  });

  it('removeQuestion clears timeout and removes entry', () => {
    pm.addQuestion('s1', 'q1', makeQuestion(), 60_000, vi.fn());
    const removed = pm.removeQuestion('s1', 'q1');
    expect(removed).toBeTruthy();
    expect(pm.getQuestion('s1', 'q1')).toBeUndefined();
  });

  it('getQuestionCount returns correct count', () => {
    expect(pm.getQuestionCount('s1')).toBe(0);
    pm.addQuestion('s1', 'q1', makeQuestion(), 60_000, vi.fn());
    pm.addQuestion('s1', 'q2', makeQuestion(), 60_000, vi.fn());
    expect(pm.getQuestionCount('s1')).toBe(2);
  });

  // ── Fallback getters ──

  it('getAnyApproval returns first entry', () => {
    pm.addApproval('s1', 'r1', makeApproval({ toolName: 'First' }), 60_000, vi.fn());
    pm.addApproval('s1', 'r2', makeApproval({ toolName: 'Second' }), 60_000, vi.fn());
    expect(pm.getAnyApproval('s1')).toBeTruthy();
  });

  it('getAnyApproval returns undefined for empty session', () => {
    expect(pm.getAnyApproval('empty')).toBeUndefined();
  });

  it('getAnyQuestion returns first entry', () => {
    pm.addQuestion('s1', 'q1', makeQuestion({ question: 'First?' }), 60_000, vi.fn());
    expect(pm.getAnyQuestion('s1')).toBeTruthy();
  });

  it('getAnyQuestion returns undefined for empty session', () => {
    expect(pm.getAnyQuestion('empty')).toBeUndefined();
  });

  // ── clearAll ──

  it('clearAll removes all approvals and questions for a session', () => {
    pm.addApproval('s1', 'r1', makeApproval(), 60_000, vi.fn());
    pm.addQuestion('s1', 'q1', makeQuestion(), 60_000, vi.fn());
    pm.clearAll('s1');
    expect(pm.getApprovalCount('s1')).toBe(0);
    expect(pm.getQuestionCount('s1')).toBe(0);
  });

  it('clearAll does not throw for unknown session', () => {
    expect(() => pm.clearAll('nonexistent')).not.toThrow();
  });

  it('clearAll clears timeouts without calling callbacks', () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    pm.addApproval('s1', 'r1', makeApproval(), 60_000, onTimeout);
    pm.clearAll('s1');
    vi.advanceTimersByTime(120_000);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  // ── Timeout behavior ──

  describe('timeouts', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('fires approval timeout callback', () => {
      const onTimeout = vi.fn();
      pm.addApproval('s1', 'r1', makeApproval(), 60_000, onTimeout);
      vi.advanceTimersByTime(60_000);
      expect(onTimeout).toHaveBeenCalledWith('s1', 'r1');
    });

    it('fires question timeout callback', () => {
      const onTimeout = vi.fn();
      pm.addQuestion('s1', 'q1', makeQuestion(), 60_000, onTimeout);
      vi.advanceTimersByTime(60_000);
      expect(onTimeout).toHaveBeenCalledWith('s1', 'q1');
    });

    it('removing before timeout prevents callback', () => {
      const onTimeout = vi.fn();
      pm.addApproval('s1', 'r1', makeApproval(), 60_000, onTimeout);
      pm.removeApproval('s1', 'r1');
      vi.advanceTimersByTime(60_000);
      expect(onTimeout).not.toHaveBeenCalled();
    });

    it('different session timeouts are independent', () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      pm.addApproval('s1', 'r1', makeApproval(), 30_000, cb1);
      pm.addApproval('s2', 'r1', makeApproval(), 60_000, cb2);
      vi.advanceTimersByTime(30_000);
      expect(cb1).toHaveBeenCalled();
      expect(cb2).not.toHaveBeenCalled();
    });
  });
});
