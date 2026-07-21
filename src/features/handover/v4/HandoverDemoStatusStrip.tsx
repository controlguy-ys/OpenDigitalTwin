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
  const step = useStore(store, (state) => state.step)
  const partOwner = useStore(store, (state) => state.partOwner)
  const sharedZoneOwner = useStore(store, (state) => state.sharedZoneOwner)
  const failureCode = useStore(store, (state) => state.failureCode)

  return (
    <p
      aria-label="Handover demo status"
      className="handover-demo-status-strip-v4"
      role="status"
    >
      <span>Step {step}</span>
      {' | '}
      <span>Part {partOwner}</span>
      {' | '}
      <span>Shared Zone {sharedZoneOwner}</span>
      {failureCode === null
        ? null
        : <>{' | '}<span className="handover-demo-status-failure-v4">Failure {failureCode}</span></>}
    </p>
  )
}
