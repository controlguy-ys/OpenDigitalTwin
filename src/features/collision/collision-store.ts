import { create } from 'zustand'
import { createStore } from 'zustand/vanilla'
import {
  DEFAULT_COLLISION_POLICY,
  pairKey,
  validateCollisionDiagnostic,
  validateCollisionFinding,
  validateCollisionPolicy,
  type CollisionDiagnostic,
  type CollisionFinding,
  type CollisionPolicy,
} from '../../domain/collision/collision'
import type {
  CollisionQueryTelemetry,
  MountContactState,
} from '../../domain/collision/query-collision'

export interface CollisionStateSnapshot {
  readonly policy: CollisionPolicy
  readonly currentFindings: readonly CollisionFinding[]
  readonly mountContact?: MountContactState | null
  readonly diagnostics: readonly CollisionDiagnostic[]
}

export interface CollisionValidationReport {
  readonly revision: string
  readonly sampleCount: number
  readonly findings: readonly CollisionFinding[]
  readonly truncated: boolean
}

export interface CollisionStoreState extends CollisionStateSnapshot {
  readonly mountContact: MountContactState | null
  readonly latestTelemetry: CollisionQueryTelemetry | null
  readonly validationReport: CollisionValidationReport | null
  readonly validationReportStale: boolean
  readonly validationReportError: string | null
  readonly selectedFindingIndex: number | null
  readonly selectedFindingKey: string | null
  readonly pausePlaybackOnCollision: boolean
  replaceCollisionState(
    snapshot: CollisionStateSnapshot,
    telemetry?: CollisionQueryTelemetry | null,
  ): void
  setCollisionEnabled(enabled: boolean): void
  setWarningDistanceM(distanceM: number): void
  ignorePair(candidatePairKey: string): void
  restorePair(candidatePairKey: string): void
  setValidationReport(report: CollisionValidationReport | null): void
  markValidationReportStale(error?: string): void
  setSelectedFindingIndex(index: number | null): void
  setPausePlaybackOnCollision(enabled: boolean): void
  setLatestTelemetry(telemetry: CollisionQueryTelemetry | null): void
}

function ownedTelemetry(
  telemetry: CollisionQueryTelemetry,
): CollisionQueryTelemetry {
  const values = [
    telemetry.entityCount,
    telemetry.boxCount,
    telemetry.broadPhaseCandidateCount,
    telemetry.narrowPhaseTestCount,
    telemetry.findingCount,
  ]
  if (values.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new Error('Collision telemetry counts must be non-negative integers.')
  }
  return Object.freeze({ ...telemetry })
}

type OwnedCollisionStateSnapshot = CollisionStateSnapshot & {
  readonly mountContact: MountContactState | null
}

function ownedSnapshot(
  snapshot: CollisionStateSnapshot,
): OwnedCollisionStateSnapshot {
  return {
    policy: validateCollisionPolicy(snapshot.policy),
    currentFindings: Object.freeze(
      snapshot.currentFindings.map(validateCollisionFinding),
    ),
    mountContact: snapshot.mountContact === undefined || snapshot.mountContact === null
      ? null
      : Object.freeze({ ...snapshot.mountContact }),
    diagnostics: Object.freeze(
      snapshot.diagnostics.map(validateCollisionDiagnostic),
    ),
  }
}

function createInitialSnapshot(): OwnedCollisionStateSnapshot {
  return ownedSnapshot({
    policy: DEFAULT_COLLISION_POLICY,
    currentFindings: [],
    mountContact: null,
    diagnostics: [],
  })
}

function canonicalPairKey(candidate: string): string {
  const [first, second, extra] = candidate.split('|')
  if (first === undefined || second === undefined || extra !== undefined) {
    throw new Error('Collision pair must contain exactly two Entity ids.')
  }
  return pairKey(first, second)
}

function ownedValidationReport(
  report: CollisionValidationReport,
): CollisionValidationReport {
  if (report.revision.trim().length === 0) {
    throw new Error('Collision validation report revision must not be empty.')
  }
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new Error('Collision validation sample count must be non-negative.')
  }
  if (typeof report.truncated !== 'boolean') {
    throw new Error('Collision validation truncation flag must be boolean.')
  }
  return Object.freeze({
    revision: report.revision,
    sampleCount: report.sampleCount,
    findings: Object.freeze(report.findings.map(validateCollisionFinding)),
    truncated: report.truncated,
  })
}

export function collisionFindingKey(finding: CollisionFinding): string {
  return JSON.stringify([
    finding.pairKey,
    finding.firstEntityId,
    finding.secondEntityId,
    finding.firstBoxId,
    finding.secondBoxId,
    finding.kind,
    finding.sampleIndex,
    finding.timeMs,
  ])
}

function selectedFindingPatch(
  findings: readonly CollisionFinding[],
  selectedFindingKey: string | null,
  fallbackIndex: number | null,
): Pick<CollisionStoreState, 'selectedFindingIndex' | 'selectedFindingKey'> {
  if (findings.length === 0) {
    return { selectedFindingIndex: null, selectedFindingKey: null }
  }
  const index = fallbackIndex ?? 0
  if (!Number.isInteger(index)) {
    throw new Error('Selected collision finding index must be an integer.')
  }
  if (selectedFindingKey !== null) {
    const preservedIndex = findings.findIndex(
      (finding) => collisionFindingKey(finding) === selectedFindingKey,
    )
    if (preservedIndex >= 0) {
      return { selectedFindingIndex: preservedIndex, selectedFindingKey }
    }
  }
  const clampedIndex = Math.min(Math.max(index, 0), findings.length - 1)
  return {
    selectedFindingIndex: clampedIndex,
    selectedFindingKey: collisionFindingKey(findings[clampedIndex]!),
  }
}

