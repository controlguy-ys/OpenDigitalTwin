import { describe, expect, it } from 'vitest'

import { resolveRibbonOverflowV4, type RibbonItemSpecV4 } from './ribbon-overflow-v4.js'

const items: readonly RibbonItemSpecV4[] = Object.freeze([
  { commandId: 'first', priority: 10, iconKey: 'save' },
  { commandId: 'second', priority: 20, iconKey: 'play' },
  { commandId: 'third', priority: 20, iconKey: 'cancel' },
  { commandId: 'last', priority: 30, iconKey: 'view' },
])

describe('ribbon-overflow-v4', () => {
  it('keeps complete higher-priority items visible and moves lower priorities into one stable More group', () => {
    const layout = resolveRibbonOverflowV4({
      items,
      availableWidthPx: 156,
      measuredWidthPxByCommandId: { first: 40, second: 40, third: 40, last: 40 },
      moreWidthPx: 36,
    })
    expect(layout.visibleItems.map((item) => item.commandId)).toEqual(['first', 'second', 'third'])
    expect(layout.overflowItems.map((item) => item.commandId)).toEqual(['last'])
    expect(layout.hasOverflow).toBe(true)
  })

  it('uses deterministic source ordering for equal priority and never asks the ribbon to scroll', () => {
    const layout = resolveRibbonOverflowV4({
      items,
      availableWidthPx: 76,
      measuredWidthPxByCommandId: { first: 40, second: 40, third: 40, last: 40 },
      moreWidthPx: 36,
    })
    expect(layout.visibleItems.map((item) => item.commandId)).toEqual(['first'])
    expect(layout.overflowItems.map((item) => item.commandId)).toEqual(['second', 'third', 'last'])
    expect(layout.scrollable).toBe(false)
  })

  it('does not create More when every item fits', () => {
    const layout = resolveRibbonOverflowV4({
      items,
      availableWidthPx: 200,
      measuredWidthPxByCommandId: { first: 40, second: 40, third: 40, last: 40 },
    })
    expect(layout.visibleItems).toEqual(items)
    expect(layout.overflowItems).toEqual([])
    expect(layout.hasOverflow).toBe(false)
  })

  it('keeps a priority-prefix in the command strip after the first unequal-width item does not fit', () => {
    const layout = resolveRibbonOverflowV4({
      items: [
        { commandId: 'first', priority: 10, iconKey: 'save' },
        { commandId: 'too-wide', priority: 20, iconKey: 'play' },
        { commandId: 'later-but-small', priority: 30, iconKey: 'view' },
      ],
      availableWidthPx: 100,
      measuredWidthPxByCommandId: { first: 20, 'too-wide': 90, 'later-but-small': 10 },
      moreWidthPx: 20,
    })

    expect(layout.visibleItems.map((item) => item.commandId)).toEqual(['first'])
    expect(layout.overflowItems.map((item) => item.commandId)).toEqual(['too-wide', 'later-but-small'])
  })
})
