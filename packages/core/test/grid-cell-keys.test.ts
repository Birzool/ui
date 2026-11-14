// @vitest-environment jsdom
// Grid cells are told apart by their `id`, as the grid focus docs ask. A cell
// rendered without one shares a part with every other cell, so a press on one
// runs with another's `row` and `col`.
import { afterEach, expect, test, vi } from "vitest"
import {
  byCell,
  createGridFocus,
  type GridCell,
} from "../src/foundation/focus/grid-focus"
import { ref } from "../src/foundation/kernel/part"
import { definePrimitive } from "../src/foundation/kernel/primitive"
import { selects } from "../src/foundation/kernel/selects"

type TableState = { active: GridCell | null }

const table = definePrimitive({
  name: "table",
  state: (): TableState => ({ active: null }),
  api: (context) => ({
    grid: createGridFocus<TableState>(context, {
      key: "active",
      rows: () => 2,
      cols: () => 3,
    }),
  }),
  slots: (slot) => ({
    cell: slot<{ id?: string; row: number; col: number }>({
      props: { row: "number", col: "number" },
      role: "gridcell",
      focus: "roving",
      selects: selects({ active: byCell }),
      keys: ["ArrowLeft", "ArrowRight"],
      attrs: (state, { props, api }) => ({
        tabindex: api.grid.tabIndex(state, props),
      }),
      on: {
        keydown: (event, { api }) => api.grid.keydown(event),
      },
      bind: (el, { api, props }) => api.grid.bind(el, props),
    }),
  }),
})

const host = { by: "framework", attaches: "all" } as const
const element = () => document.body.appendChild(document.createElement("div"))
const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve))

function renderHeader(instance: ReturnType<typeof table>, ids: boolean) {
  for (const col of [0, 1, 2]) {
    const props = { row: 0, col, ...(ids ? { id: `0:${col}` } : {}) }
    ref(instance.part("cell", props), host)(element())
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

test("grid cells rendered without an id warn in development, naming the cell part and the id it needs", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  renderHeader(table({ id: "t" }), false)
  await settle()
  const messages = warn.mock.calls.map(([message]) => String(message))
  expect(messages).toContainEqual(expect.stringMatching(/"cell".*\bid\b/))
})

test("grid cells with their own ids are three parts that don't warn", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  const instance = table({ id: "t" })
  renderHeader(instance, true)
  await settle()
  expect(warn).not.toHaveBeenCalled()
  const cells = [0, 1, 2].map((col) =>
    instance.part("cell", { id: `0:${col}`, row: 0, col })
  )
  expect(new Set(cells).size).toBe(3)
  expect(cells.map((cell) => cell.el?.isConnected)).toEqual([true, true, true])
})
