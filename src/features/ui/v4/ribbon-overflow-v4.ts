import type { RibbonItemSpecV4 } from './ribbon-model-v4.js'

export type { RibbonItemSpecV4 } from './ribbon-model-v4.js'

export interface RibbonLayoutV4 {
  readonly visibleItems: readonly RibbonItemSpecV4[]
  readonly overflowItems: readonly RibbonItemSpecV4[]
  readonly hasOverflow: boolean
  readonly scrollable: false
}

export function resolveRibbonOverflowV4(input: {
  readonly items: readonly RibbonItemSpecV4[]
  readonly availableWidthPx: number
  readonly measuredWidthPxByCommandId: Readonly<Record<string, number>>
  readonly moreWidthPx?: number
}): RibbonLayoutV4 {
  const ordered = input.items.map((item, index) => ({ item, index })).sort((left, right) => (
    left.item.priority - right.item.priority || left.index - right.index
  ))
  const widthOf = (item: RibbonItemSpecV4): number => {
    const candidate = input.measuredWidthPxByCommandId[item.commandId]
    return candidate !== undefined && Number.isFinite(candidate) && candidate > 0
      ? candidate
      : 0
  }
  const total = ordered.reduce((width, entry) => width + widthOf(entry.item), 0)
  if (total <= input.availableWidthPx) {
    return Object.freeze({ visibleItems: Object.freeze(input.items.slice()), overflowItems: Object.freeze([]), hasOverflow: false, scrollable: false })
  }

  const moreWidth = Number.isFinite(input.moreWidthPx) && input.moreWidthPx! > 0
    ? input.moreWidthPx!
    : 64
  const budget = Math.max(0, input.availableWidthPx - moreWidth)
  let used = 0
  let hasOverflowed = false
  const visible: RibbonItemSpecV4[] = []
  const overflow: RibbonItemSpecV4[] = []
  for (const entry of ordered) {
    const width = widthOf(entry.item)
    if (!hasOverflowed && used + width <= budget) {
      visible.push(entry.item)
      used += width
    } else {
      hasOverflowed = true
      overflow.push(entry.item)
    }
  }
  return Object.freeze({
    visibleItems: Object.freeze(visible),
    overflowItems: Object.freeze(overflow),
    hasOverflow: overflow.length > 0,
    scrollable: false,
  })
}
