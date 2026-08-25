import { nothing } from "lit";
import { describe, expect, it } from "vitest";
import type { Floor, FloorplanCardConfig, HomeAssistant, Opening } from "./types";
import {
  ambientDaylightEnabled,
  ambientDaylightPropagationEnabled,
  renderAmbientDaylightLayer,
} from "./ambient-daylight-integration";
import { collectWatchedEntities } from "./render";

function config(extra: Partial<FloorplanCardConfig> = {}): FloorplanCardConfig {
  return {
    type: "custom:easy-floorplan-card",
    width: 100,
    height: 100,
    walls: [],
    openings: [],
    items: [],
    texts: [],
    furniture: [],
    trackers: [],
    areas: [],
    ...extra,
  };
}

function floor(): Floor {
  return {
    id: "ground",
    name: "Ground",
    walls: [],
    openings: [{ id: "north-window", type: "window", x: 50, y: 0, length: 30, angle: 0 }],
    items: [],
    texts: [],
    furniture: [],
    trackers: [],
    areas: [
      {
        id: "bedroom",
        name: "Bedroom",
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
      },
    ],
  };
}

function twoRoomFloor(): Floor {
  return {
    id: "ground",
    name: "Ground",
    walls: [],
    openings: [
      { id: "outside", type: "window", x: 0, y: 50, length: 30, angle: 90 },
      { id: "ab", type: "door", x: 100, y: 50, length: 30, angle: 90 },
    ],
    items: [],
    texts: [],
    furniture: [],
    trackers: [],
    areas: [
      {
        id: "A",
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
      },
      {
        id: "B",
        points: [
          { x: 100, y: 0 },
          { x: 200, y: 0 },
          { x: 200, y: 100 },
          { x: 100, y: 100 },
        ],
      },
    ],
  };
}

const openingState = {
  amount: () => 0,
  secondAmount: () => undefined,
};

function hassWithElevation(elevation: unknown): HomeAssistant {
  return {
    states: {
      "sun.sun": {
        state: "above_horizon",
        attributes: { elevation },
      },
    },
  } as unknown as HomeAssistant;
}

describe("ambient daylight host integration", () => {
  it("keeps propagation as a second strict opt-in while using the same central sun watcher", () => {
    expect(ambientDaylightEnabled(config())).toBe(false);
    expect(ambientDaylightEnabled(config({ ambientDaylight: false }))).toBe(false);
    expect(ambientDaylightEnabled(config({ ambientDaylight: true }))).toBe(true);

    expect(ambientDaylightPropagationEnabled(config())).toBe(false);
    expect(
      ambientDaylightPropagationEnabled(config({ ambientDaylightPropagation: true })),
    ).toBe(false);
    expect(ambientDaylightPropagationEnabled(config({ ambientDaylight: true }))).toBe(false);
    expect(
      ambientDaylightPropagationEnabled(
        config({ ambientDaylight: true, ambientDaylightPropagation: true }),
      ),
    ).toBe(true);

    expect(collectWatchedEntities(config())).not.toContain("sun.sun");
    expect(collectWatchedEntities(config({ ambientDaylight: true }))).toContain("sun.sun");
  });

  it("returns no layer while disabled or without Area geometry", () => {
    expect(renderAmbientDaylightLayer(floor(), config(), undefined, "card-a", openingState)).toBe(
      nothing,
    );
    const noAreas = floor();
    noAreas.areas = [];
    expect(
      renderAmbientDaylightLayer(
        noAreas,
        config({ ambientDaylight: true }),
        undefined,
        "card-a",
        openingState,
      ),
    ).toBe(nothing);
  });

  it("builds a daytime layer from an exterior window without direct sunlight", () => {
    expect(
      renderAmbientDaylightLayer(
        floor(),
        config({ ambientDaylight: true, sunlight: false }),
        hassWithElevation(25),
        "card-a",
        openingState,
      ),
    ).not.toBe(nothing);
  });

  it("keeps the exact V1 lazy opening-state path until propagation is explicitly enabled", () => {
    const calls: string[] = [];
    const trackedState = {
      amount: (opening: Opening) => {
        calls.push(opening.id);
        return opening.id === "ab" ? 1 : 0;
      },
      secondAmount: () => undefined,
    };

    expect(
      renderAmbientDaylightLayer(
        twoRoomFloor(),
        config({ ambientDaylight: true }),
        hassWithElevation(25),
        "card-v1",
        trackedState,
      ),
    ).not.toBe(nothing);
    expect([...new Set(calls)]).toEqual(["outside"]);

    calls.length = 0;
    expect(
      renderAmbientDaylightLayer(
        twoRoomFloor(),
        config({ ambientDaylight: true, ambientDaylightPropagation: true }),
        hassWithElevation(25),
        "card-prop",
        trackedState,
      ),
    ).not.toBe(nothing);
    expect([...new Set(calls)].sort()).toEqual(["ab", "outside"]);
  });

  it("fails dark while sun elevation is missing or unreadable", () => {
    expect(
      renderAmbientDaylightLayer(
        floor(),
        config({ ambientDaylight: true }),
        undefined,
        "card-a",
        openingState,
      ),
    ).toBe(nothing);
    expect(
      renderAmbientDaylightLayer(
        floor(),
        config({ ambientDaylight: true }),
        hassWithElevation("unavailable"),
        "card-a",
        openingState,
      ),
    ).toBe(nothing);
  });
});
