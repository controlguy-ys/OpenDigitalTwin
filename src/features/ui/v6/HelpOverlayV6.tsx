import type { DialogRequestV6 } from './dialog-request-v6.js'

export interface HelpOverlayV6Props {
  readonly request: Extract<DialogRequestV6, { readonly kind: 'help' }> | null
  readonly onClose: () => void
}

const HELP_CONTENT = {
  controls: {
    title: 'Controls',
    body: 'Use left-click to select, middle-drag to orbit, Shift+middle-drag to pan, and the wheel to zoom.',
  },
  about: {
    title: 'About',
    body: 'OpenDigitalTwin UI V6 uses the canonical Project V5 and current Runtime Gateway contracts.',
  },
} as const

export function HelpOverlayV6({ request, onClose }: HelpOverlayV6Props) {
  if (request === null) return null
  const content = HELP_CONTENT[request.topic]
  return <div aria-label={content.title} role="dialog">
    <h2>{content.title}</h2>
    <p>{content.body}</p>
    <button aria-label="Close help" onClick={onClose} type="button">Close</button>
  </div>
}
