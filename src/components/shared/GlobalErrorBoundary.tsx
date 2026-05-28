import React, { Component, ErrorInfo, ReactNode } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, RefreshCcw, Home } from 'lucide-react';
import { IslandButton } from './AnimalPrimitives';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * 工业级全局错误边界组件
 * 用于捕获 React 组件树中的运行时错误，防止整页白屏。
 */
export class GlobalErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    // 更新 state 使下一次渲染能够显示降级 UI
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // 在这里可以接入 Sentry, LogRocket 等外部监控系统
    console.error('Unhandled React Error:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  private handleGoHome = () => {
    this.setState({ hasError: false, error: null });
    window.location.assign('/app/home');
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen px-6 py-20 flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass max-w-xl w-full rounded-[32px] p-10 text-center jelly-shadow border border-white/70"
          >
            <div className="mx-auto w-16 h-16 bg-apple-red/10 rounded-2xl flex items-center justify-center mb-6">
              <AlertCircle className="w-8 h-8 text-apple-red" />
            </div>
            
            <h1 className="text-3xl font-black text-text-primary tracking-tight">这页刚才出错了</h1>
            <p className="mt-4 text-text-secondary leading-7">
              页面遇到错误。学习进度通常会自动保存，可以刷新后再试。
            </p>

            {process.env.NODE_ENV === 'development' && this.state.error && (
              <div className="mt-6 p-4 bg-black/5 rounded-2xl text-left font-mono text-xs overflow-auto max-h-40 text-apple-red">
                {this.state.error.stack}
              </div>
            )}

            <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
              <IslandButton
                onClick={this.handleReset}
                tone="mint"
                size="large"
                icon={<RefreshCcw className="w-5 h-5" />}
              >
                刷新后重试
              </IslandButton>
              <IslandButton
                onClick={this.handleGoHome}
                tone="neutral"
                size="large"
                icon={<Home className="w-5 h-5" />}
              >
                回到首页
              </IslandButton>
            </div>
          </motion.div>
        </div>
      );
    }

    return this.props.children;
  }
}
