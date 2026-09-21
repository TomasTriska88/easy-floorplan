#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def replace_once(rel: str, old: str, new: str) -> None:
    p = ROOT / rel
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{rel}: expected exactly one anchor, found {count}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")

replace_once(
    "src/types.ts",
    '''  entity?: string;
  /**
   * A second contact / `cover` driving the opening's **other** leaf, for
''',
    '''  entity?: string;
  /**
   * Markvarec extension: for an unbound swing door, draw the static leaf
   * closed instead of the upstream default open swing symbol. Ignored for
   * bound openings and for non-swing/non-door openings.
   */
  staticClosed?: boolean;
  /**
   * A second contact / `cover` driving the opening's **other** leaf, for
''',
)

replace_once(
    "src/render.ts",
    '''export function openingDefaultOpen(o: Opening): boolean {
  const natural = o.type === "door" && openingMotion(o) === "swing";
  return o.invert ? !natural : natural;
}
''',
    '''export function openingDefaultOpen(o: Opening): boolean {
  // Markvarec: staticClosed is deliberately a static-only override. If an
  // entity is bound, keep upstream's normal fallback while live state loads.
  const natural =
    o.type === "door" &&
    openingMotion(o) === "swing" &&
    (!o.staticClosed || !!o.entity);
  return o.invert ? !natural : natural;
}
''',
)

replace_once(
    "src/editor-forms.ts",
    '''  // One sensor per leaf (issues #145, #159). Only a two-leaved opening has a
''',
    '''  if (motion === "swing" && o.type === "door" && !o.entity) {
    fields.push({
      name: "staticClosed",
      label: "Static closed",
      helper: "For an unbound swing door, draw the leaf shut instead of the default open swing symbol",
      selector: { boolean: {} },
    });
  }
  // One sensor per leaf (issues #145, #159). Only a two-leaved opening has a
''',
)

replace_once(
    "src/editor-forms.ts",
    '''      entity: o.entity ?? "",
      secondaryEntity: o.secondaryEntity ?? "",
''',
    '''      entity: o.entity ?? "",
      staticClosed: o.staticClosed ?? false,
      secondaryEntity: o.secondaryEntity ?? "",
''',
)

replace_once(
    "src/editor-forms.ts",
    '''        } else if (k === "glazed") {
''',
    '''        } else if (k === "staticClosed") {
          out.staticClosed = v ? true : undefined;
        } else if (k === "glazed") {
''',
)

replace_once(
    "src/editor-forms.ts",
    '''        } else if (k === "entity") {
          out.entity = v;
          // The badge and its glyph only mean something with an entity to
''',
    '''        } else if (k === "entity") {
          out.entity = v;
          if (v) out.staticClosed = undefined;
          // The badge and its glyph only mean something with an entity to
''',
)

replace_once(
    "src/editor-forms.ts",
    '''          if (v !== "slide") out.sliderStyle = undefined;
          // Nothing swings any more, so the sash's share of the frame has
''',
    '''          if (v !== "slide") out.sliderStyle = undefined;
          if (v !== "swing") out.staticClosed = undefined;
          // Nothing swings any more, so the sash's share of the frame has
''',
)

replace_once(
    "src/editor-forms.ts",
    '''        else if (k === "type") {
          out.type = v;
          if (v === "skylight") {
''',
    '''        else if (k === "type") {
          out.type = v;
          if (v !== "door") out.staticClosed = undefined;
          if (v === "skylight") {
''',
)

replace_once(
    "src/editor.ts",
    '''      "type",
      "motion",
      "length",
''',
    '''      "type",
      "motion",
      "staticClosed",
      "length",
''',
)

test_path = ROOT / "src/markvarec.static-closed.test.ts"
test_path.write_text('''import { describe, expect, it } from "vitest";
import { openingForm } from "./editor-forms";
import { openingDefaultOpen } from "./render";
import type { Opening } from "./types";

const door = {
  id: "markvarec-static-door",
  type: "door",
  x: 0,
  y: 0,
  length: 90,
  angle: 0,
} as Opening;

describe("Markvarec staticClosed", () => {
  it("draws an unbound swing door closed while leaving bound fallback upstream-compatible", () => {
    expect(openingDefaultOpen({ ...door, staticClosed: true })).toBe(false);
    expect(openingDefaultOpen({ ...door, staticClosed: true, entity: "binary_sensor.door" })).toBe(true);
    expect(openingDefaultOpen({ ...door, staticClosed: true, invert: true })).toBe(true);
  });

  it("offers and cleans the editor option only where it is meaningful", () => {
    const form = openingForm({ ...door, staticClosed: true });
    expect(form.fields.map((x) => x.name)).toContain("staticClosed");
    expect(form.data.staticClosed).toBe(true);
    expect(form.toPatch({ staticClosed: false }).staticClosed).toBeUndefined();
    expect(form.toPatch({ entity: "binary_sensor.door" }).staticClosed).toBeUndefined();
    expect(form.toPatch({ motion: "slide" }).staticClosed).toBeUndefined();
    expect(form.toPatch({ type: "window" }).staticClosed).toBeUndefined();

    expect(openingForm({ ...door, entity: "binary_sensor.door" }).fields.map((x) => x.name))
      .not.toContain("staticClosed");
    expect(openingForm({ ...door, type: "window" }).fields.map((x) => x.name))
      .not.toContain("staticClosed");
    expect(openingForm({ ...door, motion: "slide" }).fields.map((x) => x.name))
      .not.toContain("staticClosed");
  });
});
''', encoding="utf-8")

print("STATIC_CLOSED_V191_PORT_APPLIED")
