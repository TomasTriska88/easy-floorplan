import type { Area, Opening } from "./types";
import { SUN_ELEVATION_DAY } from "./types";
import {
  ambientDaylightDayFactor,
  ambientDaylightPatches,
  ambientOpeningSources,
  openingAdjacentAreas,
  type AmbientDaylightOptions,
  type AmbientDaylightPatch,
  type AmbientOpeningSource,
} from "./ambient-daylight";

/**
 * How much diffuse room light survives one interior-opening hop.
 *
 * This is deliberately not a user-facing physics knob. 55% keeps the first
 * adjacent room clearly readable while making each further room visibly
 * weaker: 55%, 30.25%, 16.64% before the opening's own transmission is
 * applied. The opening can only reduce those numbers, never amplify them.
 */
export const DEFAULT_AMBIENT_DAYLIGHT_PROPAGATION_DECAY = 0.55;

/**
 * Hard bound on room-to-room propagation. Three hops is enough for ordinary
 * house plans and prevents a malformed/huge topology from turning one source
 * into unbounded graph work.
 */
export const DEFAULT_AMBIENT_DAYLIGHT_MAX_HOPS = 3;

export interface AmbientInteriorConnection {
  openingId: string;
  areaAId: string;
  areaBId: string;
  /** Same physical opening, with the existing ambient normal pointing into A. */
  intoA: AmbientOpeningSource;
  /** Same physical opening, with the existing ambient normal pointing into B. */
  intoB: AmbientOpeningSource;
}

/** Geometry-only data. Safe to cache until Areas/openings move. */
export interface AmbientDaylightTopology {
  areaIds: string[];
  exteriorSources: AmbientOpeningSource[];
  interiorConnections: AmbientInteriorConnection[];
}

export interface AmbientDaylightTransfer {
  openingId: string;
  fromAreaId: string;
  toAreaId: string;
  hop: number;
  /** Normalized incoming energy after hop decay and opening transmission. */
  energy: number;
  /** Geometry for a soft patch starting at this opening and pointing into `toAreaId`. */
  source: AmbientOpeningSource;
}

export interface AmbientDaylightPropagationResult {
  /** Aggregate normalized energy per lit Area, always in 0..1. */
  areaEnergy: Map<string, number>;
  /** Shortest daylight hop from an exterior-lit Area. Exterior-lit Areas are 0. */
  hops: Map<string, number>;
  /** Equal-shortest-path transfers used to paint interior-opening washes. */
  transfers: AmbientDaylightTransfer[];
}

export interface AmbientDaylightPropagationOptions {
  decay?: number;
  maxHops?: number;
}

function clamp01(v: unknown, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.max(0, Math.min(1, v));
}

function normalizedPropagationOptions(opts: AmbientDaylightPropagationOptions = {}) {
  const rawHops = opts.maxHops;
  const maxHops =
    typeof rawHops === "number" && Number.isFinite(rawHops)
      ? Math.max(0, Math.min(16, Math.floor(rawHops)))
      : DEFAULT_AMBIENT_DAYLIGHT_MAX_HOPS;
  return {
    decay: clamp01(opts.decay, DEFAULT_AMBIENT_DAYLIGHT_PROPAGATION_DECAY),
    maxHops,
  };
}

function boundedCoverage(a: number, b: number): number {
  const aa = clamp01(a, 0);
  const bb = clamp01(b, 0);
  return Math.max(0, Math.min(1, 1 - (1 - aa) * (1 - bb)));
}

function sourceOrder(a: AmbientOpeningSource, b: AmbientOpeningSource): number {
  return a.areaId.localeCompare(b.areaId) || a.openingId.localeCompare(b.openingId);
}

