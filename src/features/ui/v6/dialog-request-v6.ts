import type { OpcUaProjectTargetV5 } from '../../../core/project-v5/types.js'

export type DialogParentV6 =
  | { readonly kind: 'opcua-settings' }
  | { readonly kind: 'binding-overview'; readonly parent?: { readonly kind: 'opcua-settings' } }

export type DialogRequestV6 =
  | { readonly kind: 'opcua-settings' }
  | { readonly kind: 'binding-overview'; readonly parent?: { readonly kind: 'opcua-settings' } }
  | { readonly kind: 'binding-editor'; readonly target: OpcUaProjectTargetV5; readonly mappingId?: string; readonly parent?: DialogParentV6 }
  | { readonly kind: 'docker-guide'; readonly parent?: { readonly kind: 'opcua-settings' } }
  | { readonly kind: 'job-editor'; readonly jobId: string; readonly instructionId?: string }
  | { readonly kind: 'help'; readonly topic: 'controls' | 'about' }
