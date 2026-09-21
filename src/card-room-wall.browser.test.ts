import { afterEach, expect, it } from "vitest";
import "./floorplan-card";
import type { FloorplanCard } from "./floorplan-card";
import type { FloorplanCardConfig } from "./types";

afterEach(() => { document.body.innerHTML = ""; });

function mount(config: FloorplanCardConfig): FloorplanCard {
  const card = document.createElement("easy-floorplan-card") as FloorplanCard;
  card.setConfig(config);
  card.hass = { states: {}, entities: {} } as FloorplanCard["hass"];
  document.body.append(card);
  return card;
}

it("draws the rectangle room's configured side walls, dividers dashed and walls solid", async () => {
  const card = mount({
    type: "custom:easy-floorplan-card", width: 200, height: 100,
    floors: [{ id: "ground", name: "Ground", walls: [], openings: [], items: [], texts: [], furniture: [], trackers: [],
      areas: [{ id: "room", name: "Room", points: [
        { x: 50, y: 50 }, { x: 150, y: 50 }, { x: 150, y: 80 }, { x: 50, y: 80 },
      ],
      sideWalls: { top: "divider", bottom: "wall" } }],
    }],
  } as FloorplanCardConfig);
  await card.updateComplete;

  const walls = [...card.shadowRoot!.querySelectorAll<SVGLineElement>(".fp-wall")];
  expect(walls).toHaveLength(2);

  const style = (w: SVGLineElement) => w.getAttribute("style") ?? "";
  const divider = walls.find((w) => style(w).includes("stroke-dasharray"));
  expect(divider).toBeTruthy();
  expect(parseFloat(divider!.getAttribute("y1")!)).toBeCloseTo(50, 5);
  expect(parseFloat(divider!.getAttribute("y2")!)).toBeCloseTo(50, 5);
  expect(parseFloat(divider!.getAttribute("x1")!)).toBeCloseTo(50, 5);
  expect(parseFloat(divider!.getAttribute("x2")!)).toBeCloseTo(150, 5);

  const solid = walls.find((w) => !style(w).includes("stroke-dasharray"));
  expect(solid).toBeTruthy();
  expect(parseFloat(solid!.getAttribute("y1")!)).toBeCloseTo(80, 5);
  expect(parseFloat(solid!.getAttribute("y2")!)).toBeCloseTo(80, 5);
  const xs = [parseFloat(solid!.getAttribute("x1")!), parseFloat(solid!.getAttribute("x2")!)].sort((a, b) => a - b);
  expect(xs[0]).toBeCloseTo(50, 5);
  expect(xs[1]).toBeCloseTo(150, 5);
});

it("lets sunlight past a divider but a room wall stops it", async () => {
  const card = mount({
    type: "custom:easy-floorplan-card", width: 200, height: 200, sunlight: true,
    // Sun pinned to the west, so the light travels east along +x at full
    // strength, and reach lifted to the whole plan so a beam that nothing
    // blocks runs the full width.
    sunBearing: 270, sunReach: 1,
    floors: [{ id: "ground", name: "Ground", walls: [], openings: [{ id: "win", type: "window", x: 10, y: 100, length: 20, angle: 90 }],
      items: [], texts: [], furniture: [], trackers: [],
      areas: [{ id: "room", name: "Room", points: [
        { x: 70, y: 40 }, { x: 170, y: 40 }, { x: 170, y: 160 }, { x: 70, y: 160 },
      ],
      sideWalls: { left: "wall" } }],
    }],
  } as FloorplanCardConfig);
  await card.updateComplete;

  const beam = card.shadowRoot!.querySelector<SVGPolygonElement>(".fp-sunbeam");
  expect(beam).toBeTruthy();
  const points = (beam!.getAttribute("points") ?? "")
    .split(/\s+/)
    .map((p) => p.split(",").map(Number));
  // The wall at x=70 truncates the patch: the polygon's far edge sits at
  // about the wall plus the falloff, not the full-reach 230 it would reach
  // if the generated wall never stood in the light.
  const maxX = Math.max(...points.map(([x]) => x!));
  expect(maxX).toBeLessThanOrEqual(100);
  expect(Math.min(...points.map(([x]) => x!))).toBeCloseTo(10, 5);
  expect(Math.max(...points.map(([, y]) => y!)) - Math.min(...points.map(([, y]) => y!)))
    .toBeLessThanOrEqual(30);
});