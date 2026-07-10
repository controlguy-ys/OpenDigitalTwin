import { Component, type ReactNode } from 'react'

interface SceneErrorBoundaryProps {
  children: ReactNode
  formatError?: (error: Error) => string
  onError?: (error: Error) => void
  onRetry: () => void
}

interface SceneErrorBoundaryState {
  error: Error | null
}

export class SceneErrorBoundary extends Component<
  SceneErrorBoundaryProps,
  SceneErrorBoundaryState
> {
  state: SceneErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): SceneErrorBoundaryState {
    return {
      error: error instanceof Error ? error : new Error(String(error)),
    }
  }

  componentDidCatch(error: Error): void {
    this.props.onError?.(error)
  }

  render(): ReactNode {
    const { children, formatError, onRetry } = this.props
    const { error } = this.state

    if (error === null) {
      return children
    }

    return (
      <section className="scene-status scene-error" role="alert">
        <h2>3D renderer unavailable</h2>
        <p>{formatError?.(error) ?? error.message}</p>
        <button onClick={onRetry} type="button">
          Retry
        </button>
      </section>
    )
  }
}
