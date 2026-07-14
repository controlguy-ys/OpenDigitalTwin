import {
  createProjectSourceMigrationFoundationInternalV1,
  type LegacyProjectSourceAnalysisV1,
  type PreparedProjectSourceV1,
  type ProjectSourceLockedLeaseWorkerV1,
  type ProjectSourceNamespaceV1,
  type ProjectSourceStagingServiceOptionsV1,
} from './project-v3'

export interface ProjectSourceStagingTestServiceV1 {
  stage(
    namespace: ProjectSourceNamespaceV1,
    bytes: ArrayBuffer,
    signal?: AbortSignal,
  ): Promise<PreparedProjectSourceV1>
  assertPrepared(source: PreparedProjectSourceV1): void
  revoke(source: PreparedProjectSourceV1): void
  analyzeLegacyRobotSource(
    source: PreparedProjectSourceV1,
    signal?: AbortSignal,
  ): Promise<LegacyProjectSourceAnalysisV1>
}

export interface ProjectSourceStagingTestServiceOptionsV1
  extends ProjectSourceStagingServiceOptionsV1 {
  readonly lockedLegacyAnalyzer: ProjectSourceLockedLeaseWorkerV1
}

/**
 * Adversarial lease harness. The registered canonical service stays enclosed;
 * this frozen facade is deliberately absent from the registry, so passing it
 * to a Project finalization path is rejected.
 */
export function createProjectSourceStagingTestServiceV1(
  options: ProjectSourceStagingTestServiceOptionsV1,
): ProjectSourceStagingTestServiceV1 {
  const canonical = createProjectSourceMigrationFoundationInternalV1(options).sourceStaging
  return Object.freeze({
    stage: canonical.stage,
    assertPrepared: canonical.assertPrepared,
    revoke: canonical.revoke,
    analyzeLegacyRobotSource: canonical.analyzeLegacyRobotSource.bind(canonical),
  })
}
