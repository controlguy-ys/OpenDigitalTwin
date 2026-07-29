import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

import { ProjectV5Error } from '../../src/core/project-v5/errors.js'
import { computeSerialRobotPoseV5, type SerialRobotPoseV5 } from '../../src/core/robot-runtime-v5/serial-kinematics.js'
import {
  buildSerialKinematicsErrorCaseV5,
  buildSerialKinematicsSuccessCaseV5,
  SERIAL_KINEMATICS_ERROR_CASE_IDS_V5,
  SERIAL_KINEMATICS_SUCCESS_CASE_IDS_V5,
  type SerialKinematicsErrorCaseIdV5,
  type SerialKinematicsSuccessCaseIdV5,
} from '../../src/core/robot-runtime-v5/test-support.js'

interface SerialKinematicsGoldenV5 {
  readonly schemaVersion: 1
  readonly sourceCommit: string
  readonly successCases: readonly { readonly caseId: SerialKinematicsSuccessCaseIdV5; readonly expected: SerialRobotPoseV5 }[]
  readonly errorCases: readonly {
    readonly caseId: SerialKinematicsErrorCaseIdV5
    readonly expected: { readonly name: 'ProjectV5Error'; readonly code: string; readonly path: string; readonly message: string; readonly recovery: string | null }
  }[]
}

const REPOSITORY_ROOT = process.cwd()
const SERIAL_KINEMATICS_PATH = resolve(REPOSITORY_ROOT, 'src/core/robot-runtime-v5/serial-kinematics.ts')
const GOLDEN_PATH = resolve(REPOSITORY_ROOT, 'src/core/robot-runtime-v5/fixtures/serial-kinematics-golden-v5.json')

function currentHeadCommit(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPOSITORY_ROOT, encoding: 'utf8' }).trim()
}

function captureError(caseId: SerialKinematicsErrorCaseIdV5): SerialKinematicsGoldenV5['errorCases'][number] {
  const input = buildSerialKinematicsErrorCaseV5(caseId)
  try {
    computeSerialRobotPoseV5(input.definition, input.jointValues, input.worldBasePose)
  } catch (error) {
    if (!(error instanceof ProjectV5Error)) throw error
    return {
      caseId,
      expected: { name: 'ProjectV5Error', code: error.code, path: error.path, message: error.message, recovery: error.recovery ?? null },
    }
  }
  throw new Error(`Expected ${caseId} to fail.`)
}

async function buildSerialKinematicsGoldenV5(sourceCommit: string): Promise<SerialKinematicsGoldenV5> {
  if (!/^[0-9a-f]{40}$/u.test(sourceCommit)) throw new Error('--source-commit must be a 40-character lowercase hexadecimal commit.')
  const source = await readFile(SERIAL_KINEMATICS_PATH, 'utf8')
  if (/\bimport\s*(?:[\w*${},\s]+?\s+from\s*)?['"][^'"]*mechanism-runtime-v1[^'"]*['"]/u.test(source)) {
    throw new Error('Refusing to characterize serial kinematics after it imports mechanism-runtime-v1.')
  }
  const head = currentHeadCommit()
  if (sourceCommit !== head) throw new Error(`--source-commit ${sourceCommit} does not match HEAD ${head}.`)
  return {
    schemaVersion: 1,
    sourceCommit,
    successCases: SERIAL_KINEMATICS_SUCCESS_CASE_IDS_V5.map((caseId) => {
      const input = buildSerialKinematicsSuccessCaseV5(caseId)
      return { caseId, expected: computeSerialRobotPoseV5(input.definition, input.jointValues, input.worldBasePose) }
    }),
    errorCases: SERIAL_KINEMATICS_ERROR_CASE_IDS_V5.map(captureError),
  }
}

async function writeSerialKinematicsGoldenV5(sourceCommit: string): Promise<void> {
  const golden = await buildSerialKinematicsGoldenV5(sourceCommit)
  await writeFile(GOLDEN_PATH, `${JSON.stringify(golden, null, 2)}\n`, 'utf8')
}

function parseArguments(arguments_: readonly string[]): string {
  if (arguments_.length !== 3 || arguments_[0] !== '--write' || arguments_[1] !== '--source-commit') {
    throw new Error('Usage: generate-serial-kinematics-golden-v5.ts --write --source-commit <40-hex-commit>')
  }
  return arguments_[2]!
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  await writeSerialKinematicsGoldenV5(parseArguments(process.argv.slice(2)))
}
