/**
 * 工具调用卡片
 * 展示工具/Skill 名称、参数、结果、耗时、嵌套子工具
 */

import React, { useState, useRef, useEffect } from 'react';
import { useThemeStore } from '../stores/themeStore.js';
import type { ToolCallDetail } from '@cc-remote/shared';

interface ToolCallCardProps {
  toolCall: ToolCallDetail;
  /** 是否嵌套（Skill 子工具），缩进显示 */
  nested?: boolean;
}

/** I/O 类工具，提取文件路径用于显示 */
const IO_TOOLS = new Set(['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash']);

function extractFilePath(tc: ToolCallDetail): string | undefined {
  if (!IO_TOOLS.has(tc.name)) return undefined;
  const fp = tc.input?.['file_path'] || tc.input?.['filePath'] || tc.input?.['path'] || tc.input?.['command'];
  if (typeof fp === 'string') {
    // 取文件名部分（最后一级），太长则截断
    const parts = fp.replace(/\\/g, '/').split('/');
    const last = parts[parts.length - 1] || fp;
    // 如果是完整路径，显示「父目录/文件名」
    if (parts.length > 1) {
      const short = `…/${parts[parts.length - 2]}/${last}`;
      return short.length < fp.length ? short : last;
    }
    return last;
  }
  return undefined;
}

/** 提取参数摘要 */
function summarizeInput(input: Record<string, unknown>): string {
  const keys = Object.keys(input);
  if (keys.length === 0) return '';
  const parts = keys.slice(0, 2).map(k => {
    const v = input[k];
    const str = typeof v === 'string' ? v : JSON.stringify(v);
    return str.length > 30 ? str.slice(0, 30) + '…' : str;
  });
  return parts.join(' · ');
}

export function ToolCallCard({ toolCall, nested }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [contentHeight, setContentHeight] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const debugMode = useThemeStore((s) => s.debugMode);
  const isSkill = toolCall.type === 'skill';
  const isDone = !!toolCall.result;
  const isError = toolCall.isError;
  const statusColor = isError ? 'var(--danger)' : isDone ? 'var(--success)' : 'var(--warning)';
  const statusBg = isError ? 'var(--danger-bg)' : isDone ? 'var(--success-bg)' : 'var(--warning-bg)';
  const statusLabel = isDone ? (isError ? '失败' : '完成') : '执行中';
  const summary = summarizeInput(toolCall.input);

  useEffect(() => {
    if (expanded && contentRef.current) {
      setContentHeight(contentRef.current.scrollHeight);
    } else if (!expanded) {
      setContentHeight(0);
    }
  }, [expanded, toolCall.result, toolCall.input]);

  return (
    <div style={{ marginLeft: nested ? '16px' : '0' }}>
      <div
        className="rounded-lg my-1.5 overflow-hidden transition-all duration-150"
        style={{
          border: `1px solid ${isSkill ? 'var(--accent-soft)' : 'var(--border-color)'}`,
          background: isSkill ? 'var(--accent-soft)' : 'var(--tool-bg)',
          opacity: isSkill && !isDone ? 0.95 : 1,
        }}
      >
        {/* 头部 */}
        <button
          className="flex items-center justify-between w-full px-3 py-2.5 cursor-pointer select-none transition-colors duration-150"
          style={{ background: 'transparent', border: 'none' }}
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {/* 图标 */}
            <div
              className="flex-shrink-0 flex items-center justify-center rounded"
              style={{
                width: '22px', height: '22px', borderRadius: '5px',
                background: isSkill ? 'var(--accent)' : statusBg,
                color: isSkill ? '#fff' : statusColor,
              }}
            >
              {isSkill ? (
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 1l1.8 4.2L14 7l-3.2 2L10 15 8 12l-2 3-1-5.8L2 7l4.2-1.8L8 1z" />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 3v10l-2-2M11 13V3l2 2M3 8h10" />
                </svg>
              )}
            </div>

            {/* 状态 */}
            <span className="text-xs rounded-full px-1.5 py-0.5 font-medium flex-shrink-0" style={{
              color: statusColor, background: statusBg,
              fontSize: '10px', fontWeight: 600,
              fontFamily: "'Inter Tight', 'Inter', sans-serif",
            }}>
              {statusLabel}
            </span>

            {/* 名称 */}
            <span className="font-medium text-sm truncate" style={{
              fontFamily: "'JetBrains Mono', 'Cascadia Code', monospace",
              fontSize: '12px', fontWeight: 500, color: 'var(--text-primary)',
            }}>
              {isSkill && typeof toolCall.input?.skill === 'string'
                ? <><span>Skill </span><span style={{color:'var(--text-muted)',fontWeight:400}}>({toolCall.input.skill})</span></>
                : (() => {
                    const fp = extractFilePath(toolCall);
                    return fp ? <><span>{toolCall.name} </span><span style={{color:'var(--text-muted)',fontWeight:400}}>({fp})</span></> : toolCall.name;
                  })()}
            </span>
          </div>

          {/* 展开箭头（最右边） */}
          <div className="flex items-center flex-shrink-0 ml-2">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--text-muted)"
              strokeWidth="1.5" strokeLinecap="round" className="transition-transform duration-200"
              style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>
              <path d="M3 5l4 4 4-4" />
            </svg>
          </div>
        </button>

        {/* 展开内容 */}
        <div ref={contentRef} className="overflow-hidden transition-all duration-300 ease-out"
          style={{ maxHeight: expanded ? contentHeight + 'px' : '0px', opacity: expanded ? 1 : 0 }}>
          <div className="px-3 pb-2 space-y-2" style={{ overflow: 'hidden' }}>
            {/* 参数 */}
            {toolCall.input && Object.keys(toolCall.input).length > 0 && (
              <div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '2px', fontFamily: "'Inter Tight', sans-serif", textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  参数
                </div>
                <div className="rounded-lg p-2.5 overflow-hidden" style={{
                  border: '1px solid var(--border-color)',
                  background: 'var(--code-bg)',
                  maxHeight: debugMode ? '300px' : '150px', overflowY: 'auto',
                }}>
                  <pre style={{
                    fontSize: '11px',
                    fontFamily: "'JetBrains Mono', 'Cascadia Code', monospace",
                    color: 'var(--text-primary)',
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}>
                    {debugMode ? JSON.stringify(toolCall.input, null, 2) : (summary || '无参数')}
                  </pre>
                </div>
              </div>
            )}
            {/* 子工具 */}
            {toolCall.children && toolCall.children.length > 0 && (
              <div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '2px', fontFamily: "'Inter Tight', sans-serif", textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  子工具 ({toolCall.children.length})
                </div>
                {toolCall.children.map((child, i) => (
                  <ToolCallCard key={child.id || i} toolCall={child} nested />
                ))}
              </div>
            )}
            {/* 结果 */}
            {toolCall.result && (
              <div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '2px', fontFamily: "'Inter Tight', sans-serif", textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  结果
                </div>
                <div className="rounded-lg p-2.5 overflow-hidden" style={{
                  border: `1px solid ${isError ? 'rgba(240,71,86,0.2)' : 'var(--border-color)'}`,
                  background: 'var(--code-bg)',
                  maxHeight: debugMode ? '500px' : '200px', overflowY: 'auto',
                }}>
                  <pre style={{
                    fontSize: '11px',
                    fontFamily: "'JetBrains Mono', 'Cascadia Code', monospace",
                    color: 'var(--text-primary)',
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}>
                    {toolCall.result}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
