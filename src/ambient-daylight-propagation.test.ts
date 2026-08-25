import { describe, expect, it } from "vitest";
import type { Area, Opening } from "./types";
import {
  ambientPropagationPatches,
  buildAmbientDaylightTopology,
  DEFAULT_AMBIENT_DAYLIGHT_MAX_HOPS,
  DEFAULT_AMBIENT_DAYLIGHT_PROPAGATION_DECAY,
  propagateAmbientDaylight,
  type AmbientDaylightTopology,
  type AmbientInteriorConnection,
} from "./ambient-daylight-propagation";
import type { AmbientOpeningSource } from "./ambient-daylight";

function rect(id: string, x1: number, y1: number, x2: number, y2: number): Area {
  return {
    id,
    points: [
      { x: x1, y: y1 },
      { x: x2, y: y1 },
      { x: x2, y: y2 },
      { x: x1, y: y2 },
    ],
  };
}

function opening(id: string, x: number, y: number, overrides: Partial<Opening> = {}): Opening {
  return {
    id,
    type: "door",
    x,
    y,
    length: 40,
    angle: 90,
    ...overrides,
  };
}

function source(openingId: string, areaId: string): AmbientOpeningSource {
  return {
    openingId,
    areaId,
    x: 0,
    y: 50,
    inwardX: 1,
    inwardY: 0,
    length: 40,
  };
}

function edge(openingId: string, a: string, b: string): AmbientInteriorConnection {
  return {
    openingId,
    areaAId: a,
    areaBId: b,
    intoA: source(openingId, a),
    intoB: source(openingId, b),
  };
}

function syntheticTopology(
  areaIds: string[],
  connections: AmbientInteriorConnection[],
): AmbientDaylightTopology {
  return {
    areaIds: [...areaIds].sort(),
    exteriorSources: [source("outside", "A")],
    interiorConnections: [...connections].sort((a, b) => a.openingId.localeCompare(b.openingId)),
  };
}

function snapshot(result: ReturnType<typeof propagateAmbientDaylight>) {
  return {
    areaEnergy: [...result.areaEnergy.entries()].sort(([a], [b]) => a.localeCompare(b)),
    hops: [...result.hops.entries()].sort(([a], [b]) => a.localeCompare(b)),
    transfers: result.transfers.map((t) => ({
      openingId: t.openingId,
      fromAreaId: t.fromAreaId,
      toAreaId: t.toAreaId,
      hop: t.hop,
      energy: t.energy,
    })),
  };
}

