#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def replace_once(rel: str, old: str, new: str) -> None:
    path = ROOT / rel
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{rel}: expected exactly one anchor, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")

replace_once(
    "src/types.ts",
    '''  entity?: string;
  /**
   * A second contact / \`cover\` driving the opening's **other** leaf, for
''',
    '''  entity?: string;
  /**
   * Unbound swing doors only: draw the static leaf closed instead of the
   * ordinary open swing symbol. This is for a door that belongs on the plan
   * but has no position sensor. It is ignored once an entity is bound, and by
   * windows / sliding / rolling / fixed openings and skylights.
   */
  staticClosed?: boolean;
  /**
   * A second contact / \`cover\` driving the opening's **other** leaf, for
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
  // \`staticClosed\` is a static-only override. If a hand-written config
  // leaves it next to an entity, the live opening keeps the ordinary fallback
  // while that entity is loading; the actual live state still wins normally.
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
          // False is the upstream/default behavior, so keep the YAML quiet.
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
          // Once the opening is live, the static drawing override has no
          // meaning and must not silently reappear if it is unbound later.
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

replace_once(
    "src/render.test.ts",
    '''  it("invert flips the unbound picture, same as it flips a bound reading", () => {
''',
    '''  it("lets an unbound swing door opt into a closed static drawing", () => {
    expect(openingDefaultOpen({ type: "door", staticClosed: true } as Opening)).toBe(false);
    expect(openingDefaultOpen({ type: "door", staticClosed: true, invert: true } as Opening)).toBe(true);

    // A stale hand-written static flag never competes with a live entity.
    expect(
      openingDefaultOpen({
        type: "door",
        staticClosed: true,
        entity: "binary_sensor.door",
      } as Opening)
    ).toBe(true);
  });

  it("invert flips the unbound picture, same as it flips a bound reading", () => {
''',
)

replace_once(
    "src/editor-forms.test.ts",
    '''  it("sliding opening shows slide + style, hides hinge; biparting hides slide", () => {
''',
    '''  it("offers Static closed only for an unbound swing door", () => {
    const form = openingForm({ ...door, staticClosed: true } as Opening);
    const field = form.fields.find((x) => x.name === "staticClosed");
    expect(field?.label).toBe("Static closed");
    expect(field?.helper).toContain("unbound swing door");
    expect(form.data.staticClosed).toBe(true);

    expect(form.toPatch({ staticClosed: true })).toEqual({ staticClosed: true });
    expect(form.toPatch({ staticClosed: false })).toEqual({ staticClosed: undefined });
    expect(form.toPatch({ entity: "binary_sensor.door" })).toMatchObject({
      entity: "binary_sensor.door",
      staticClosed: undefined,
    });
    expect(form.toPatch({ motion: "slide" }).staticClosed).toBeUndefined();
    expect(form.toPatch({ type: "window" }).staticClosed).toBeUndefined();

    expect(
      openingForm({ ...door, entity: "binary_sensor.door" } as Opening).fields.map((x) => x.name)
    ).not.toContain("staticClosed");
    expect(openingForm({ ...door, type: "window" } as Opening).fields.map((x) => x.name))
      .not.toContain("staticClosed");
    expect(openingForm({ ...door, type: "skylight" } as Opening).fields.map((x) => x.name))
      .not.toContain("staticClosed");
    expect(openingForm({ ...door, motion: "slide" } as Opening).fields.map((x) => x.name))
      .not.toContain("staticClosed");
  });

  it("sliding opening shows slide + style, hides hinge; biparting hides slide", () => {
''',
)

replace_once(
    "src/editor-forms.test.ts",
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

print("STATIC_CLOSED_V191_PORT_APPLIED")
