import { useStore } from 'zustand'
import { stageProjectSourcesV3 } from '../../domain/project/project-v3'
import {
  createProjectHashService,
  createProjectRevisionIdentityHasher,
  createProjectSourceDigest,
} from '../../lib/hash/sha256'
import { browserProjectRuntime } from './browser-project-runtime'
import { decodeWorkcellProject, encodeWorkcellProject } from './project-codec'
import { projectDb } from './project-db'
import { createProjectMutationService } from './project-mutation-service'
import { createProjectPublicationCoordinator } from './project-publication-coordinator'
import { createProjectRevisionFoundation } from './project-revision-repository'
import { createProjectStore, type ProjectStoreState } from './project-store'
import { createSceneCommandService } from '../scene/scene-command-service'
import { createSceneEditorStore } from '../scene/scene-editor-store'
import { useInteractionStore } from '../interaction/interaction-store'
import { operationFeedbackStore } from '../ui/OperationFeedback'

const hashService = createProjectHashService({ subtle: crypto.subtle })
const revisionIdentityHasher = createProjectRevisionIdentityHasher(hashService)
const foundation = createProjectRevisionFoundation({
  database: projectDb,
  revisionIdentityHasher,
  sourceHashService: hashService,
  sourceStagingOptions: {
    sourceDigest: createProjectSourceDigest(hashService),
  },
})

export const projectPublicationCoordinator = createProjectPublicationCoordinator({
  repository: foundation.repository,
  runtime: browserProjectRuntime,
})

export const projectMutationService = createProjectMutationService({
  repository: foundation.repository,
  sourceStaging: foundation.sourceStaging,
  coordinator: projectPublicationCoordinator,
})

export const projectStore = createProjectStore({
  mutationService: projectMutationService,
  createNew: () => browserProjectRuntime.createNew(),
  stageNew: async (snapshot) => ({
    ...await stageProjectSourcesV3(
      snapshot,
      foundation.sourceStaging,
      revisionIdentityHasher,
    ),
    warnings: [],
  }),
  decode: (source) => decodeWorkcellProject(source, {
    sourceStaging: foundation.sourceStaging,
    projectRevisionIdentityHasher: revisionIdentityHasher,
  }),
  encode: (snapshot) => encodeWorkcellProject(snapshot, {
    projectRevisionIdentityHasher: revisionIdentityHasher,
  }),
})

export const sceneCommandService = createSceneCommandService({
  mutationService: projectMutationService,
  getHeldEntityId: () => useInteractionStore.getState().heldEntityId,
  stageStepSource: async (sourceBytes, ownerKey) => {
    const preparedSource = await foundation.sourceStaging.stage('object', sourceBytes)
    return {
      sourceSha256: preparedSource.sha256,
      preparedSourceGroup: Object.freeze({
        ownerKeys: Object.freeze([ownerKey]),
        preparedSource,
      }),
    }
  },
  onWarning: (warning) => {
    operationFeedbackStore.getState().publishResourceWarning(warning)
    console.warn(`${warning.code}: ${warning.current} of ${warning.limit}`)
  },
})

export const sceneEditorStore = createSceneEditorStore({
  mutationService: projectMutationService,
  setWorldPose: sceneCommandService.setWorldPose,
})

export function useProjectStore<T>(selector: (state: ProjectStoreState) => T): T {
  return useStore(projectStore, selector)
}
