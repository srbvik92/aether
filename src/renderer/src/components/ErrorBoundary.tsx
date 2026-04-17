import { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  name?: string
}

interface State {
  hasError: boolean
  error:    Error | null
  info:     string
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, info: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const info = errorInfo.componentStack ?? ''
    this.setState({ info })
    // Log to analytics if available
    try {
      const event = { type: 'react_error', component: this.props.name ?? 'unknown', message: error.message, stack: error.stack?.slice(0, 500), componentStack: info.slice(0, 500), timestamp: new Date().toISOString() }
      const existing = JSON.parse(localStorage.getItem('__app_error_log') ?? '[]')
      existing.push(event)
      // Keep last 50 errors
      if (existing.length > 50) existing.splice(0, existing.length - 50)
      localStorage.setItem('__app_error_log', JSON.stringify(existing))
    } catch { /* ignore storage errors */ }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, info: '' })
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div className="flex flex-col items-center justify-center h-full p-8 bg-gray-50 dark:bg-gray-950 text-center">
          <div className="w-16 h-16 rounded-2xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            Something went wrong
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-1 max-w-md">
            {this.props.name ? `The ${this.props.name} component` : 'A component'} encountered an error.
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-600 mb-6 max-w-md font-mono">
            {this.state.error?.message ?? 'Unknown error'}
          </p>
          <div className="flex gap-3">
            <button
              onClick={this.handleReset}
              className="px-4 py-2 text-sm font-medium rounded-xl bg-blue-500 text-white hover:bg-blue-600 transition-colors"
            >
              Try again
            </button>
            <button
              onClick={this.handleReload}
              className="px-4 py-2 text-sm font-medium rounded-xl border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              Reload app
            </button>
          </div>

          {/* Collapsible details */}
          <details className="mt-6 w-full max-w-lg text-left">
            <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600 dark:hover:text-gray-300">
              Technical details
            </summary>
            <pre className="mt-2 p-3 text-[10px] bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-auto max-h-40 text-gray-500 dark:text-gray-400 whitespace-pre-wrap">
{this.state.error?.stack ?? 'No stack trace'}

{this.state.info ? `\nComponent stack:${this.state.info}` : ''}
            </pre>
          </details>
        </div>
      )
    }

    return this.props.children
  }
}
