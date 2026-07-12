import type { WorkcellProjectSnapshotV1 } from '../../domain/project/project'
import { WORKCELL_PROJECT_FORMAT, WORKCELL_PROJECT_SCHEMA_VERSION } from '../../domain/project/project'
import { useRobotStore } from '../joints/robot-store'
import { stepImportClient } from '../import/StepImportClient'
import { ImportedGeometryRepository, importedGeometryRepository } from '../import/imported-geometry-repository'
import type { ImportedThreeAsset } from '../import/occt-to-three'
import { useObjectAssetStore } from '../objects/object-asset-store'
import { loadDefaultRobotGeometry } from '../robot/default-robot-geometry'
import { useRobotConfigurationStore } from '../robot/robot-configuration-store'
import { robotGeometryRepository } from '../robot/robot-geometry-repository'
import { useRobotGeometryStore } from '../robot/robot-geometry-store'
import { restoreRobotGeometryRecords } from '../robot/robot-step-import'
import type { ProjectRuntime } from './project-store'

interface BrowserStagedProject {
  robotAssets: ReadonlyMap<WorkcellProjectSnapshotV1['robot']['links'][number]['linkId'], ImportedThreeAsset>
  objectAssets: ReadonlyMap<string, ImportedThreeAsset>
  objectRepository: ImportedGeometryRepository
}

const DEFAULT_OPC_UA = {
  endpointUrl: 'opc.tcp://127.0.0.1:4840',
  samplingIntervalMs: 100,
  joints: (['J1', 'J2', 'J3', 'J4', 'J5', 'J6'] as const).map((id) => ({
    id,
    nodeId: `ns=2;s=Robot.${id}`,
    scale: 1,
    offset: 0,
  })),
  equipment: [],
}

const identityTransform = () => ({
  position: [0, 0, 0] as [number, number, number],
  quaternion: [0, 0, 0, 1] as [number, number, number, number],
  scale: [1, 1, 1] as [number, number, number],
})

export const browserProjectRuntime: ProjectRuntime<BrowserStagedProject> = {
  capture: async (previous) => {
    const now = new Date().toISOString()
    const configuration = useRobotConfigurationStore.getState().configuration
    const persistedLinks = useRobotGeometryStore.getState().links
    const links: WorkcellProjectSnapshotV1['robot']['links'] =
      persistedLinks.length === 0
        ? await loadDefaultRobotGeometry()
        : [...structuredClone(persistedLinks)]
    const objectState = useObjectAssetStore.getState()
    return {
      manifest: {
        format: WORKCELL_PROJECT_FORMAT,
        schemaVersion: WORKCELL_PROJECT_SCHEMA_VERSION,
        projectId: previous?.manifest.projectId ?? crypto.randomUUID(),
        name: previous?.manifest.name ?? 'Untitled Workcell',
        createdAt: previous?.manifest.createdAt ?? now,
        updatedAt: now,
      },
      robot: {
        name: configuration.name,
        basePosition: [...configuration.basePosition],
        baseRotationDeg: [...configuration.baseRotationDeg],
        links,
        joints: configuration.joints.map((joint) => ({
          ...joint,
          origin: [...joint.origin],
          axis: [...joint.axis],
        })),
      },
      frames: previous?.frames ?? {
        mcp: identityTransform(),
        tcp: identityTransform(),
      },
      objectAssets: [...structuredClone(objectState.assets)],
      objectInstances: [...structuredClone(objectState.instances)],
      poses: useRobotStore.getState().keyframes.map((pose) => ({
        ...pose,
        anglesDeg: [...pose.anglesDeg] as [number, number, number, number, number, number],
      })),
      opcUa: previous?.opcUa ?? DEFAULT_OPC_UA,
    }
  },
  stage: async (snapshot) => {
    const objectRepository = new ImportedGeometryRepository(stepImportClient)
    let robotAssets: Awaited<ReturnType<typeof restoreRobotGeometryRecords>> | null = null
    try {
      robotAssets = await restoreRobotGeometryRecords(
        snapshot.robot.links,
        stepImportClient,
      )
      await objectRepository.restoreObjectAssets(snapshot.objectAssets)
      const objectAssets = new Map<string, ImportedThreeAsset>()
      for (const asset of snapshot.objectAssets) {
        const geometry = objectRepository.get(asset.id)
        if (geometry === undefined) {
          throw new Error(`Unable to stage Object Asset ${asset.name}.`)
        }
        objectAssets.set(asset.id, geometry)
      }
      return { robotAssets, objectAssets, objectRepository }
    } catch (error) {
      if (robotAssets !== null) {
        for (const asset of robotAssets.values()) asset.dispose()
      }
      objectRepository.dispose()
      throw error
    }
  },
  commit: async (snapshot, staged) => {
    await useRobotGeometryStore.getState().replaceRobot(snapshot.robot.links)
    await useObjectAssetStore
      .getState()
      .replaceProject(snapshot.objectAssets, snapshot.objectInstances)
    useRobotConfigurationStore.getState().setConfiguration({
      name: snapshot.robot.name,
      basePosition: [...snapshot.robot.basePosition],
      baseRotationDeg: [...snapshot.robot.baseRotationDeg],
      joints: snapshot.robot.joints.map((joint) => ({
        ...joint,
        origin: [...joint.origin],
        axis: [...joint.axis],
      })),
    })
    useRobotStore.getState().replaceKeyframes(
      snapshot.poses.map((pose) => ({
        ...pose,
        anglesDeg: [...pose.anglesDeg],
      })),
    )
    robotGeometryRepository.replace(staged.robotAssets)
    importedGeometryRepository.replaceAll(staged.objectAssets)
  },
  dispose: (staged) => {
    for (const asset of staged.robotAssets.values()) asset.dispose()
    staged.objectRepository.dispose()
  },
}
