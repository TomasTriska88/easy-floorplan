import { nothing, svg, type SVGTemplateResult } from "lit";
import type { Floor, FloorplanCardConfig, HomeAssistant, Opening } from "./types";
import { openingClearFraction, shutterAmount } from "./render";
import {
  ambientDaylightDayFactor,
  ambientDaylightPatches,
  ambientOpeningTransmission,
} from "./ambient-daylight";
import {
  ambientPropagationPatches,
  buildAmbientDaylightTopology,
  propagateAmbientDaylight,
  type AmbientDaylightTopology,
} from "./ambient-daylight-propagation";
import { renderAmbientDaylight } from "./ambient-daylight-render";

/** Explicit opt-in: existing plans remain on their old render path. */
export function ambientDaylightEnabled(
  config: Pick<FloorplanCardConfig, "ambientDaylight"> | null | undefined,
): boolean {
  return config?.ambientDaylight === true;
}

export interface AmbientDaylightOpeningState {
  /** Primary opening travel, normalized to 0..1 by the card's existing resolver. */
  amount(opening: Opening): number;
  /** Optional second-leaf travel for two-panel openings. */
  secondAmount(opening: Opening): number | undefined;
}

interface CachedAmbientTopology {
  signature: string;
  topology: AmbientDaylightTopology;
}

/**
 * Geometry changes rarely compared with HA entity states. Keep the O(A×O)
 * Area-boundary classification out of ordinary sun/door/shutter renders; the
 * live path below is then a bounded O(A+O+E) graph update.
 */
const ambientTopologyCache = new WeakMap<object, CachedAmbientTopology>();

function ambientTopologySignature(floor: Pick<Floor, "areas" | "openings">): string {
  // Intentionally linear and order-sensitive. Reordering config merely causes
  // one harmless rebuild; the topology builder itself sorts by id, so the
  // result remains order-independent. In-place editor geometry changes are
  // still detected because coordinates are included rather than relying only
  // on array identity.
  let signature = `a${floor.areas.length}|o${floor.openings.length}|`;
  for (const area of floor.areas) {
    signature += `${area.id}:${area.points.length}:`;
    for (const point of area.points) signature += `${point.x},${point.y};`;
    signature += "|";
  }
  for (const opening of floor.openings) {
    signature += `${opening.id}:${opening.x},${opening.y},${opening.length}|`;
  }
  return signature;
}

/** Exported for the cache/complexity regression test. */
export function ambientDaylightTopologyForFloor(
  floor: Pick<Floor, "areas" | "openings">,
): AmbientDaylightTopology {
  const key = floor as object;
  const signature = ambientTopologySignature(floor);
  const cached = ambientTopologyCache.get(key);
  if (cached?.signature === signature) return cached.topology;

  const topology = buildAmbientDaylightTopology(floor.areas, floor.openings);
  ambientTopologyCache.set(key, { signature, topology });
  return topology;
}

function resolveAmbientOpeningTransmission(
  floor: Pick<Floor, "openings">,
  hass: HomeAssistant | undefined,
  openingState: AmbientDaylightOpeningState,
): Map<string, number> {
  const resolved = new Map<string, number>();
  for (const opening of floor.openings) {
    const clear = openingClearFraction(
      opening,
      openingState.amount(opening),
      openingState.secondAmount(opening),
    );
    const shutterOpen = opening.shutterEntity
      ? shutterAmount(hass?.states[opening.shutterEntity], opening.shutterInvert)
      : 1;
    resolved.set(opening.id, ambientOpeningTransmission(opening, clear, shutterOpen));
  }
  return resolved;
}

/**
 * Render the complete diffuse-daylight layer for one active floor.
 *
 * Exterior openings remain the only sources. When room topology contains an
 * opening shared by exactly two Areas, already-lit room energy may continue
 * through it with bounded hop decay. Geometry is cached, while sun elevation
 * and opening/shutter state remain live inputs on every relevant HA update.
 */
export function renderAmbientDaylightLayer(
  floor: Pick<Floor, "areas" | "openings">,
  config: FloorplanCardConfig,
  hass: HomeAssistant | undefined,
  idPrefix: string,
  openingState: AmbientDaylightOpeningState,
): SVGTemplateResult | typeof nothing {
  if (!ambientDaylightEnabled(config) || floor.areas.length === 0) return nothing;

  const topology = ambientDaylightTopologyForFloor(floor);
  if (topology.exteriorSources.length === 0) return nothing;

  const elevation = hass?.states["sun.sun"]?.attributes?.elevation;
  // Fail dark before resolving any opening state. Besides being conservative,
  // this keeps the common night path cheaper than a graph pass.
  if (!(ambientDaylightDayFactor(elevation) > 0)) return nothing;

  // One live-state resolution per physical opening. Both the direct patches
  // and every graph hop read this map, never hass again.
  const transmissionById = resolveAmbientOpeningTransmission(floor, hass, openingState);
  const transmission = (openingId: string): number => transmissionById.get(openingId) ?? 0;
  const propagation = propagateAmbientDaylight(topology, elevation, transmission);

  const rendered = floor.areas.map((area) => {
    const direct = ambientDaylightPatches(
      area,
      topology.exteriorSources,
      elevation,
      transmission,
    );
    const indirect = ambientPropagationPatches(area, propagation);
    const patches = [...direct, ...indirect];
    return patches.length
      ? renderAmbientDaylight(area, patches, { idPrefix })
      : nothing;
  });
  return rendered.some((layer) => layer !== nothing) ? svg`${rendered}` : nothing;
}
