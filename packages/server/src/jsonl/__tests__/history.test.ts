import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { JsonlHistory } from '../history.js';

describe('JsonlHistory', () => {
  let tmpDir: string;
  let jsonlPath: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `cc-remote-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    jsonlPath = join(tmpDir, 'test.jsonl');
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  describe('read', () => {
    it('returns empty array for non-existent file', async () => {
      const result = await JsonlHistory.read('/nonexistent/file.jsonl');
      expect(result).toEqual([]);
    });

    it('returns empty array for empty file', async () => {
      writeFileSync(jsonlPath, '');
      const result = await JsonlHistory.read(jsonlPath);
      expect(result).toEqual([]);
    });

    it('skips isMeta and isSidechain lines', async () => {
      writeFileSync(jsonlPath, [
        JSON.stringify({ type: 'user', uuid: 'u1', isMeta: true, message: { role: 'user', content: 'ignored' }, timestamp: '2026-01-01T00:00:00Z' }),
        JSON.stringify({ type: 'user', uuid: 'u2', isSidechain: true, message: { role: 'user', content: 'also-ignored' }, timestamp: '2026-01-01T00:00:00Z' }),
      ].join('\n'));
      const result = await JsonlHistory.read(jsonlPath);
      expect(result).toEqual([]);
    });

    it('parses user message with string content', async () => {
      writeFileSync(jsonlPath, JSON.stringify({
        type: 'user', uuid: 'msg-1',
        message: { role: 'user', content: '你好' },
        timestamp: '2026-06-27T12:00:00Z',
      }));
      const result = await JsonlHistory.read(jsonlPath);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('msg-1');
      expect(result[0].role).toBe('user');
      expect(result[0].content).toBe('你好');
    });

    it('parses user message with array content (text blocks)', async () => {
      writeFileSync(jsonlPath, JSON.stringify({
        type: 'user', uuid: 'msg-2',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: '第一部分' },
            { type: 'text', text: '第二部分' },
          ],
        },
        timestamp: '2026-06-27T12:00:00Z',
      }));
      const result = await JsonlHistory.read(jsonlPath);
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('第一部分\n第二部分');
    });

    it('skips user messages that only contain tool_results', async () => {
      writeFileSync(jsonlPath, JSON.stringify({
        type: 'user', uuid: 'msg-3',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_1', content: 'result', is_error: false },
          ],
        },
        timestamp: '2026-06-27T12:00:00Z',
      }));
      const result = await JsonlHistory.read(jsonlPath);
      expect(result).toHaveLength(0);
    });

    it('parses assistant message with text', async () => {
      writeFileSync(jsonlPath, JSON.stringify({
        type: 'assistant', uuid: 'msg-4',
        message: {
          id: 'msg-4',
          content: [
            { type: 'text', text: '我来帮你解决' },
          ],
        },
        timestamp: '2026-06-27T12:00:01Z',
      }));
      const result = await JsonlHistory.read(jsonlPath);
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('assistant');
      expect(result[0].content).toBe('我来帮你解决');
    });

    it('parses assistant message with tool_calls', async () => {
      writeFileSync(jsonlPath, JSON.stringify({
        type: 'assistant', uuid: 'msg-5',
        message: {
          id: 'msg-5',
          content: [
            { type: 'text', text: '让我查看文件' },
            { type: 'tool_use', id: 'toolu_read', name: 'Read', input: { file_path: '/tmp/test.txt' } },
          ],
        },
        timestamp: '2026-06-27T12:00:02Z',
      }));
      const result = await JsonlHistory.read(jsonlPath);
      expect(result).toHaveLength(1);
      expect(result[0].toolCalls).toHaveLength(1);
      expect(result[0].toolCalls![0].name).toBe('Read');
      expect(result[0].toolCalls![0].id).toBe('toolu_read');
      expect(result[0].toolCalls![0].input).toEqual({ file_path: '/tmp/test.txt' });
    });

    it('links tool_results to corresponding tool_calls by tool_use_id', async () => {
      writeFileSync(jsonlPath, [
        JSON.stringify({
          type: 'assistant', uuid: 'msg-6',
          message: {
            id: 'msg-6',
            content: [
              { type: 'tool_use', id: 'toolu_bash', name: 'Bash', input: { command: 'ls' } },
            ],
          },
          timestamp: '2026-06-27T12:00:00Z',
        }),
        JSON.stringify({
          type: 'user', uuid: 'msg-7',
          message: {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'toolu_bash', content: 'file1.txt\nfile2.txt', is_error: false },
            ],
          },
          timestamp: '2026-06-27T12:00:01Z',
        }),
      ].join('\n'));
      const result = await JsonlHistory.read(jsonlPath);
      expect(result).toHaveLength(1); // assistant only (user tool_result skipped)
      expect(result[0].toolCalls![0].result).toBe('file1.txt\nfile2.txt');
      expect(result[0].toolCalls![0].isError).toBe(false);
    });

    it('skips thinking blocks in assistant messages', async () => {
      writeFileSync(jsonlPath, JSON.stringify({
        type: 'assistant', uuid: 'msg-8',
        message: {
          id: 'msg-8',
          content: [
            { type: 'thinking', thinking: '内部思考过程' },
            { type: 'text', text: '可见回复' },
          ],
        },
        timestamp: '2026-06-27T12:00:00Z',
      }));
      const result = await JsonlHistory.read(jsonlPath);
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('可见回复');
      expect(result[0].toolCalls).toBeUndefined();
    });

    it('handles mixed messages in sequence', async () => {
      writeFileSync(jsonlPath, [
        JSON.stringify({ type: 'user', uuid: 'u1', message: { role: 'user', content: '帮我查一下' }, timestamp: '2026-01-01T00:00:00Z' }),
        JSON.stringify({ type: 'assistant', uuid: 'a1', message: { id: 'a1', content: [{ type: 'text', text: '好的' }] }, timestamp: '2026-01-01T00:00:01Z' }),
        JSON.stringify({ type: 'user', uuid: 'u2', message: { role: 'user', content: '谢谢' }, timestamp: '2026-01-01T00:00:02Z' }),
        JSON.stringify({ type: 'assistant', uuid: 'a2', message: { id: 'a2', content: [{ type: 'text', text: '不客气' }] }, timestamp: '2026-01-01T00:00:03Z' }),
      ].join('\n'));
      const result = await JsonlHistory.read(jsonlPath);
      expect(result).toHaveLength(4);
      expect(result.map(m => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    });

    it('skips malformed JSON lines gracefully', async () => {
      writeFileSync(jsonlPath, [
        'this is not valid json',
        JSON.stringify({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'valid' }, timestamp: '2026-01-01T00:00:00Z' }),
      ].join('\n'));
      const result = await JsonlHistory.read(jsonlPath);
      expect(result).toHaveLength(1);
    });
  });
});
