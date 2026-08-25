import { describe, expect, it } from "vitest";
import type { Floor } from "./types";
import { ambientDaylightTopologyForFloor } from "./ambient-daylight-integration";

function floor(): Floor {
  return {
    id: "ground",
    name: "Ground",
    walls: [],
    openings: [
      { id: "outside", type: "window", x: 0, y: 50, length: 30, angle: 90 },
      { id: "door", type: "door", x: 100, y: 50, length: 30, angle: 90 },
    ],
    items: [],
    texts: [],
    furniture: [],
    trackers: [],
    areas: [
      { id: "A", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] },
      { id: "B", points: [{ x: 100, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 100, y: 100 }] },
    ],
  };
}

describe("ambient daylight topology cache", () => {
  it("reuses geometry while only live HA state changes", () => {
    const f = floor();
    const first = ambientDaylightTopologyForFloor(f);
    const second = ambientDaylightTopologyForFloor(f);
    expect(second).toBe(first);
  });

  it("invalidates when an opening moves without requiring a new floor object", () => {
    const f = floor();
    const first = ambientDaylightTopologyForFloor(f);
    f.openings[1]!.x = 200;
    const second = ambientDaylightTopologyForFloor(f);
    expect(second).not.toBe(first);
  });

  it("invalidates when Area geometry changes in place", () => {
    const f = floor();
    const first = ambientDaylightTopologyForFloor(f);
    f.areas[1]!.points[0]!.x = 110;
    const second = ambientDaylightTopologyForFloor(f);
    expect(second).not.toBe(first);
  });
});
