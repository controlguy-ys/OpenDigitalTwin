import { useEffect, useState } from 'react'
import {
  createDatasheetRobotConfiguration,
  type EditableRobotJoint,
  type RobotConfiguration,
  useRobotConfigurationStore,
} from './robot-configuration-store'

interface RobotConfigurationDialogProps {
  open: boolean
  onClose(): void
}

function cloneConfiguration(configuration: RobotConfiguration): RobotConfiguration {
  return {
    ...configuration,
    basePosition: [...configuration.basePosition],
    baseRotationDeg: [...configuration.baseRotationDeg],
    joints: configuration.joints.map((joint) => ({
      ...joint,
      origin: [...joint.origin],
      axis: [...joint.axis],
    })),
  }
}

export function RobotConfigurationDialog({
  open,
  onClose,
}: RobotConfigurationDialogProps) {
  const configuration = useRobotConfigurationStore((state) => state.configuration)
  const setConfiguration = useRobotConfigurationStore(
    (state) => state.setConfiguration,
  )
  const [draft, setDraft] = useState(() => cloneConfiguration(configuration))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setDraft(cloneConfiguration(configuration))
      setError(null)
    }
  }, [configuration, open])

  if (!open) return null

  const updateJoint = (index: number, update: Partial<EditableRobotJoint>) => {
    setDraft((current) => ({
      ...current,
      joints: current.joints.map((joint, jointIndex) =>
        jointIndex === index ? { ...joint, ...update } : joint,
      ),
    }))
  }

  const updateJointVector = (
    jointIndex: number,
    field: 'origin' | 'axis',
    vectorIndex: number,
    value: number,
  ) => {
    const current = draft.joints[jointIndex]!
    const vector = [...current[field]] as [number, number, number]
    vector[vectorIndex] = field === 'origin' ? value / 1000 : value
    updateJoint(jointIndex, { [field]: vector } as Partial<EditableRobotJoint>)
  }

  return (
    <div
      aria-labelledby="robot-configuration-title"
      aria-modal="true"
      className="import-step-backdrop"
      role="dialog"
    >
      <section className="import-step-dialog robot-configuration-dialog">
        <header>
          <div>
            <p>Editable datasheet</p>
            <h2 id="robot-configuration-title">Robot Configuration</h2>
          </div>
          <button aria-label="Close robot configuration" onClick={onClose} type="button">
            Close
          </button>
        </header>
        <label>
          <span>Robot name</span>
          <input
            aria-label="Robot name"
            onChange={(event) => setDraft((current) => ({
              ...current,
              name: event.currentTarget.value,
            }))}
            value={draft.name}
          />
        </label>
        <p className="robot-import-hint">
          Robot base pose is edited in the Scene Inspector. This dialog changes mechanics only.
        </p>
        <div className="robot-joint-config-scroll">
          <table className="robot-joint-config-table">
            <caption>Joint mechanics — origin in millimetres</caption>
            <thead>
              <tr>
                <th>Joint</th>
                {['OX', 'OY', 'OZ', 'AX', 'AY', 'AZ', 'Min°', 'Max°', '°/s'].map(
                  (label) => <th key={label}>{label}</th>,
                )}
              </tr>
            </thead>
            <tbody>
              {draft.joints.map((joint, jointIndex) => (
                <tr key={joint.id}>
                  <th>{joint.id}</th>
                  {joint.origin.map((value, vectorIndex) => (
                    <td key={`origin-${vectorIndex}`}>
                      <input
                        aria-label={`${joint.id} origin ${'XYZ'[vectorIndex]} (mm)`}
                        onChange={(event) => updateJointVector(
                          jointIndex,
                          'origin',
                          vectorIndex,
                          event.currentTarget.valueAsNumber,
                        )}
                        step="any"
                        type="number"
                        value={value * 1000}
                      />
                    </td>
                  ))}
                  {joint.axis.map((value, vectorIndex) => (
                    <td key={`axis-${vectorIndex}`}>
                      <input
                        aria-label={`${joint.id} axis ${'XYZ'[vectorIndex]}`}
                        onChange={(event) => updateJointVector(
                          jointIndex,
                          'axis',
                          vectorIndex,
                          event.currentTarget.valueAsNumber,
                        )}
                        step="any"
                        type="number"
                        value={value}
                      />
                    </td>
                  ))}
                  {(['minDeg', 'maxDeg', 'maxVelocityDegPerSec'] as const).map(
                    (field) => (
                      <td key={field}>
                        <input
                          aria-label={`${joint.id} ${field}`}
                          onChange={(event) => updateJoint(jointIndex, {
                            [field]: event.currentTarget.valueAsNumber,
                          })}
                          step="any"
                          type="number"
                          value={joint[field]}
                        />
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {error === null ? null : <p role="alert">{error}</p>}
        <footer>
          <button
            onClick={() => setDraft((current) => ({
              ...createDatasheetRobotConfiguration(),
              basePosition: [...current.basePosition],
              baseRotationDeg: [...current.baseRotationDeg],
            }))}
            type="button"
          >
            Restore datasheet draft
          </button>
          <button
            onClick={() => {
              try {
                setConfiguration(draft)
                setError(null)
                onClose()
              } catch (nextError) {
                setError(nextError instanceof Error ? nextError.message : 'Invalid robot configuration.')
              }
            }}
            type="button"
          >
            Apply configuration
          </button>
        </footer>
      </section>
    </div>
  )
}
