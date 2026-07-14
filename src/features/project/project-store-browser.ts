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

export function useProjectStore<T>(selector: (state: ProjectStoreState) => T): T {
  return useStore(projectStore, selector)
}
