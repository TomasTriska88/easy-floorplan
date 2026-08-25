# Diffuse ambient daylight

`ambientDaylight` adds a soft room-aware daylight layer from the visible sky. It is deliberately separate from Easy Floorplan's existing direct `sunlight` layer.

Direct sunlight answers **where does the sun itself cast a patch right now?** It depends on sun bearing, elevation, openings and wall shadows.

Ambient daylight answers **how much daylight from the sky softly reaches this room even when the sun itself does not?** A north-facing window can therefore brighten a room without inventing a direct-sun beam, and some of that diffuse room light can continue through an interior opening into a neighbouring room.

## Configuration

```yaml
type: custom:easy-floorplan-card
ambientDaylight: true
```

The option is off by default, so existing plans keep their current rendering.

There is deliberately no separate propagation switch or collection of physics controls. `ambientDaylight` is the feature boundary; when it is enabled, complete Area topology is used automatically. Strength, depth, spread, tint, hop decay and hop limit remain implementation defaults until real-plan calibration gives a reason to make any of them public.

## Geometry and source classification

Ambient daylight uses `Area` polygons for three jobs:

1. determining whether an opening is exterior or interior,
2. hard-clipping each soft light patch to the room that receives it, and
3. building a small room graph for indirect propagation.

An opening that touches exactly one known Area boundary is an exterior daylight source. An opening touching exactly two known Areas is an interior graph edge, but **never a source by itself**. An opening touching zero, three or more known Areas is ignored for propagation because its topology is incomplete or ambiguous.

This makes complete room geometry important. If a real neighbouring room has no Area polygon, an opening between that room and a modeled room can still look exterior to the original source classifier because only one side is represented. The propagation pass does not guess the missing side and will not create an edge through unknown space. Keeping that distinction explicit is safer than inventing topology behind an unmodeled wall.

## Light behaviour

- Exterior openings are the only origin of daylight energy.
- Ambient daylight does not use sun azimuth or bearing. Directional direct sunlight remains the job of `sunlight`.
- Sun elevation controls day/twilight/night strength. The transition uses the same civil-twilight interval as the card's sun visual language: zero at or below -6°, full at or above +6°, smoothly eased between them.
- Missing, `unknown`, `unavailable` or otherwise unreadable sun elevation fails dark: the layer renders no invented daylight until Home Assistant supplies a valid elevation again.
- Each exterior opening creates a broad widening wash rather than a narrow sun beam.
- The exact Area polygon clips every direct and propagated patch. Blur can soften a pool inside a room but cannot leak through a solid Area boundary.
- The existing opening travel, glazing and shutter state are reused for transmission instead of introducing a second state model.
- A closed opaque interior door therefore blocks propagation. An opaque door transmits proportionally while partially open. A glazed opening can transmit while closed, and an existing shutter further multiplies that transmission.
- `sunlight: false` remains the opening-level natural-light opt-out for both direct ambient input and interior transmission. This matters for intentionally schematic openings that should not illuminate the plan.
- Multiple exterior inputs or multiple valid routes combine with bounded coverage (`1 - Π(1-c)`), so normalized room energy never exceeds 1.

The layer is rendered above Area fills and below the existing dead-space, artificial-light and direct-sun layers. It does not reorder those existing layers.

## Interior propagation model

The room topology is a graph:

- **Area = node**
- **opening shared by exactly two Areas = edge**
- **exterior opening = input energy into its Area**

Propagation is a bounded breadth-first flow, not a ray tracer and not an iterative light solver. Exterior-lit Areas are hop 0. An interior opening may transfer light only from hop `N` to a previously unlit hop `N + 1`.

Each interior hop keeps 55% of the incoming diffuse room energy *before* the opening's own transmission is applied. With a fully transmitting opening the default sequence is therefore approximately:

- first neighbouring room: 55%
- second room: 30.25%
- third room: 16.64%

Propagation stops after three interior hops. In practice a closed/partial/shuttered opening reduces those values further.

This shortest-hop rule is also the cycle guard. A topology such as `A ↔ B ↔ C ↔ A` cannot feed light back into an earlier Area because a later hop is never allowed to revisit a node with a shorter distance. Multiple **equal-shortest** paths to the same Area are allowed and combine with bounded coverage, so two useful doorways can brighten a room without creating a feedback amplifier.

The graph is sorted by stable ids before classification and transfer. Results therefore do not depend on the order of Areas or openings in YAML.

## Performance and caching

Finding which Area boundary touches each opening is geometry work and can be more expensive than the graph update. The integration caches that geometry-only topology and invalidates it when Area/opening coordinates change.

Ordinary Home Assistant updates do not rebuild the topology. On a `sun.sun`, door or shutter state change the live path:

1. resolves each physical opening transmission once,
2. seeds exterior Areas,
3. walks the cached graph for at most three hops, and
4. renders only the resulting patches.

With cached geometry that path is bounded by the number of Areas/openings/graph edges rather than by the number of possible routes. This keeps ambient updates suitable for normal HA state churn without adding a heavy visibility/ray-tracing pass.

## Why Areas are required

Walls alone describe segments, but not which enclosed polygon is *the room that owns a window* or which two rooms share a doorway. The Area gives the feature room identity, graph topology and an exact physical clip without adding a second room format.

That choice also fails safely: with no Areas, ambient daylight renders nothing rather than spreading light across the whole plan.

## Renderer contract

`ambient-daylight.ts` owns deterministic direct-daylight geometry and opening transmission math. `ambient-daylight-propagation.ts` owns cached-topology-compatible graph propagation. `ambient-daylight-render.ts` owns SVG paint and clipping. `ambient-daylight-integration.ts` is the card-facing adapter that reuses the card's existing opening/shutter resolvers and caches geometry.

The SVG renderer uses:

- one exact Area clip path,
- one bounded Gaussian blur filter,
- one user-space linear gradient per opening patch,
- deterministic IDs with a per-card instance prefix,
- rejection of invalid/non-finite geometry and opacity.

The renderer owns the patch `fill` and `filter`. Card CSS must not replace either with a flat declaration; a regression guard covers the same class of live-browser compositing failure that previously affected direct sunlight.

## Current boundaries

Deliberately outside this feature:

- weather/cloud attenuation,
- calibration from local irradiance or lux sensors,
- orientation-dependent sky exposure,
- curtains/blinds beyond the existing shutter transmission,
- vertical opening geometry,
- moonlight or night-sky contribution,
- semantic/decorative room colouring,
- physically exact inter-room ray tracing.

Those can be added later without changing the distinction between directional sunlight and diffuse sky light.

## Validation expectations

The feature follows the repository's normal validation path: project typecheck, the complete Vitest suite and production build.

Automated coverage includes exterior-only light, open/closed/glazed/partially-open interior openings, shutters, two and three hops, cycles, multiple equal-shortest routes, isolated Areas, incomplete topology, night, invalid sun elevation, deterministic config reordering, energy bounds, topology caching and a large-graph complexity guard. The existing direct-sunlight and artificial-light test suite remains unchanged and runs as part of the same full validation.

Before release, the built card must also be checked in a real browser with its actual stylesheet for layer order and gradient/filter composition. The review scene should use the repository Home Assistant dev container, pin a stable daytime `sun.sun`, disable direct sunlight, and compare the same multi-room `.plan` scene before and after propagation. Markup-only rendering is not sufficient evidence because CSS participates in the final SVG composition.
