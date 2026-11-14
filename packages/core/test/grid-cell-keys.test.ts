// @vitest-environment jsdom
// Cells are told apart by `id`; without one they share a part, so a press
// gets another cell's `row` and `col`. Class: dev warning missing or repeated.
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
    separator: slot({ role: "separator" }),
  }),
})

type Instance = ReturnType<typeof table>
type Slot = "cell" | "separator"
type Props = { id?: string; row: number; col: number } | undefined

const host = { by: "framework", attaches: "all" } as const
const element = () => document.body.appendChild(document.createElement("div"))
const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve))
const render = (instance: Instance, slot: Slot, props: Props) =>
  ref(
    slot === "cell" ? instance.part("cell", props!) : instance.part(slot),
    host
  )

// How adapters hand parts their elements: React renders and binds each part
// in turn, Solid renders all before it binds any, others bind across ticks.
const orderings = {
  "render and bind each in turn": async (
    instance: Instance,
    slot: Slot,
    cells: Props[],
    els: HTMLElement[]
  ) => {
    cells.forEach((props, i) => render(instance, slot, props)(els[i]!))
    await settle()
  },
  "render all, then bind all": async (
    instance: Instance,
    slot: Slot,
    cells: Props[],
    els: HTMLElement[]
  ) => {
    const refs = cells.map((props) => render(instance, slot, props))
    refs.forEach((bindTo, i) => bindTo(els[i]!))
    await settle()
  },
  "bind each a tick apart": async (
    instance: Instance,
    slot: Slot,
    cells: Props[],
    els: HTMLElement[]
  ) => {
    for (const [i, props] of cells.entries()) {
      render(instance, slot, props)(els[i]!)
      await settle()
    }
  },
  "render the same cells twice": async (
    instance: Instance,
    slot: Slot,
    cells: Props[],
    els: HTMLElement[]
  ) => {
    for (let pass = 0; pass < 2; pass++) {
      cells.forEach((props, i) => render(instance, slot, props)(els[i]!))
      await settle()
    }
  },
}

const header = [0, 1, 2]
const outcomes: { name: string; slot: Slot; cells: Props[]; warns: number }[] =
  [
    {
      name: "keyless cells with different props warn once",
      slot: "cell",
      cells: header.map((col) => ({ row: 0, col })),
      warns: 1,
    },
    {
      name: "cells with an id don't warn",
      slot: "cell",
      cells: header.map((col) => ({ id: `0:${col}`, row: 0, col })),
      warns: 0,
    },
    {
      name: "keyless cells with equal props don't warn",
      slot: "cell",
      cells: header.map(() => ({ row: 0, col: 0 })),
      warns: 0,
    },
    {
      name: "parts with neither key nor props don't warn",
      slot: "separator",
      cells: header.map(() => undefined),
      warns: 0,
    },
  ]

const rows = Object.keys(orderings).flatMap((ordering) =>
  outcomes.map((outcome) => ({
    ordering: ordering as keyof typeof orderings,
    ...outcome,
  }))
)

afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

// Two instances per row: the warning is once per instance and slot, not once per page.
test.each(rows)(
  "$ordering: $name",
  async ({ ordering, slot, cells, warns }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    for (const id of ["t1", "t2"]) {
      const els = cells.map(() => element())
      await orderings[ordering](table({ id }), slot, cells, els)
    }
    const messages = warn.mock.calls.map(([message]) => String(message))
    for (const id of ["t1", "t2"]) {
      const own = messages.filter((message) => message.includes(`#${id}:`))
      expect(own).toHaveLength(warns)
      for (const message of own) {
        expect(message).toMatch(/"cell".*\bid\b/)
      }
    }
    expect(messages).toHaveLength(2 * warns)
  }
)
