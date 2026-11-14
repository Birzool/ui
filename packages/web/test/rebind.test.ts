// @vitest-environment jsdom
// A part keeps its binding, and what the binding holds, like focus or a
// place in a list, when nothing the binding read has changed: an attribute
// set again to its own value, or a prop the binding never captured. Every
// primitive core's after-mount cases render, built as packages/web/test/after-mount.test.ts builds them.
import { afterEach, describe, expect, test, vi } from "vitest"
import {
  type Built,
  changesOf,
  idle,
  partsOf,
  title,
  withAttribute,
} from "../../core/test/after-mount"
import { cases } from "../../core/test/after-mount.cases"

// Each element bound and unbound, in order, through core's renderer.
const log = vi.hoisted(() => [] as { el: Element; kind: "bind" | "unbind" }[])
vi.mock("@ui-sdk/core/renderer", async (original) => {
  const module = await original<typeof import("@ui-sdk/core/renderer")>()
  const bind: typeof module.bind = (record, el) => {
    log.push({ el, kind: "bind" })
    const cleanup = module.bind(record, el)
    return () => {
      log.push({ el, kind: "unbind" })
      cleanup?.()
    }
  }
  return { ...module, bind }
})

// Each tag's `target`, which picks the native element a wrapper part binds.
const targets = vi.hoisted(
  () => new Map<string, (el: HTMLElement) => HTMLElement | null>()
)
vi.mock("../src/define-element", async (original) => {
  const module = await original<typeof import("../src/define-element")>()
  const record = (
    options?:
      string | { tag: string; target?: (el: HTMLElement) => HTMLElement | null }
  ) => {
    if (typeof options === "object" && options.target) {
      targets.set(options.tag, options.target)
    }
  }
  const createParts: typeof module.createParts = (primitive, tags) => {
    Object.values(tags).forEach(record)
    return module.createParts(primitive, tags)
  }
  const definePart: typeof module.definePart = (primitive, slot, options) => {
    record(options)
    module.definePart(primitive, slot, options)
  }
  return { ...module, createParts, definePart }
})

// jsdom has no Web Animations API, no form values and no layout.
Element.prototype.getAnimations ??= () => []
Element.prototype.scrollIntoView ??= () => {}
ElementInternals.prototype.setFormValue ??= () => {}
ElementInternals.prototype.setValidity ??= () => {}
Element.prototype.getClientRects = function () {
  const rects = this.isConnected ? [this.getBoundingClientRect()] : []
  return Object.assign(rects, { item: (index: number) => rects[index] ?? null })
}
await Promise.all(
  Object.values(import.meta.glob("../src/entries/*.ts")).map((load) => load())
)

declare global {
  interface ImportMeta {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>
  }
}

const tagOf = (name: string) =>
  "ui-" +
  name
    .replace("OTP", "Otp")
    .replace(/[A-Z]/g, (char, index) => (index ? "-" : "") + char.toLowerCase())
const natives: Record<string, string> = {
  AvatarImage: "img",
  FieldControl: "input",
  PasswordInputControl: "input",
}
const fields: Record<string, string> = {
  "ui-input": "input",
  "ui-textarea": "textarea",
}
const has = (name: string) =>
  name in natives || !!customElements.get(tagOf(name))

function wrapperOf(tag: string) {
  const target = targets.get(tag)
  if (!target) {
    return
  }
  const probe = document.createElement(tag)
  const kinds = ["button", "a", "input", "textarea", "select"]
  probe.append(
    document.createElement("span"),
    ...kinds.map((kind) => document.createElement(kind))
  )
  const found = target(probe)
  return found &&
    found.parentElement === probe &&
    kinds.includes(found.localName)
    ? found.localName
    : undefined
}

const asAttribute = (name: string) =>
  /[-:]/.test(name) ||
  ["class", "id", "role", "href", "for", "form"].includes(name)

function apply(
  el: Element,
  props: Record<string, unknown>,
  before: Record<string, unknown> = {}
) {
  for (const name in before) {
    if (!(name in props)) {
      if (asAttribute(name)) {
        el.removeAttribute(name)
      } else {
        ;(el as unknown as Record<string, unknown>)[name] = undefined
      }
    }
  }
  for (const [name, value] of Object.entries(props)) {
    if (!asAttribute(name)) {
      ;(el as unknown as Record<string, unknown>)[name] = value
    } else if (value === undefined || value === false) {
      el.removeAttribute(name)
    } else {
      el.setAttribute(name, value === true ? "" : String(value))
    }
  }
}

function build(nodes: Built[], made: Element[]): Node[] {
  return nodes.flatMap((node): Node[] => {
    if (typeof node === "string") {
      return [document.createTextNode(node)]
    }
    const children = () => build(node.children, made)
    if (!node.part && !node.tag) {
      return children()
    }
    const tag = node.part ? (natives[node.part] ?? tagOf(node.part)) : node.tag!
    const el = document.createElement(tag)
    made.push(el)
    apply(el, node.props)
    const wrapper = node.part && (wrapperOf(tag) ?? fields[tag])
    if (wrapper) {
      const inner = document.createElement(wrapper)
      if (!["input", "textarea", "select"].includes(wrapper)) {
        inner.append(...children())
      }
      el.append(inner)
    } else {
      el.append(...children())
    }
    return [el]
  })
}

