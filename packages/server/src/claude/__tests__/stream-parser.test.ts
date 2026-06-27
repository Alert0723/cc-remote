import { describe, it, expect, beforeEach } from 'vitest';
import { StreamParser } from '../stream-parser.js';
import type { StreamEvent, ApprovalRequest } from '@cc-remote/shared';

describe('StreamParser', () => {
  let parser: StreamParser;

  beforeEach(() => {
    parser = new StreamParser({ sessionId: 'test-session' });
  });

  // ── parse: basic cases ──

  it('returns null for empty string', () => {
    expect(parser.parse('')).toBeNull();
  });

  it('returns null for whitespace', () => {
    expect(parser.parse('   ')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    const result = parser.parse('not json');
    expect(result).toBeNull();
  });

  it('returns null for system events', () => {
    const result = parser.parse(JSON.stringify({ type: 'system', subtype: 'init' }));
    expect(result).toBeNull();
  });

  it('returns null for user events', () => {
    const result = parser.parse(JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }));
    expect(result).toBeNull();
  });

  // ── token (assistant) events ──

  it('parses assistant event with string content', () => {
    const line = JSON.stringify({ type: 'assistant', content: 'Hello world' });
    const result = parser.parse(line) as StreamEvent;
    expect(result).not.toBeNull();
    expect(result.type).toBe('stream');
    expect(result.event).toBe('token');
    expect(result.data.text).toBe('Hello world');
    expect(result.data.role).toBe('assistant');
  });

  it('parses assistant event with array content blocks', () => {
    const line = JSON.stringify({
      type: 'assistant',
      content: [
        { type: 'text', text: 'First' },
        { type: 'text', text: 'Second' },
      ],
    });
    const result = parser.parse(line) as StreamEvent;
    expect(result.data.text).toBe('FirstSecond');
  });

  it('parses verbose mode assistant (content in message.content)', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        id: 'msg_001',
        content: [{ type: 'text', text: 'Verbose output' }],
      },
    });
    const result = parser.parse(line) as StreamEvent;
    expect(result.data.text).toBe('Verbose output');
    expect(result.data.messageId).toBe('msg_001');
  });

  it('filters out thinking blocks', () => {
    const line = JSON.stringify({
      type: 'assistant',
      content: [
        { type: 'thinking', thinking: 'hidden' },
        { type: 'text', text: 'Visible text' },
      ],
    });
    const result = parser.parse(line) as StreamEvent;
    expect(result.data.text).toBe('Visible text');
  });

  // ── tool_use extraction from assistant content ──

  it('queues embedded tool_use blocks from assistant content', () => {
    const line = JSON.stringify({
      type: 'assistant',
      content: [
        { type: 'text', text: 'Let me run a command' },
        { type: 'tool_use', id: 'toolu_123', name: 'Bash', input: { command: 'ls' } },
      ],
    });
    parser.parse(line);
    const toolEvents = parser.flushToolEvents() as StreamEvent[];
    expect(toolEvents).toHaveLength(1);
    expect(toolEvents[0].type).toBe('stream');
    expect(toolEvents[0].event).toBe('tool_use');
    expect(toolEvents[0].data.toolName).toBe('Bash');
  });

  it('flushToolEvents clears the queue', () => {
    const line = JSON.stringify({
      type: 'assistant',
      content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} }],
    });
    parser.parse(line);
    parser.flushToolEvents();
    expect(parser.flushToolEvents()).toHaveLength(0);
  });

  // ── tool_use event ──

  it('parses standalone tool_use event', () => {
    const line = JSON.stringify({
      type: 'tool_use',
      tool_use_id: 'toolu_456',
      tool_name: 'Bash',
      input: { command: 'echo hello' },
    });
    const result = parser.parse(line) as StreamEvent;
    expect(result.type).toBe('stream');
    expect(result.event).toBe('tool_use');
    expect(result.data.toolName).toBe('Bash');
    expect(result.data.toolUseId).toBe('toolu_456');
    expect(result.data.input).toEqual({ command: 'echo hello' });
  });

  // ── tool_result event ──

  it('parses tool_result event', () => {
    const line = JSON.stringify({
      type: 'tool_result',
      tool_use_id: 'toolu_456',
      output: 'command output',
      is_error: false,
    });
    const result = parser.parse(line) as StreamEvent;
    expect(result.type).toBe('stream');
    expect(result.event).toBe('tool_result');
    expect(result.data.toolUseId).toBe('toolu_456');
    expect(result.data.content).toBe('command output');
    expect(result.data.isError).toBe(false);
  });

  // ── result event ──

  it('parses success result event', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      cost_usd: 0.05,
      duration_ms: 1200,
    });
    const result = parser.parse(line) as StreamEvent;
    expect(result.type).toBe('stream');
    expect(result.event).toBe('result');
    expect(result.data.subtype).toBe('success');
    expect(result.data.totalCostUsd).toBe(0.05);
  });

  it('parses error result event', () => {
    const line = JSON.stringify({ type: 'result', subtype: 'error' });
    const result = parser.parse(line) as StreamEvent;
    expect(result.data.subtype).toBe('error');
  });

  // ── permission_request event ──

  it('parses permission_request with valid options', () => {
    const line = JSON.stringify({
      type: 'permission_request',
      tool_use_id: 'toolu_789',
      tool_name: 'Bash',
      options: ['allow', 'deny', 'allow_always'],
      arguments: { command: 'rm -rf /' },
    });
    const result = parser.parse(line) as ApprovalRequest;
    expect(result.type).toBe('approval_request');
    expect(result.data.toolUseId).toBe('toolu_789');
    expect(result.data.toolName).toBe('Bash');
    expect(result.data.command).toBe('rm -rf /');
    expect(result.data.options).toEqual(['allow', 'deny', 'allow_always']);
  });

  it('filters invalid options from permission_request', () => {
    const line = JSON.stringify({
      type: 'permission_request',
      tool_use_id: 'toolu_1',
      options: ['allow', 'bad_option', 'deny'],
    });
    const result = parser.parse(line) as ApprovalRequest;
    expect(result.data.options).toEqual(['allow', 'deny']);
  });

  it('defaults options to allow/deny when empty', () => {
    const line = JSON.stringify({
      type: 'permission_request',
      tool_use_id: 'toolu_1',
      options: [],
    });
    const result = parser.parse(line) as ApprovalRequest;
    expect(result.data.options).toEqual(['allow', 'deny']);
  });

  it('returns null for permission_request without tool_use_id', () => {
    const line = JSON.stringify({
      type: 'permission_request',
      tool_name: 'Bash',
      options: ['allow'],
    });
    const result = parser.parse(line);
    expect(result).toBeNull();
  });

  // ── seq counter ──

  it('increments seq on each parse', () => {
    const r1 = parser.parse(JSON.stringify({ type: 'assistant', content: 'one' })) as StreamEvent;
    const r2 = parser.parse(JSON.stringify({ type: 'assistant', content: 'two' })) as StreamEvent;
    expect(r2.seq).toBe(r1.seq + 1);
  });

  it('reset sets seq counter', () => {
    parser.parse(JSON.stringify({ type: 'assistant', content: 'one' }));
    parser.parse(JSON.stringify({ type: 'assistant', content: 'two' }));
    parser.reset(100);
    const result = parser.parse(JSON.stringify({ type: 'assistant', content: 'three' })) as StreamEvent;
    expect(result.seq).toBe(101);
  });
});
