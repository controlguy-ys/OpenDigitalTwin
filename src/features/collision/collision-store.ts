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

export interface CollisionStateSnapshot {
  readonly policy: CollisionPolicy
  readonly currentFindings: readonly CollisionFinding[]
  readonly diagnostics: readonly CollisionDiagnostic[]
}

export interface CollisionValidationReport {
  readonly revision: string
  readonly sampleCount: number
  readonly findings: readonly CollisionFinding[]
  readonly truncated: boolean
}

export interface CollisionStoreState extends CollisionStateSnapshot {
  readonly validationReport: CollisionValidationReport | null
  readonly validationReportStale: boolean
  readonly validationReportError: string | null
  readonly selectedFindingIndex: number | null
  readonly selectedFindingKey: string | null
  readonly pausePlaybackOnCollision: boolean
  replaceCollisionState(snapshot: CollisionStateSnapshot): void
  setCollisionEnabled(enabled: boolean): void
  setWarningDistanceM(distanceM: number): void
  ignorePair(candidatePairKey: string): void
  restorePair(candidatePairKey: string): void
  setValidationReport(report: CollisionValidationReport | null): void
  markValidationReportStale(error?: string): void
  setSelectedFindingIndex(index: number | null): void
  setPausePlaybackOnCollision(enabled: boolean): void
}

function ownedSnapshot(snapshot: CollisionStateSnapshot): CollisionStateSnapshot {
  return {
    policy: validateCollisionPolicy(snapshot.policy),
    currentFindings: Object.freeze(
      snapshot.currentFindings.map(validateCollisionFinding),
    ),
    diagnostics: Object.freeze(
      snapshot.diagnostics.map(validateCollisionDiagnostic),
    ),
  }
}

function createInitialSnapshot(): CollisionStateSnapshot {
  return ownedSnapshot({
    policy: DEFAULT_COLLISION_POLICY,
    currentFindings: [],
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
    finding.firstEntityId,
    finding.secondEntityId,
    finding.firstBoxId,
    finding.secondBoxId,
    finding.kind,
    finding.separationM,
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
  if (selectedFindingKey !== null) {
    const preservedIndex = findings.findIndex(
      (finding) => collisionFindingKey(finding) === selectedFindingKey,
    )
    if (preservedIndex >= 0) {
      return { selectedFindingIndex: preservedIndex, selectedFindingKey }
    }
    return {
      selectedFindingIndex: 0,
      selectedFindingKey: collisionFindingKey(findings[0]!),
    }
  }
  const index = fallbackIndex ?? 0
  if (!Number.isInteger(index)) {
    throw new Error('Selected collision finding index must be an integer.')
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
    validationReport: null,
    validationReportStale: false,
    validationReportError: null,
    selectedFindingIndex: null,
    selectedFindingKey: null,
    pausePlaybackOnCollision: true,
    replaceCollisionState: (candidate) => {
      const snapshot = ownedSnapshot(candidate)
      set((state) => ({
        ...snapshot,
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
