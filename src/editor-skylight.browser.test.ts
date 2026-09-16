/**
 * Placing a skylight, in a real browser.
 *
 * The node suite covers the geometry and the form, but neither of them goes
 * through the editor: the tool button, the two size boxes beside it, and the
 * click on the canvas that turns those into an opening. That path is short,
 * and it is also the one place where a roof light has to behave *unlike* every
 * other opening — it must not snap to a wall — so it is worth a test that
 * actually presses the button (issue #285 review).
 *
 * Real Chromium for the same reason as the drag tests: placement maps the
 * pointer through the SVG's live `getScreenCTM()`, which a DOM shim either
 * lacks or fakes as the identity, so a coordinate regression would pass
 * against the bug.
 */
import { afterEach, describe, expect, it } from "vitest";
import "./editor";
import type { FloorplanCardEditor } from "./editor";
import type { FloorplanCardConfig, Opening } from "./types";

/** A wall to aim at, so "did it snap?" is a question with a visible answer. */
const WALL = { id: "w1", x1: 0, y1: 300, x2: 1000, y2: 300 };

function config(): FloorplanCardConfig {
  return {
    type: "custom:easy-floorplan-card",
    width: 1000,
    height: 600,
    grid: 20,
    // Free placement: the opening lands where the pointer maps to, so nothing
    // below has to do snapping arithmetic to know where it should have gone.
    snap: 0,
    floors: [
      {
        id: "f1",
        name: "Floor 1",
        walls: [WALL],
        openings: [],
        items: [],
        texts: [],
        furniture: [],
        trackers: [],
        areas: [],
      },
    ],
  };
}

function pointer(target: Element, type: string, clientX: number, clientY: number): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      clientX,
      clientY,
      pointerId: 5,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      bubbles: true,
      composed: true,
      cancelable: true,
    })
  );
}

async function mountEditor() {
  const host = document.createElement("div");
  host.style.width = "900px";
  document.body.appendChild(host);

  const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
  ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
  ed.setConfig(config());
  host.appendChild(ed);
  await ed.updateComplete;

  const root = ed.shadowRoot!;
  const emitted: FloorplanCardConfig[] = [];
  ed.addEventListener("config-changed", (ev) => {
    emitted.push((ev as CustomEvent<{ config: FloorplanCardConfig }>).detail.config);
  });

  return {
    ed,
    emitted,
    svg: root.querySelector<SVGSVGElement>("svg")!,
    /** Pick a drawing tool by the label its button carries. */
    async tool(label: string) {
      root.querySelector<HTMLButtonElement>(`button[title="${label}"]`)!.click();
      await ed.updateComplete;
    },
    /** The context bar's number boxes, in the order the bar renders them. */
    sizeBoxes: () => [...root.querySelectorAll<HTMLInputElement>(".context-bar input.num")],
    /** Click a point in plan coordinates. */
    async click(x: number, y: number) {
      const r = root.querySelector<SVGSVGElement>("svg")!.getBoundingClientRect();
      pointer(root.querySelector("svg")!, "pointerdown", r.left + (x / 1000) * r.width, r.top + (y / 600) * r.height);
      await ed.updateComplete;
    },
    openings: () => (emitted[emitted.length - 1]?.floors![0].openings ?? []) as Opening[],
  };
}

describe("placing a skylight", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("drops where you clicked and does not snap to the wall", async () => {
    const t = await mountEditor();
    await t.tool("Skylight");
    // Well inside the wall's snap distance — a door or window dropped here
    // would jump onto it and take its angle. A hole in the ceiling must not.
    await t.click(400, 292);

    const [o] = t.openings();
    expect(o?.type).toBe("skylight");
    expect(o!.y).not.toBe(WALL.y1);
    expect(o!.y).toBeCloseTo(292, 0);
    expect(o!.x).toBeCloseTo(400, 0);
    expect(o!.angle).toBe(0);
  });

  it("carries the length and width set before placing", async () => {
    const t = await mountEditor();
    await t.tool("Skylight");
    const [length, width] = t.sizeBoxes();
    // Two boxes, because a roof light is the one opening with two sides.
    expect(t.sizeBoxes().length).toBe(2);

    length!.value = "130";
    length!.dispatchEvent(new Event("change", { bubbles: true }));
    width!.value = "70";
    width!.dispatchEvent(new Event("change", { bubbles: true }));
    await t.ed.updateComplete;

    await t.click(300, 150);
    const [o] = t.openings();
    expect(o!.length).toBe(130);
    expect(o!.width).toBe(70);
  });

  it("still snaps a window onto the wall from the same click", async () => {
    // The other half of the first test: if the harness had simply failed to
    // reach the snapping code, the skylight assertion would pass for the wrong
    // reason. A window dropped at the same point must land on the wall.
    const t = await mountEditor();
    await t.tool("Window");
    await t.click(400, 292);

    const [o] = t.openings();
    expect(o?.type).toBe("window");
    expect(o!.y).toBe(WALL.y1);
    expect(o!.width).toBeUndefined();
  });
});
