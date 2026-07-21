import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'
import type { ReactNode } from 'react'

import type { HandoverDemoRuntimeStateV4 } from './handover-demo-runtime-store.js'

export interface HandoverDemoStatusStripPropsV4 {
  readonly store: StoreApi<HandoverDemoRuntimeStateV4>
}

export function HandoverDemoStatusStripV4({
  store,
}: HandoverDemoStatusStripPropsV4): ReactNode {
  const state = useStore(store)

  return (
    <p
      aria-label="Handover demo status"
      className="handover-demo-status-strip-v4"
      role="status"
    >
      <span>Step {state.step}</span>
      {' | '}
      <span>Part {state.partOwner}</span>
      {' | '}
      <span>Shared Zone {state.sharedZoneOwner}</span>
      {state.failureCode === null
        ? null
        : <>{' | '}<span className="handover-demo-status-failure-v4">Failure {state.failureCode}</span></>}
    </p>
  )
}