/**
 * Build the room graph from the same Area/opening geometry V1 already trusts.
 *
 * - exactly one adjacent Area => exterior daylight source (unchanged V1 rule)
 * - exactly two adjacent Areas => interior propagation edge
 * - zero, three or more => unknown/ambiguous, therefore no propagation edge
 *
 * Interior normals are intentionally obtained by asking the existing V1 source
 * geometry about each side separately. That avoids a second interpretation of
 * wall direction and keeps the transferred patch identical to a native ambient
 * patch entering that Area through the same opening.
 */
export function buildAmbientDaylightTopology(
  areas: readonly Area[],
  openings: readonly Opening[],
): AmbientDaylightTopology {
  const sortedAreas = [...areas].sort((a, b) => a.id.localeCompare(b.id));
  const sortedOpenings = [...openings].sort((a, b) => a.id.localeCompare(b.id));
  const exteriorSources = ambientOpeningSources(sortedAreas, sortedOpenings).sort(sourceOrder);
  const interiorConnections: AmbientInteriorConnection[] = [];

  for (const opening of sortedOpenings) {
    const matches = openingAdjacentAreas(opening, sortedAreas);
    if (matches.length !== 2) continue;
    const [first, second] = [...matches].sort((a, b) => a.area.id.localeCompare(b.area.id));
    const areaA = first!.area;
    const areaB = second!.area;
    if (areaA.id === areaB.id) continue;

    // With one candidate Area the existing V1 helper intentionally classifies
    // the opening as entering that Area, which gives us its tested inward
    // normal without duplicating the geometry here.
    const intoA = ambientOpeningSources([areaA], [opening])[0];
    const intoB = ambientOpeningSources([areaB], [opening])[0];
    if (!intoA || !intoB) continue;

    interiorConnections.push({
      openingId: opening.id,
      areaAId: areaA.id,
      areaBId: areaB.id,
      intoA,
      intoB,
    });
  }

  interiorConnections.sort(
    (a, b) =>
      a.openingId.localeCompare(b.openingId) ||
      a.areaAId.localeCompare(b.areaAId) ||
      a.areaBId.localeCompare(b.areaBId),
  );

  return {
    areaIds: sortedAreas.map((area) => area.id),
    exteriorSources,
    interiorConnections,
  };
}

interface CandidateTransfer extends AmbientDaylightTransfer {
  sortKey: string;
}

/**
 * Propagate diffuse daylight through the Area graph.
 *
 * This is a bounded breadth-first flow, not an iterative light solver. Exterior
 * sources seed hop 0. An interior opening may transfer only from hop N to a
 * previously unlit hop N+1. Therefore A↔B↔C cycles can never feed energy back
 * to an earlier Area, and the answer is deterministic rather than dependent on
 * config order or convergence tolerances.
 *
 * Multiple equal-shortest paths *do* combine. They use the same bounded
 * coverage rule as V1 (`1 - Π(1-c)`), so extra doors can brighten a room but
 * the normalized energy never exceeds 1.
 */
