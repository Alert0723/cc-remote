/**
 * 错误边界组件
 * 捕获渲染树中的未处理异常，防止"全黑"白屏
 */
import React, { Component } from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] 渲染异常:', error.message, info.componentStack);
    // 尝试持久化错误信息供排查
    try {
      localStorage.setItem('cc-last-error', JSON.stringify({
        message: error.message,
        stack: error.stack?.slice(0, 500),
        time: Date.now(),
      }));
    } catch {}
  }

  handleRetry = () => {
    // 清除错误状态，尝试重新渲染
    this.setState({ hasError: false, error: undefined });
    localStorage.removeItem('cc-last-error');
    window.location.reload();
  };

  handleReset = () => {
    // 清除 local 缓存状态，完全重置
    try {
      localStorage.removeItem('cc-remote-theme');
      localStorage.removeItem('cc-current-session');
      localStorage.removeItem('cc-shown-questions');
      localStorage.removeItem('cc-question-answered');
      localStorage.removeItem('cc-last-error');
    } catch {}
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100dvh',
            padding: '24px',
            background: 'var(--bg-primary, #161411)',
            color: 'var(--text-primary, #E8E4E0)',
            fontFamily: "'Inter', -apple-system, sans-serif",
            textAlign: 'center',
            gap: '16px',
          }}
        >
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              background: 'rgba(239,68,68,0.12)',
              color: '#EF4444',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '22px',
            }}
          >
            !
          </div>
          <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>
            页面加载异常
          </h2>
          <p style={{
            fontSize: '13px',
            color: 'var(--text-secondary, #95908A)',
            maxWidth: '280px',
            lineHeight: 1.5,
            margin: 0,
          }}>
            应用在渲染过程中遇到了未预期的错误。请尝试刷新页面或重置应用状态。
          </p>
          {this.state.error && (
            <code style={{
              fontSize: '11px',
              color: 'var(--text-muted, #615D58)',
              background: 'var(--bg-tertiary, #22201C)',
              padding: '8px 12px',
              borderRadius: '8px',
              maxWidth: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              {this.state.error.message}
            </code>
          )}
          <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
            <button
              onClick={this.handleRetry}
              style={{
                padding: '10px 24px',
                borderRadius: '10px',
                border: 'none',
                background: 'var(--accent, #D77757)',
                color: '#fff',
                fontSize: '14px',
                fontWeight: 600,
                fontFamily: "'Inter', sans-serif",
                cursor: 'pointer',
              }}
            >
              刷新页面
            </button>
            <button
              onClick={this.handleReset}
              style={{
                padding: '10px 24px',
                borderRadius: '10px',
                border: '1px solid var(--border-color, rgba(255,255,255,0.07))',
                background: 'transparent',
                color: 'var(--text-secondary, #95908A)',
                fontSize: '14px',
                fontWeight: 500,
                fontFamily: "'Inter', sans-serif",
                cursor: 'pointer',
              }}
            >
              重置应用
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
