import { describe, expect, it } from "vitest";
import type { FloorplanCardConfig } from "./types";
import { projectReliefForm } from "./editor-forms";

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

describe("ambient daylight editor contract", () => {
  it("shows ambient daylight independently of direct sunlight", () => {
    const form = projectReliefForm(config());
    expect(form.fields.map((field) => field.name)).toEqual(["ambientDaylight", "sunlight"]);
    expect(form.data.ambientDaylight).toBe(false);
  });

  it("shows room-to-room propagation only while ambient daylight is enabled", () => {
    const off = projectReliefForm(config());
    expect(off.fields.some((field) => field.name === "ambientDaylightPropagation")).toBe(false);

    const on = projectReliefForm(config({ ambientDaylight: true }));
    expect(on.fields.slice(0, 3).map((field) => field.name)).toEqual([
      "ambientDaylight",
      "ambientDaylightPropagation",
      "sunlight",
    ]);
    expect(on.data.ambientDaylightPropagation).toBe(false);
    expect(on.fields.find((field) => field.name === "ambientDaylightPropagation")?.helper).toContain(
      "fading in each room",
    );
  });

  it("stores only explicit ambient opt-ins and clears propagation with its parent", () => {
    const form = projectReliefForm(config({ ambientDaylight: true }));

    expect(form.toPatch({ ambientDaylightPropagation: true })).toEqual({
      ambientDaylightPropagation: true,
    });
    expect(form.toPatch({ ambientDaylightPropagation: false })).toEqual({
      ambientDaylightPropagation: undefined,
    });
    expect(
      form.toPatch({
        ambientDaylight: false,
        ambientDaylightPropagation: true,
      }),
    ).toEqual({
      ambientDaylight: undefined,
      ambientDaylightPropagation: undefined,
    });
  });

  it("keeps ambient daylight and propagation enabled when direct sunlight is switched off", () => {
    const form = projectReliefForm(
      config({
        ambientDaylight: true,
        ambientDaylightPropagation: true,
        sunlight: true,
      }),
    );
    const patch = form.toPatch({
      ambientDaylight: true,
      ambientDaylightPropagation: true,
      sunlight: false,
    });
    expect(patch.ambientDaylight).toBe(true);
    expect(patch.ambientDaylightPropagation).toBe(true);
    expect(patch.sunlight).toBeUndefined();
  });
});