function propsOf(nodes: Built[]): Record<string, unknown>[] {
  return nodes.flatMap((node) =>
    typeof node === "string"
      ? []
      : [
          ...(node.part || node.tag ? [node.props] : []),
          ...propsOf(node.children),
        ]
  )
}

const describeEl = (el: Element) =>
  `<${el.localName}${el.getAttribute("data-slot") ? ` data-slot="${el.getAttribute("data-slot")}"` : ""}${el.id ? ` id="${el.id}"` : ""}>`

// Elements that unbound and bound again since the log was cleared.
function rebound() {
  const unbound = new Set(
    log.filter(({ kind }) => kind === "unbind").map(({ el }) => el)
  )
  return [
    ...new Set(
      log
        .filter(({ el, kind }) => kind === "bind" && unbound.has(el))
        .map(({ el }) => el)
    ),
  ]
}

afterEach(() => {
  document.body.replaceChildren()
  log.length = 0
})

// Props a slot's binding reads once, by `case > slot.prop`, read in core:
// a change of one may bind its part again. Every other change must not.
const captured = new Set([
  // bindItem keeps the parent's sibling set and queues a deep-expanding branch.
  "tree > item.parent",
  "tree > item.branch",
  // The value's bind reads `text`, its placeholder and its format props once.
  "select > value.*",
  "combobox > value.*",
  // bindContent takes the content's props.
  "navigation menu > content.*",
  // The input takes its index in a range once.
  "date picker > input.*",
  // An item's text, written by its bind, reads `text` and `write` once.
  "select > item-text.*",
  "combobox > item-text.*",
  "autocomplete > item-text.*",
  "command > item-text.*",
  // The grid's month gives each day it renders a new value, its key.
  "calendar > grid.offset",
])
const mayRebind = (name: string, slot: string, key: string) =>
  captured.has(`${name} > ${slot}.${key}`) ||
  captured.has(`${name} > ${slot}.*`)

// The same changes packages/web/test/after-mount.test.ts leaves out, for the same reasons.
const likeAController = new Set([
  "menu > open: false to true",
  'select > query: "" to "a"',
  'select > query: "a" to ""',
  'combobox > query: "" to "a"',
])

describe("a part binds again only when something its binding read changed", () => {
  for (const entry of cases) {
    test(entry.name, async () => {
      const problems: string[] = []
      const tree = (markup: string) =>
        partsOf(entry, markup, { ...entry.options }, has)

      // Every attribute each element observes, set again to its own value, at once.
      const container = document.body.appendChild(
        document.createElement("div")
      )
      container.append(...build(tree(entry.markup), []))
      await idle()
      log.length = 0
      for (const el of document.body.querySelectorAll("*")) {
        const observed =
          (el.constructor as { observedAttributes?: string[] })
            .observedAttributes ?? []
        for (const { name, value } of [...el.attributes]) {
          if (el.localName.startsWith("ui-") && observed.includes(name)) {
            el.setAttribute(name, value)
          }
        }
      }
      await idle()
      for (const again of rebound()) {
        problems.push(`same values set again: ${describeEl(again)} bound again`)
      }
      document.body.replaceChildren()
      log.length = 0

      // Each part prop the case changes that no binding captured.
      for (const change of changesOf(entry).changes) {
        if (
          change.kind !== "prop" ||
          title(change) in (entry.skip ?? {}) ||
          likeAController.has(`${entry.name} > ${title(change)}`) ||
          mayRebind(entry.name, change.slot, change.key)
        ) {
          continue
        }
        const from = tree(withAttribute(entry.markup, change, change.from))
        const to = tree(withAttribute(entry.markup, change, change.to))
        const box = document.body.appendChild(document.createElement("div"))
        const els: Element[] = []
        box.append(...build(from, els))
        await idle()
        log.length = 0
        const before = propsOf(from)
        const after = propsOf(to)
        els.forEach((el, index) => apply(el, after[index]!, before[index]))
        await idle()
        for (const again of rebound()) {
          problems.push(`${title(change)}: ${describeEl(again)} bound again`)
        }
        document.body.replaceChildren()
        log.length = 0
      }
      expect(problems).toEqual([])
    })
  }
})

test("a focused tree item keeps focus when its label changes", async () => {
  document.body.innerHTML = `<ui-tree aria-label="Files" default-expanded="src">
    <ui-tree-item value="src" branch>
      <ui-tree-item-label>src</ui-tree-item-label>
      <ui-tree-group>
        <ui-tree-item value="index" label="index.ts"><ui-tree-item-label>index.ts</ui-tree-item-label></ui-tree-item>
      </ui-tree-group>
    </ui-tree-item>
  </ui-tree>`
  await idle()
  const child = document.querySelector<HTMLElement>(
    'ui-tree-item[value="index"]'
  )!
  child.focus()
  expect(document.activeElement).toBe(child)
  child.setAttribute("label", "main.ts")
  await idle()
  expect(document.activeElement).toBe(child)
})

test("a menu item whose label is set again to the same text does not bind again", async () => {
  document.body.innerHTML = `<ui-menu default-open>
    <ui-menu-trigger><button>File</button></ui-menu-trigger>
    <ui-menu-content>
      <ui-menu-item value="save" label="Save">Save</ui-menu-item>
    </ui-menu-content>
  </ui-menu>`
  await idle()
  const item = document.querySelector('ui-menu-item[value="save"]')!
  log.length = 0
  item.setAttribute("label", "Save")
  await idle()
  expect(rebound().map(describeEl)).toEqual([])
})