describe("ambient daylight room-graph propagation", () => {
  it("keeps the exterior opening as the only primary source in one room", () => {
    const room = rect("A", 0, 0, 100, 100);
    const outside = opening("outside", 0, 50, { type: "window" });
    const topology = buildAmbientDaylightTopology([room], [outside]);

    expect(topology.exteriorSources.map((s) => [s.openingId, s.areaId])).toEqual([["outside", "A"]]);
    expect(topology.interiorConnections).toEqual([]);

    const result = propagateAmbientDaylight(topology, 30, () => 1);
    expect(result.areaEnergy.get("A")).toBe(1);
    expect(result.hops.get("A")).toBe(0);
    expect(result.transfers).toEqual([]);
  });

  it("propagates through an open interior door with one hop of decay", () => {
    const topology = syntheticTopology(["A", "B"], [edge("ab", "A", "B")]);
    const result = propagateAmbientDaylight(topology, 30, () => 1);

    expect(result.areaEnergy.get("A")).toBe(1);
    expect(result.areaEnergy.get("B")).toBeCloseTo(DEFAULT_AMBIENT_DAYLIGHT_PROPAGATION_DECAY, 12);
    expect(result.hops.get("B")).toBe(1);
    expect(result.transfers).toHaveLength(1);
    expect(result.transfers[0]).toMatchObject({ openingId: "ab", fromAreaId: "A", toAreaId: "B", hop: 1 });
  });

  it("a closed opaque interior door blocks propagation", () => {
    const topology = syntheticTopology(["A", "B"], [edge("ab", "A", "B")]);
    const result = propagateAmbientDaylight(topology, 30, (id) => (id === "outside" ? 1 : 0));

    expect(result.areaEnergy.get("A")).toBe(1);
    expect(result.areaEnergy.has("B")).toBe(false);
    expect(result.transfers).toEqual([]);
  });

  it("a transmitting closed glazed opening can carry diffuse light", () => {
    const topology = syntheticTopology(["A", "B"], [edge("ab-glass", "A", "B")]);
    const result = propagateAmbientDaylight(topology, 30, () => 1);

    expect(result.areaEnergy.get("B")).toBeCloseTo(0.55, 12);
  });

  it("partial opening amount scales the transfer before hop decay", () => {
    const topology = syntheticTopology(["A", "B"], [edge("ab", "A", "B")]);
    const result = propagateAmbientDaylight(
      topology,
      30,
      (id) => (id === "ab" ? 0.5 : 1),
    );

    expect(result.areaEnergy.get("B")).toBeCloseTo(0.55 * 0.5, 12);
  });

  it("attenuates each further room and stops at the default hop limit", () => {
    const topology = syntheticTopology(
      ["A", "B", "C", "D", "E"],
      [edge("ab", "A", "B"), edge("bc", "B", "C"), edge("cd", "C", "D"), edge("de", "D", "E")],
    );
    const result = propagateAmbientDaylight(topology, 30, () => 1);

    expect(DEFAULT_AMBIENT_DAYLIGHT_MAX_HOPS).toBe(3);
    expect(result.areaEnergy.get("B")).toBeCloseTo(0.55, 12);
    expect(result.areaEnergy.get("C")).toBeCloseTo(0.55 ** 2, 12);
    expect(result.areaEnergy.get("D")).toBeCloseTo(0.55 ** 3, 12);
    expect(result.areaEnergy.has("E")).toBe(false);
    expect(result.hops.get("D")).toBe(3);
  });

  it("turns a cyclic Area graph into shortest-hop daylight flow without feedback", () => {
    const topology = syntheticTopology(
      ["A", "B", "C"],
      [edge("ab", "A", "B"), edge("ac", "A", "C"), edge("bc", "B", "C")],
    );
    const result = propagateAmbientDaylight(topology, 30, () => 1);

    expect(result.hops.get("A")).toBe(0);
    expect(result.hops.get("B")).toBe(1);
    expect(result.hops.get("C")).toBe(1);
    expect(result.areaEnergy.get("A")).toBe(1);
    expect(result.areaEnergy.get("B")).toBeCloseTo(0.55, 12);
    expect(result.areaEnergy.get("C")).toBeCloseTo(0.55, 12);
    expect(result.transfers.map((t) => t.openingId)).toEqual(["ab", "ac"]);
  });

  it("combines multiple equal-shortest paths but keeps energy bounded", () => {
    const topology = syntheticTopology(
      ["A", "B", "C", "D"],
      [edge("ab", "A", "B"), edge("ac", "A", "C"), edge("bd", "B", "D"), edge("cd", "C", "D")],
    );
    const result = propagateAmbientDaylight(topology, 30, () => 1);
    const onePath = 0.55 ** 2;
    const expected = 1 - (1 - onePath) ** 2;

    expect(result.hops.get("D")).toBe(2);
    expect(result.areaEnergy.get("D")).toBeCloseTo(expected, 12);
    expect(result.areaEnergy.get("D")).toBeLessThanOrEqual(1);
    expect(result.transfers.filter((t) => t.toAreaId === "D")).toHaveLength(2);
  });

  it("leaves an unconnected Area dark", () => {
    const topology = syntheticTopology(["A", "B", "isolated"], [edge("ab", "A", "B")]);
    const result = propagateAmbientDaylight(topology, 30, () => 1);
    expect(result.areaEnergy.has("isolated")).toBe(false);
    expect(result.hops.has("isolated")).toBe(false);
  });

  it("fails conservatively when an interior topology side is missing", () => {
    const a = rect("A", 0, 0, 100, 100);
    const unrelated = rect("C", 300, 0, 400, 100);
    const exterior = opening("outside", 0, 50, { type: "window" });
    // In a complete A/B plan this would sit on the A/B boundary. B is absent,
    // so it must never become an A→C propagation edge through unknown space.
    const dangling = opening("dangling", 100, 50, { type: "door" });
    const topology = buildAmbientDaylightTopology([a, unrelated], [exterior, dangling]);

    expect(topology.interiorConnections).toEqual([]);
    const result = propagateAmbientDaylight(topology, 30, (id) => (id === "outside" ? 1 : 0));
    expect(result.areaEnergy.get("A")).toBe(1);
    expect(result.areaEnergy.has("C")).toBe(false);
  });

  it("fails dark at night and on invalid sun elevation", () => {
    const topology = syntheticTopology(["A", "B"], [edge("ab", "A", "B")]);
    for (const elevation of [-10, null, undefined, "unavailable", Number.NaN]) {
      const result = propagateAmbientDaylight(topology, elevation, () => 1);
      expect(result.areaEnergy.size).toBe(0);
      expect(result.transfers).toEqual([]);
    }
  });

  it("is deterministic when Areas and openings are reordered", () => {
    const a = rect("A", 0, 0, 100, 100);
    const b = rect("B", 100, 0, 200, 100);
    const c = rect("C", 200, 0, 300, 100);
    const outside = opening("outside", 0, 50, { type: "window" });
    const ab = opening("ab", 100, 50);
    const bc = opening("bc", 200, 50);

    const first = buildAmbientDaylightTopology([a, b, c], [outside, ab, bc]);
    const reversed = buildAmbientDaylightTopology([c, b, a], [bc, ab, outside]);
    const transmission = (id: string) => (id === "bc" ? 0.7 : 1);

    expect(snapshot(propagateAmbientDaylight(first, 30, transmission))).toEqual(
      snapshot(propagateAmbientDaylight(reversed, 30, transmission)),
    );
  });

  it("never exceeds the normalized upper limit even with many paths", () => {
    const middle = Array.from({ length: 12 }, (_, i) => `B${String(i).padStart(2, "0")}`);
    const connections: AmbientInteriorConnection[] = [];
    for (const id of middle) {
      connections.push(edge(`a-${id}`, "A", id));
      connections.push(edge(`${id}-d`, id, "D"));
    }
    const topology = syntheticTopology(["A", ...middle, "D"], connections);
    const result = propagateAmbientDaylight(topology, 30, () => 1);

    expect(result.areaEnergy.get("D")).toBeGreaterThan(0.55 ** 2);
    expect(result.areaEnergy.get("D")).toBeLessThanOrEqual(1);
    for (const energy of result.areaEnergy.values()) {
      expect(energy).toBeGreaterThanOrEqual(0);
      expect(energy).toBeLessThanOrEqual(1);
    }
  });

  it("resolves each dynamic opening transmission once even on a large graph", () => {
    const roomCount = 140;
    const areaIds = Array.from({ length: roomCount }, (_, i) => (i === 0 ? "A" : `R${i}`));
    const connections = Array.from({ length: roomCount - 1 }, (_, i) =>
      edge(`door-${i}`, areaIds[i]!, areaIds[i + 1]!),
    );
    const topology = syntheticTopology(areaIds, connections);
    let calls = 0;
    const result = propagateAmbientDaylight(topology, 30, () => {
      calls++;
      return 1;
    });

    // exterior source + every interior edge, once each: O(E), not once per
    // route/hop. The fixed three-hop bound also means only four rooms light.
    expect(calls).toBe(roomCount);
    expect(result.areaEnergy.size).toBe(DEFAULT_AMBIENT_DAYLIGHT_MAX_HOPS + 1);
  });

  it("paints each transferred hop as a softer patch from its interior opening", () => {
    const a = rect("A", 0, 0, 100, 100);
    const b = rect("B", 100, 0, 200, 100);
    const c = rect("C", 200, 0, 300, 100);
    const topology = buildAmbientDaylightTopology(
      [a, b, c],
      [
        opening("outside", 0, 50, { type: "window" }),
        opening("ab", 100, 50),
        opening("bc", 200, 50),
      ],
    );
    const propagation = propagateAmbientDaylight(topology, 30, () => 1);
    const bPatch = ambientPropagationPatches(b, propagation);
    const cPatch = ambientPropagationPatches(c, propagation);

    expect(bPatch).toHaveLength(1);
    expect(cPatch).toHaveLength(1);
    expect(bPatch[0]?.openingId).toBe("ab");
    expect(cPatch[0]?.openingId).toBe("bc");
    expect(bPatch[0]!.opacity).toBeGreaterThan(cPatch[0]!.opacity);
    expect(cPatch[0]!.opacity).toBeGreaterThan(0);
  });
});