export function propagateAmbientDaylight(
  topology: AmbientDaylightTopology,
  elevation: unknown,
  transmission: (openingId: string) => number = () => 1,
  opts: AmbientDaylightPropagationOptions = {},
): AmbientDaylightPropagationResult {
  const { decay, maxHops } = normalizedPropagationOptions(opts);
  const areaEnergy = new Map<string, number>();
  const hops = new Map<string, number>();
  const transfers: AmbientDaylightTransfer[] = [];
  const day = ambientDaylightDayFactor(elevation);

  if (!(day > 0)) return { areaEnergy, hops, transfers };

  // Resolve every relevant opening exactly once. In the host integration the
  // callback is already a map lookup, but keeping this invariant here makes
  // the pure graph path linear too and prevents future callers from doing HA
  // state work once per hop/path.
  const relevantOpeningIds = new Set<string>();
  for (const source of topology.exteriorSources) relevantOpeningIds.add(source.openingId);
  for (const edge of topology.interiorConnections) relevantOpeningIds.add(edge.openingId);
  const openingTransmission = new Map<string, number>();
  for (const openingId of [...relevantOpeningIds].sort()) {
    openingTransmission.set(openingId, clamp01(transmission(openingId), 0));
  }

  // Exterior openings are the only origin of energy. One-sided/unknown
  // interior geometry can therefore never be promoted into an edge by this
  // propagation pass.
  for (const source of topology.exteriorSources) {
    const t = openingTransmission.get(source.openingId) ?? 0;
    const contribution = day * t;
    if (!(contribution > 0)) continue;
    areaEnergy.set(source.areaId, boundedCoverage(areaEnergy.get(source.areaId) ?? 0, contribution));
  }

  for (const areaId of [...areaEnergy.keys()].sort()) hops.set(areaId, 0);
  if (!(decay > 0) || maxHops === 0 || areaEnergy.size === 0) {
    return { areaEnergy, hops, transfers };
  }

  for (let hop = 1; hop <= maxHops; hop++) {
    const candidates = new Map<string, CandidateTransfer[]>();

    for (const edge of topology.interiorConnections) {
      const t = openingTransmission.get(edge.openingId) ?? 0;
      if (!(t > 0)) continue;

      const directions = [
        { from: edge.areaAId, to: edge.areaBId, source: edge.intoB },
        { from: edge.areaBId, to: edge.areaAId, source: edge.intoA },
      ] as const;

      for (const direction of directions) {
        if (hops.get(direction.from) !== hop - 1) continue;
        // A shorter route already owns this Area. This one rule makes the
        // propagation DAG-like even when the configured room graph is cyclic.
        const knownHop = hops.get(direction.to);
        if (knownHop !== undefined && knownHop < hop) continue;

        const parentEnergy = areaEnergy.get(direction.from) ?? 0;
        const energy = clamp01(parentEnergy * decay * t, 0);
        if (!(energy > 0)) continue;

        const list = candidates.get(direction.to) ?? [];
        list.push({
          openingId: edge.openingId,
          fromAreaId: direction.from,
          toAreaId: direction.to,
          hop,
          energy,
          source: direction.source,
          sortKey: `${edge.openingId}\u0000${direction.from}\u0000${direction.to}`,
        });
        candidates.set(direction.to, list);
      }
    }

    if (candidates.size === 0) break;
    let litThisHop = 0;
    for (const areaId of [...candidates.keys()].sort()) {
      // If the Area became lit at a shorter hop from another route, never
      // revisit it. (Within this pass nothing has a shorter hop than `hop`.)
      const knownHop = hops.get(areaId);
      if (knownHop !== undefined && knownHop < hop) continue;

      const paths = candidates.get(areaId)!.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
      let combined = 0;
      for (const path of paths) combined = boundedCoverage(combined, path.energy);
      if (!(combined > 0)) continue;

      hops.set(areaId, hop);
      areaEnergy.set(areaId, combined);
      litThisHop++;
      for (const { sortKey: _sortKey, ...path } of paths) transfers.push(path);
    }
    if (litThisHop === 0) break;
  }

  return { areaEnergy, hops, transfers };
}

/**
 * Turn graph transfers into the same clipped, soft patches V1 already renders.
 * `transfer.energy` already contains day factor, all previous hop losses and
 * this opening's transmission, so the patch helper is pinned to full day and
 * receives the transfer as its only transmission factor.
 */
export function ambientPropagationPatches(
  area: Area,
  propagation: AmbientDaylightPropagationResult,
  opts: AmbientDaylightOptions = {},
): AmbientDaylightPatch[] {
  const out: AmbientDaylightPatch[] = [];
  for (const transfer of propagation.transfers) {
    if (transfer.toAreaId !== area.id) continue;
    out.push(
      ...ambientDaylightPatches(
        area,
        [transfer.source],
        SUN_ELEVATION_DAY,
        () => transfer.energy,
        opts,
      ),
    );
  }
  return out;
}