function staleReportPatch(state: CollisionStoreState) {
  return state.validationReport === null
    ? {}
    : { validationReportStale: true, validationReportError: null }
}

function collisionStateCreator(
  set: (
    update:
      | Partial<CollisionStoreState>
      | ((state: CollisionStoreState) => Partial<CollisionStoreState>),
  ) => void,
  get: () => CollisionStoreState,
): CollisionStoreState {
  return {
    ...createInitialSnapshot(),
    latestTelemetry: null,
    validationReport: null,
    validationReportStale: false,
    validationReportError: null,
    selectedFindingIndex: null,
    selectedFindingKey: null,
    pausePlaybackOnCollision: true,
    setLatestTelemetry: (telemetry) => {
      set({ latestTelemetry: telemetry === null ? null : ownedTelemetry(telemetry) })
    },
    replaceCollisionState: (candidate, telemetry) => {
      const snapshot = ownedSnapshot(candidate)
      const telemetryPatch = telemetry === undefined
        ? {}
        : {
            latestTelemetry:
              telemetry === null ? null : ownedTelemetry(telemetry),
          }
      set((state) => ({
        ...snapshot,
        ...telemetryPatch,
        ...(state.validationReport === null
          ? selectedFindingPatch(
              snapshot.currentFindings,
              state.selectedFindingKey,
              state.selectedFindingIndex,
            )
          : {}),
      }))
    },
    setCollisionEnabled: (enabled) => {
      set((state) => ({
        policy: validateCollisionPolicy({ ...state.policy, enabled }),
        ...staleReportPatch(state),
      }))
    },
    setWarningDistanceM: (warningDistanceM) => {
      set((state) => ({
        policy: validateCollisionPolicy({
          ...state.policy,
          warningDistanceM,
        }),
        ...staleReportPatch(state),
      }))
    },
    ignorePair: (candidate) => {
      const canonical = canonicalPairKey(candidate)
      set((state) => ({
        policy: validateCollisionPolicy({
          ...state.policy,
          ignoredPairKeys: [...state.policy.ignoredPairKeys, canonical],
        }),
        ...staleReportPatch(state),
      }))
    },
    restorePair: (candidate) => {
      const canonical = canonicalPairKey(candidate)
      set((state) => ({
        policy: validateCollisionPolicy({
          ...state.policy,
          ignoredPairKeys: state.policy.ignoredPairKeys.filter(
            (value) => value !== canonical,
          ),
        }),
        ...staleReportPatch(state),
      }))
    },
    setValidationReport: (report) => {
      const owned = report === null ? null : ownedValidationReport(report)
      set((state) => ({
        validationReport: owned,
        validationReportStale: false,
        validationReportError: null,
        ...selectedFindingPatch(
          owned?.findings ?? state.currentFindings,
          state.selectedFindingKey,
          state.selectedFindingIndex,
        ),
      }))
    },
    markValidationReportStale: (error) => {
      if (error !== undefined && error.trim().length === 0) {
        throw new Error('Collision validation report error must not be empty.')
      }
      set((state) =>
        state.validationReport === null
          ? {}
          : {
              validationReportStale: true,
              validationReportError: error ?? null,
            },
      )
    },
    setSelectedFindingIndex: (index) => {
      const findings = selectCollisionNavigationFindings(get())
      if (index === null) {
        set({ selectedFindingIndex: null, selectedFindingKey: null })
        return
      }
      set(selectedFindingPatch(findings, null, index))
    },
    setPausePlaybackOnCollision: (enabled) => {
      if (typeof enabled !== 'boolean') {
        throw new Error('Collision playback pause setting must be boolean.')
      }
      set({ pausePlaybackOnCollision: enabled })
    },
  }
}

export function selectCollisionNavigationFindings(
  state: CollisionStoreState,
): readonly CollisionFinding[] {
  return state.validationReport?.findings ?? state.currentFindings
}

export function selectSelectedCollisionFinding(
  state: CollisionStoreState,
): CollisionFinding | null {
  const findings = selectCollisionNavigationFindings(state)
  const index = state.selectedFindingIndex
  return index === null ? null : findings[index] ?? null
}

export type CollisionOutlineKind = CollisionFinding['kind'] | null

export function createCollisionEntityOutlineSelector(entityId: string) {
  return (state: CollisionStoreState): CollisionOutlineKind => {
    const finding = selectSelectedCollisionFinding(state)
    return finding !== null &&
      (finding.firstEntityId === entityId || finding.secondEntityId === entityId)
      ? finding.kind
      : null
  }
}

export function createCollisionStore() {
  return createStore<CollisionStoreState>()(collisionStateCreator)
}

export const useCollisionStore = create<CollisionStoreState>()(
  collisionStateCreator,
)
