import {
  validateWorkcellProjectV5,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'

export interface DefaultProjectV5Dependencies {
  readonly createProjectId: () => string
  readonly createRevisionId: () => string
  readonly nowIso: () => string
}

function identityPose() {
  return { positionM: [0, 0, 0] as const, quaternion: [0, 0, 0, 1] as const }
}

export function createDefaultProjectV5(dependencies: DefaultProjectV5Dependencies): WorkcellProjectV5 {
  const now = dependencies.nowIso()
  return validateWorkcellProjectV5({
    schemaVersion: 5,
    projectId: dependencies.createProjectId(),
    revisionId: dependencies.createRevisionId(),
    metadata: { name: 'Untitled Workcell', createdAt: now, updatedAt: now },
    assetReferences: [],
    scene: {
      frames: [
        { id: 'world', name: 'World', parentFrameId: null, localPose: identityPose(), role: 'world' },
        { id: 'mcp', name: 'MCP', parentFrameId: 'world', localPose: identityPose(), role: 'mcp' },
      ],
    },
    robotDefinitions: [],
    controllers: [],
    robots: [],
    spatialEntities: [],
    sceneGroups: [],
    logicalSignals: [],
    jobs: [],
    opcUa: { mode: 'off', endpoints: [], mappings: [], bridgeRoutes: [] },
  })
}
