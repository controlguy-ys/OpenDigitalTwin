import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { createShellLayoutStoreV4 } from './shell-layout-store.js'
import { initialShellLayoutBoundsV4 } from './shell-layout-geometry.js'
import { createShellLayoutControllerV4 } from './shell-layout-controller.js'
import { useShellLayoutObserverV4 } from './use-shell-layout-observer.js'

class TestResizeObserver {
  static instances: TestResizeObserver[] = []
  readonly observe = vi.fn()
  readonly disconnect = vi.fn()
  readonly callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    TestResizeObserver.instances.push(this)
  }
  deliver(width: number, height: number) {
    this.callback([{ contentRect: { width, height } } as ResizeObserverEntry], this as unknown as ResizeObserver)
  }
}

function Harness({ controller }: { controller: ReturnType<typeof createShellLayoutControllerV4> }) {
  const { workspaceRef, snapshot } = useShellLayoutObserverV4(controller)
  return <div data-layout-mode={snapshot.mode} data-testid="shell-root"><section className="studio-workspace" ref={workspaceRef} /></div>
}

function controller() {
  return createShellLayoutControllerV4({
    preferencesStore: createShellLayoutStoreV4({ storage: null }),
    initialBounds: initialShellLayoutBoundsV4(1440, 900),
  })
}

describe('useShellLayoutObserverV4', () => {
  it('observes the workspace, forwards CSS-pixel bounds, and exposes the resulting mode', () => {
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    const layout = controller()
    render(<Harness controller={layout} />)
    const observer = TestResizeObserver.instances.at(-1)!
    expect(observer.observe).toHaveBeenCalledWith(document.querySelector('.studio-workspace'))
    act(() => observer.deliver(959, 777))
    expect(screen.getByTestId('shell-root')).toHaveAttribute('data-layout-mode', 'narrow')
    expect(layout.getState().bounds.workspaceHeightPx).toBe(777)
  })

  it('disconnects on unmount and safely does nothing when ResizeObserver is unavailable', () => {
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    const layout = controller()
    const view = render(<Harness controller={layout} />)
    const observer = TestResizeObserver.instances.at(-1)!
    view.unmount()
    expect(observer.disconnect).toHaveBeenCalledOnce()

    vi.stubGlobal('ResizeObserver', undefined)
    expect(() => render(<Harness controller={controller()} />)).not.toThrow()
  })
})
