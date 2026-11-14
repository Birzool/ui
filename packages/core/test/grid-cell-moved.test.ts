// @vitest-environment jsdom
// A grid cell a keyed renderer moves to another row, keeping its key and its
// element, is found at its new row: arrow keys land on the cell that is there
// now. Driven as a framework adapter drives core: `instance.part` with each
// render's props and one stable `ref` per part, which does not bind again
// when only the props change.
import { afterEach, expect, test } from "vitest"
import { createGridFocus, definePrimitive, type GridCell } from "../src/index"
import { ref } from "../src/foundation/kernel/part"

let cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.forEach((cleanup) => cleanup())
  cleanups = []
  document.body.innerHTML = ""
})

const sortedGrid = definePrimitive({
  name: "sorted-grid",
  options: { rows: "number" },
  state: (_options: { rows?: number }) => ({ active: null as GridCell | null }),
  api: (context) => ({
    grid: createGridFocus(context, {
      key: "active",
      rows: () => context.options().rows ?? 0,
      cols: () => 1,
    }),
  }),
  slots: (slot) => ({
    cell: slot<{ row: number; col: number }>({
      props: { row: "number", col: "number" },
      role: "gridcell",
      focus: "roving",
      keys: ["ArrowUp", "ArrowDown"],
      attrs: (state, { props, api }) => ({
        tabindex: api.grid.tabIndex(state, props),
      }),
      on: {
        keydown: (event, { api }) => api.grid.keydown(event),
        pointerdown: (event, { api, props }) =>
          api.grid.focus(props, { reason: "item-press", event }),
      },
      bind: (el, { api, props }) => api.grid.bind(el, props),
    }),
  }),
})

test("a cell moved to another row is reached there by the arrow keys", () => {
  const instance = sortedGrid({ id: "g", rows: 3 })
  cleanups.push(() => instance.destroy())
  const elements = new Map<string, HTMLElement>()
  // One render: each id at its row, bound once through its stable ref.
  const render = (order: string[]) =>
    order.forEach((id, row) => {
      const part = instance.part("cell", { id, row, col: 0 })
      let el = elements.get(id)
      if (!el) {
        el = document.createElement("div")
        el.id = id
        el.tabIndex = -1
        document.body.append(el)
        elements.set(id, el)
      }
      ref(part, { by: "framework", attaches: [] })(el)
    })
  const cell = (id: string) => elements.get(id)!
  const press = (el: HTMLElement, key: string) =>
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
    )

  render(["a", "b", "c"])
  cell("a").dispatchEvent(new Event("pointerdown", { bubbles: true }))
  press(cell("a"), "ArrowDown")
  expect(document.activeElement).toBe(cell("b"))

  // Sorted descending: the same parts and elements, at new rows.
  render(["c", "b", "a"])
  cell("c").dispatchEvent(new Event("pointerdown", { bubbles: true }))
  expect(document.activeElement).toBe(cell("c"))
  press(cell("c"), "ArrowDown")
  expect(document.activeElement).toBe(cell("b"))
  press(cell("b"), "ArrowDown")
  expect(document.activeElement).toBe(cell("a"))
})
