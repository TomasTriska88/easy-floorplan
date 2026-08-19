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
   * A second contact / `cover` driving the opening's **other** leaf, for
''',
    '''  entity?: string;
  /**
   * Unbound swing doors only: draw the static leaf closed instead of the
   * ordinary open swing symbol. This is for a door that belongs on the plan
   * but has no position sensor. It is ignored once an entity is bound, and by
   * windows / sliding / rolling openings.
   */
  staticClosed?: boolean;
  /**
   * A second contact / `cover` driving the opening's **other** leaf, for
''',
)

replace_once(
    "src/render.ts",
    '''export function openingDefaultOpen(o: Opening): boolean {
  return o.type === "door" && openingMotion(o) === "swing";
}
''',
    '''export function openingDefaultOpen(o: Opening): boolean {
  // `staticClosed` is deliberately a static-only override. If somebody hand
  // edits a config and leaves it beside an entity, the live opening keeps the
  // ordinary fallback while that entity is still loading.
  return (
    o.type === "door" &&
    openingMotion(o) === "swing" &&
    (!o.staticClosed || !!o.entity)
  );
}
''',
)

replace_once(
    "src/editor-forms.ts",
    '''  fields.push({
    name: "entity",
    label: "Entity",
    helper: twoLeaves
      ? "Drives the first leaf; type and motion follow its device class"
      : "Type and motion follow the entity's device class",
    selector: { entity: { filter: [{ domain: ["binary_sensor", "cover"] }] } },
  });
  // One sensor per leaf (issues #145, #159). Only a two-leaved opening has a
''',
    '''  fields.push({
    name: "entity",
    label: "Entity",
    helper: twoLeaves
      ? "Drives the first leaf; type and motion follow its device class"
      : "Type and motion follow the entity's device class",
    selector: { entity: { filter: [{ domain: ["binary_sensor", "cover"] }] } },
  });
  if (motion === "swing" && o.type === "door" && !o.entity) {
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
          // A window is glass whatever this says, so only a door's answer is
''',
    '''        } else if (k === "type") {
          out.type = v;
          // A closed static leaf is a door-only idea. Do not leave a hidden
          // stale value behind if the element becomes a window.
          if (v !== "door") out.staticClosed = undefined;
        } else if (k === "staticClosed") {
          // False is the upstream/default behavior, so keep the YAML quiet.
          out.staticClosed = v ? true : undefined;
        } else if (k === "glazed") {
          // A window is glass whatever this says, so only a door's answer is
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
          // meaning and should not silently come back if it is unbound later.
          if (v) out.staticClosed = undefined;
          // The badge and its glyph only mean something with an entity to
''',
)

replace_once(
    "src/editor-forms.ts",
    '''          if (v !== "slide") out.sliderStyle = undefined;
          // The second leaf's sensor goes only if the opening this *becomes*
''',
    '''          if (v !== "slide") out.sliderStyle = undefined;
          if (v !== "swing") out.staticClosed = undefined;
          // The second leaf's sensor goes only if the opening this *becomes*
''',
)

replace_once(
    "src/render.test.ts",
    '''describe("openingDefaultOpen", () => {
  it("draws only swing doors open by default; windows and sliding openings closed", () => {
    expect(openingDefaultOpen({ type: "door" } as Opening)).toBe(true);
    expect(openingDefaultOpen({ type: "window" } as Opening)).toBe(false);
    expect(openingDefaultOpen({ type: "door", motion: "slide" } as Opening)).toBe(false);
    expect(openingDefaultOpen({ type: "window", motion: "slide" } as Opening)).toBe(false);
  });
});
''',
    '''describe("openingDefaultOpen", () => {
  it("draws only swing doors open by default; windows and sliding openings closed", () => {
    expect(openingDefaultOpen({ type: "door" } as Opening)).toBe(true);
    expect(openingDefaultOpen({ type: "window" } as Opening)).toBe(false);
    expect(openingDefaultOpen({ type: "door", motion: "slide" } as Opening)).toBe(false);
    expect(openingDefaultOpen({ type: "window", motion: "slide" } as Opening)).toBe(false);
  });

  it("lets an unbound swing door opt into a closed static drawing", () => {
    const staticDoor = { type: "door", staticClosed: true } as Opening;
    expect(openingDefaultOpen(staticDoor)).toBe(false);
    expect(resolveOpeningOpen(staticDoor, undefined)).toBe(false);
    expect(resolveOpeningAmount(staticDoor, undefined)).toBe(0);

    // `staticClosed` never competes with a live state, even if hand-written
    // YAML happens to leave both keys behind.
    const bound = { ...staticDoor, entity: "binary_sensor.door" } as Opening;
    expect(openingDefaultOpen(bound)).toBe(true);
    expect(resolveOpeningAmount(bound, { state: "on" })).toBe(1);
    expect(resolveOpeningAmount(bound, { state: "off" })).toBe(0);
  });
});
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
    expect(form.toPatch({ entity: "binary_sensor.door" })).toEqual({
      entity: "binary_sensor.door",
      staticClosed: undefined,
    });
    expect(form.toPatch({ motion: "slide" }).staticClosed).toBeUndefined();
    expect(form.toPatch({ motion: "roll" }).staticClosed).toBeUndefined();
    expect(form.toPatch({ type: "window" })).toEqual({
      type: "window",
      staticClosed: undefined,
    });

    expect(
      openingForm({ ...door, entity: "binary_sensor.door" } as Opening).fields.map((x) => x.name)
    ).not.toContain("staticClosed");
    expect(openingForm({ ...door, type: "window" } as Opening).fields.map((x) => x.name))
      .not.toContain("staticClosed");
    expect(openingForm({ ...door, motion: "slide" } as Opening).fields.map((x) => x.name))
      .not.toContain("staticClosed");
    expect(openingForm({ ...door, motion: "roll" } as Opening).fields.map((x) => x.name))
      .not.toContain("staticClosed");
  });

  it("sliding opening shows slide + style, hides hinge; biparting hides slide", () => {
''',
)

replace_once(
    "README.md",
    '''Drop a **door** or **window** from the toolbar and it snaps onto the nearest wall. Left
unbound it stays a static drawing. Bind an **Entity** — a contact `binary_sensor` or a
`cover` — and the opening tracks its real state. The card reads the entity's HA
''',
    '''Drop a **door** or **window** from the toolbar and it snaps onto the nearest wall. Left
unbound it stays a static drawing. Swing doors use the familiar open leaf by default;
enable **Static closed** to draw an unbound swing door shut. Bind an **Entity** — a
contact `binary_sensor` or a `cover` — and the opening tracks its real state. The card
reads the entity's HA
''',
)

print("STATIC_CLOSED_V143_PORT_APPLIED")
