import { useMemo } from 'react'
import {
  encodeCollisionReportCsv,
  encodeCollisionReportJson,
} from './collision-report'
import {
  selectCollisionNavigationFindings,
  useCollisionStore,
} from './collision-store'

function downloadText(fileName: string, type: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const anchor = document.createElement('a')
  anchor.download = fileName
  anchor.href = url
  anchor.click()
  URL.revokeObjectURL(url)
}

function clearanceText(separationM: number): string {
  return `${(separationM * 1_000).toFixed(3)} mm`
}

export function CollisionPanel() {
  const policy = useCollisionStore((state) => state.policy)
  const currentFindings = useCollisionStore((state) => state.currentFindings)
  const diagnostics = useCollisionStore((state) => state.diagnostics)
  const navigationFindings = useCollisionStore(
    selectCollisionNavigationFindings,
  )
  const selectedFindingIndex = useCollisionStore(
    (state) => state.selectedFindingIndex,
  )
  const pausePlaybackOnCollision = useCollisionStore(
    (state) => state.pausePlaybackOnCollision,
  )
  const reportStale = useCollisionStore(
    (state) => state.validationReportStale,
  )
  const reportError = useCollisionStore(
    (state) => state.validationReportError,
  )
  const setCollisionEnabled = useCollisionStore(
    (state) => state.setCollisionEnabled,
  )
  const setWarningDistanceM = useCollisionStore(
    (state) => state.setWarningDistanceM,
  )
  const ignorePair = useCollisionStore((state) => state.ignorePair)
  const restorePair = useCollisionStore((state) => state.restorePair)
  const setSelectedFindingIndex = useCollisionStore(
    (state) => state.setSelectedFindingIndex,
  )
  const setPausePlaybackOnCollision = useCollisionStore(
    (state) => state.setPausePlaybackOnCollision,
  )

  const counts = useMemo(
    () => ({
      collisions: currentFindings.filter(({ kind }) => kind === 'collision')
        .length,
      nearMisses: currentFindings.filter(({ kind }) => kind === 'near-miss')
        .length,
    }),
    [currentFindings],
  )
  const normalizedIndex =
    navigationFindings.length === 0
      ? null
      : Math.min(selectedFindingIndex ?? 0, navigationFindings.length - 1)
  const selectedFinding =
    normalizedIndex === null ? null : navigationFindings[normalizedIndex] ?? null

  return (
    <section aria-labelledby="collision-panel-heading" className="collision-panel">
      <header className="collision-panel-header">
        <h2 id="collision-panel-heading">Geometry Proxy Collision</h2>
        <div aria-label="Live collision counts" className="collision-counts">
          <span data-kind="collision">Collision {counts.collisions}</span>
          <span data-kind="near-miss">Near-miss {counts.nearMisses}</span>
        </div>
      </header>

      <div className="collision-policy-controls">
        <label>
          <input
            checked={policy.enabled}
            onChange={(event) => setCollisionEnabled(event.currentTarget.checked)}
            type="checkbox"
          />
          Enable geometry collision validation
        </label>
        <label>
          Warning distance (mm)
          <input
            aria-label="Warning distance (mm)"
            min={0}
            onChange={(event) =>
              setWarningDistanceM(Number(event.currentTarget.value) / 1_000)
            }
            step="1"
            type="number"
            value={policy.warningDistanceM * 1_000}
          />
        </label>
        <label>
          <input
            checked={pausePlaybackOnCollision}
            onChange={(event) =>
              setPausePlaybackOnCollision(event.currentTarget.checked)
            }
            type="checkbox"
          />
          Pause Simulation playback on collision
        </label>
      </div>

      <div className="collision-finding-navigation">
        <div className="collision-navigation-buttons">
          <button
            aria-label="First finding"
            disabled={normalizedIndex === null || normalizedIndex === 0}
            onClick={() => setSelectedFindingIndex(0)}
            type="button"
          >
            First
          </button>
          <button
            aria-label="Previous finding"
            disabled={normalizedIndex === null || normalizedIndex === 0}
            onClick={() => setSelectedFindingIndex((normalizedIndex ?? 0) - 1)}
            type="button"
          >
            Previous
          </button>
          <output aria-live="polite">
            {normalizedIndex === null
              ? 'No findings'
              : `Finding ${normalizedIndex + 1} of ${navigationFindings.length}`}
          </output>
          <button
            aria-label="Next finding"
            disabled={
              normalizedIndex === null ||
              normalizedIndex >= navigationFindings.length - 1
            }
            onClick={() => setSelectedFindingIndex((normalizedIndex ?? 0) + 1)}
            type="button"
          >
            Next
          </button>
        </div>

        {selectedFinding === null ? null : (
          <article
            aria-label={`Finding ${normalizedIndex! + 1}`}
            className="collision-finding"
            data-kind={selectedFinding.kind}
          >
            <strong>{selectedFinding.kind === 'collision' ? 'Collision' : 'Near-miss'}</strong>
            <code>{selectedFinding.pairKey}</code>
            <span>Approximate Clearance</span>
            <output>{clearanceText(selectedFinding.separationM)}</output>
            <button
              aria-label={`Ignore ${selectedFinding.firstEntityId} and ${selectedFinding.secondEntityId}`}
              disabled={policy.ignoredPairKeys.includes(selectedFinding.pairKey)}
              onClick={() => ignorePair(selectedFinding.pairKey)}
              type="button"
            >
              Ignore Pair
            </button>
          </article>
        )}
      </div>

      {policy.ignoredPairKeys.length === 0 ? null : (
        <div className="collision-ignored-pairs">
          <strong>Ignored pairs</strong>
          <ul aria-label="Ignored collision pairs">
            {policy.ignoredPairKeys.map((ignoredPair) => (
              <li key={ignoredPair}>
                <code>{ignoredPair}</code>
                <button
                  aria-label={`Restore ${ignoredPair}`}
                  onClick={() => restorePair(ignoredPair)}
                  type="button"
                >
                  Restore Pair
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {diagnostics.length === 0 && !reportStale ? null : (
        <div className="collision-diagnostics" role="status">
          {reportStale ? (
            <p>
              Validation report is stale.
              {reportError === null ? '' : ` ${reportError}`}
            </p>
          ) : null}
          {diagnostics.length === 0 ? null : (
            <ul aria-label="Collision diagnostics">
              {diagnostics.map((diagnostic, index) => (
                <li key={`${diagnostic.entityId}-${index}`}>
                  {diagnostic.entityId}: {diagnostic.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <footer className="collision-panel-footer">
        <div>
          <button
            aria-label="Download JSON report"
            onClick={() =>
              downloadText(
                'geometry-proxy-collision.json',
                'application/json',
                encodeCollisionReportJson(navigationFindings),
              )
            }
            type="button"
          >
            JSON
          </button>
          <button
            aria-label="Download CSV report"
            onClick={() =>
              downloadText(
                'geometry-proxy-collision.csv',
                'text/csv;charset=utf-8',
                encodeCollisionReportCsv(navigationFindings),
              )
            }
            type="button"
          >
            CSV
          </button>
        </div>
        <p>
          Proxy results are not physics, RobotWare, SafeMove, or safety-rated
          validation.
        </p>
      </footer>
    </section>
  )
}
