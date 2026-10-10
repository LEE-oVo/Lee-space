import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: string | null;
}

/**
 * 全局错误边界：任意页面渲染出错时，只降级该区域并展示错误详情，
 * 避免整棵 React 树被卸载导致「全黑无内容」。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ info: String(info.componentStack || '').split('\n').slice(0, 6).join('\n') });
    // 便于线上排查
    console.error('[workbench] 页面渲染出错:', error);
  }

  render(): ReactNode {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="page" style={{ paddingTop: 8 }}>
        <div className="card">
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>这个页面出错了</div>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            其余功能不受影响，可通过左侧菜单继续操作。下面是错误详情：
          </p>
          <div className="log-view" style={{ marginTop: 10 }}>
            {error.name}: {error.message}
            {info ? `\n${info}` : ''}
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={() => this.setState({ error: null, info: null })}>
              重试
            </button>
            <button className="btn" onClick={() => window.location.reload()}>
              刷新页面
            </button>
          </div>
        </div>
      </div>
    );
  }
}
