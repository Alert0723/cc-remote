/**
 * Markdown 渲染器
 * 支持 GFM、代码高亮，适配 CC Remote 设计系统
 */

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';

interface MarkdownRendererProps {
  content: string;
}

/**
 * 通用消息内容清理：提取 XML 标签内的文本，去掉标签包裹。
 * 系统标签（含连字符的复合标签名）→ 保留内容；普通单词标签 → 不处理（可能是 Markdown HTML）。
 *
 * <command-name>/clear</command-name> → /clear
 * <system-reminder>text</system-reminder> → 移除
 * <local-command-stdout>...</local-command-stdout> → 移除
 */
function cleanMessageContent(text: string): string {
  return text
    // 移除纯系统标签及其内容（不需要显示的部分）
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '')
    .replace(/<system-note>[\s\S]*?<\/system-note>/gi, '')
    .replace(/<task-notification>[\s\S]*?<\/task-notification>/gi, '')
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/gi, '')
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/gi, '')
    // 系统标签：提取内容，去掉标签包裹
    .replace(/<command-name>([^<]*)<\/command-name>/gi, '$1')
    .replace(/<command-message>([^<]*)<\/command-message>/gi, '')
    .replace(/<command-args>([^<]*)<\/command-args>/gi, '')
    .trim();
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const cleaned = cleanMessageContent(content);

  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const isInline = !match;

            return isInline ? (
              <code
                style={{
                  background: 'var(--inline-code-bg)',
                  color: 'var(--inline-code-text)',
                  padding: '0.15em 0.4em',
                  borderRadius: '4px',
                  fontSize: '0.85em',
                  fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
                  fontWeight: 500,
                }}
                {...props}
              >
                {children}
              </code>
            ) : (
              <code
                className={className}
                style={{
                  display: 'block',
                  padding: '1rem 1.25rem',
                  overflowX: 'auto',
                  fontSize: '13px',
                  lineHeight: 1.55,
                  fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
                }}
                {...props}
              >
                {children}
              </code>
            );
          },
          table({ children }) {
            return (
              <div className="table-wrapper">
                <table>{children}</table>
              </div>
            );
          },
          pre({ children }) {
            return (
              <pre
                style={{
                  background: 'var(--code-bg)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '10px',
                  margin: '0.6rem 0',
                  overflowX: 'auto',
                }}
              >
                {children}
              </pre>
            );
          },
        }}
      >
        {cleaned}
      </ReactMarkdown>
    </div>
  );
}
