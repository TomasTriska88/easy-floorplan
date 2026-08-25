import { describe, expect, it } from "vitest";
import type { Area, Opening } from "./types";
import { ambientOpeningTransmission } from "./ambient-daylight";
import { buildAmbientDaylightTopology, propagateAmbientDaylight } from "./ambient-daylight-propagation";

function rect(id: string, x1: number, x2: number): Area {
  return {
    id,
    points: [
      { x: x1, y: 0 },
      { x: x2, y: 0 },
      { x: x2, y: 100 },
      { x: x1, y: 100 },
    ],
  };
}

function twoRoomPlan(door: Partial<Opening> = {}) {
  const areas = [rect("A", 0, 100), rect("B", 100, 200)];
  const openings: Opening[] = [
    { id: "outside", type: "window", x: 0, y: 50, length: 40, angle: 90 },
    { id: "ab", type: "door", x: 100, y: 50, length: 40, angle: 90, ...door },
  ];
  return { areas, openings, topology: buildAmbientDaylightTopology(areas, openings) };
}

function resultFor(
  door: Partial<Opening>,
  openFraction: number,
  shutterOpenFraction = 1,
) {
  const plan = twoRoomPlan(door);
  const byId = new Map(plan.openings.map((opening) => [opening.id, opening]));
  return propagateAmbientDaylight(plan.topology, 30, (id) => {
    const opening = byId.get(id)!;
    return ambientOpeningTransmission(
      opening,
      id === "ab" ? openFraction : 0,
      id === "ab" ? shutterOpenFraction : 1,
    );
  });
}

describe("ambient propagation reuses opening transmission physics", () => {
  it("blocks a closed opaque door", () => {
    const result = resultFor({ type: "door", glazed: false }, 0);
    expect(result.areaEnergy.get("A")).toBe(1);
    expect(result.areaEnergy.has("B")).toBe(false);
  });

  it("transmits through a closed glazed door", () => {
    const result = resultFor({ type: "door", glazed: true }, 0);
    expect(result.areaEnergy.get("B")).toBeCloseTo(0.55, 12);
  });

  it("scales an opaque door by its partial opening amount", () => {
    const result = resultFor({ type: "door", glazed: false }, 0.4);
    expect(result.areaEnergy.get("B")).toBeCloseTo(0.55 * 0.4, 12);
  });

  it("reuses shutter transmission on the interior opening", () => {
    const result = resultFor({ type: "door", glazed: true }, 0, 0.25);
    expect(result.areaEnergy.get("B")).toBeCloseTo(0.55 * 0.25, 12);
  });

  it("honours the existing sunlight:false light opt-out on an interior edge", () => {
    const result = resultFor({ type: "door", glazed: true, sunlight: false }, 1);
    expect(result.areaEnergy.has("B")).toBe(false);
  });
});
