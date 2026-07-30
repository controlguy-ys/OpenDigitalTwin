import type { OpcUaProjectTargetV5 } from '../../../core/project-v5/types.js'
export type DialogRequestV6 =
  | { readonly kind: 'opcua-settings' }
  | { readonly kind: 'binding-overview' }
  | { readonly kind: 'binding-editor'; readonly target: OpcUaProjectTargetV5; readonly mappingId?: string }
  | { readonly kind: 'docker-guide' }
  | { readonly kind: 'job-editor'; readonly jobId: string }
  | { readonly kind: 'help'; readonly topic: 'controls' | 'about' }
