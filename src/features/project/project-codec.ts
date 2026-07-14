import type { WorkcellProjectSnapshotV3 } from '../../domain/project/project-v3'
import {
  decodeWorkcellProjectV3,
  encodeWorkcellProjectV3,
  type ProjectArchiveDecodeOptions,
  type ProjectArchiveEncodeOptions,
  type ProjectDecodeResultV3,
} from './project-v3-archive'

export type {
  ArchivedObjectAssetRecordV3,
  ArchivedStepObjectAssetRecordV3,
  ProjectArchiveDecodeOptions,
  ProjectArchiveEncodeOptions,
  ProjectDecodeResultV3,
} from './project-v3-archive'
export { revokeProjectDecodeResult } from './project-v3-archive'

export function encodeWorkcellProject(
  snapshot: WorkcellProjectSnapshotV3,
  options: ProjectArchiveEncodeOptions = {},
  signal?: AbortSignal,
): Promise<Blob> {
  return encodeWorkcellProjectV3(snapshot, options, signal)
}

export function decodeWorkcellProject(
  source: Blob | Uint8Array | ArrayBuffer,
  options: ProjectArchiveDecodeOptions,
  signal?: AbortSignal,
): Promise<ProjectDecodeResultV3> {
  return decodeWorkcellProjectV3(source, options, signal)
}
