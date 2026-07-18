import type { AppCommandSectionV4 } from './app-command.js'
import type { AppCommandBindingsV4 } from './app-command-runtime.js'

export interface AppShortcutDispatcherV4 { dispose(): void }

const SECTIONS: readonly AppCommandSectionV4[] = Object.freeze(['project', 'home', 'model', 'job', 'simulation', 'connectivity', 'view', 'help'])
interface ParsedShortcut { readonly key: string; readonly ctrl: boolean; readonly alt: boolean; readonly shift: boolean; readonly meta: boolean }
function parseShortcut(value: string | undefined): ParsedShortcut | null {
  if (value === undefined) return null
  const parts = value.split('+').map((part) => part.trim()).filter(Boolean)
  if (parts.length === 0) return null
  let ctrl = false; let alt = false; let shift = false; let meta = false; let key: string | null = null
  for (const part of parts) {
    const token = part.toLowerCase()
    if (token === 'ctrl' || token === 'control') { if (ctrl) return null; ctrl = true }
    else if (token === 'alt' || token === 'option') { if (alt) return null; alt = true }
    else if (token === 'shift') { if (shift) return null; shift = true }
    else if (token === 'meta' || token === 'cmd') { if (meta || key !== null) return null; meta = true }
    else if (key === null) key = token
    else return null
  }
  return key === null ? null : { key, ctrl, alt, shift, meta }
}
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  const tag = target.closest('input, textarea, select')
  return tag !== null || target.closest('[contenteditable]:not([contenteditable="false"])') !== null
}
export function createAppShortcutDispatcherV4(options: {
  readonly target: Pick<Window, 'addEventListener' | 'removeEventListener'>
  readonly bindings: AppCommandBindingsV4
}): AppShortcutDispatcherV4 {
  let disposed = false
  const listener = (event: KeyboardEvent): void => {
    if (disposed || event.defaultPrevented || event.repeat || event.isComposing || isEditable(event.target)) return
    const state = options.bindings.runtime.getState()
    const candidates = SECTIONS.flatMap((section) => options.bindings.getRegistry().list(section)).filter((command) => {
      const parsed = parseShortcut(command.shortcut)
      return parsed !== null && parsed.key === event.key.toLowerCase()
        && parsed.ctrl === event.ctrlKey && parsed.alt === event.altKey && parsed.shift === event.shiftKey && parsed.meta === event.metaKey
        && command.visible === true && command.enabled === true && !state.pendingCommandIds.has(command.id)
    })
    if (candidates.length !== 1) return
    event.preventDefault()
    void options.bindings.runtime.invoke(candidates[0]!.id)
  }
  options.target.addEventListener('keydown', listener)
  return { dispose() { if (disposed) return; disposed = true; options.target.removeEventListener('keydown', listener) } }
}
