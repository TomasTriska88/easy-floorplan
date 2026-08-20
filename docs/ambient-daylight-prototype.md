# Ambient daylight prototype

Status: **experimental / not wired into the card / do not enable in production yet**.

This prototype adds a room-aware model for diffuse daylight from the sky. It is intentionally separate from Easy Floorplan's existing direct `sunlight` layer.

## Why this is a separate layer

Direct sunlight answers: **where does the sun itself cast a patch right now?** It depends on sun bearing, elevation, openings and wall shadows.

Ambient daylight answers: **how much daylight from the visible sky softly reaches this room even when the sun itself does not?** A north-facing window therefore remains a daylight source even when no direct sun ray reaches it.

The two layers must not be conflated. A north window getting diffuse daylight must never manufacture a fake direct-sun beam.

## V1 invariants

- Default production behaviour remains unchanged until a future `ambientDaylight` opt-in is explicitly wired and enabled.
- Ambient daylight does not read sun azimuth/bearing.
- Sun elevation controls only the day/twilight/night strength. Civil twilight uses the same -6° / +6° interval as the existing sun-dimming visual language, with smoothstep easing.
- An opening touching exactly one known Area boundary is treated as an exterior sky-light source.
- An opening touching two known Area boundaries is an interior opening and is not a V1 sky-light source.
- The Area polygon is the room clipping mask. Ambient light must never render through a solid room boundary.
- A source produces a broad, widening, fading patch, not a narrow direct-sun stripe.
- Multiple sources combine without producing normalized brightness above 1.
- Window glazing, physical opening amount and shutter transmission are separate factors.
- No weather/cloudiness or local irradiance sensor is used in V1. Those are later calibration inputs, not prerequisites for deterministic geometry.
- No transfer through interior doors in V1. A later version may propagate an attenuated contribution through an actually open interior opening.
- Permanent decorative room colours are not part of ambient daylight. Areas stay visually neutral by default; semantic room-state tinting is a separate overlay concern.

## Known geometry assumption

Automatic exterior-source classification is only as complete as the Area geometry.

If an opening separates a modeled Area from a real neighbouring room that has **no Area polygon**, the prototype can see only one adjacent Area and may classify that opening as exterior. This is not something geometry can infer reliably from missing room data.

For a production/public implementation, one of these must be true:

1. relevant rooms are represented by complete adjacent Area polygons, or
2. the card gains an explicit per-opening exterior/ambient-source override, or
3. a future building-envelope model supplies exterior/interior topology independently of Areas.

The prototype keeps this limitation explicit rather than silently guessing additional rooms.

## Prototype defaults

These values are calibration starting points, **not yet public configuration defaults**:

- strength: `0.28`
- depth: `0.8` of the Area's longer bounding-box side
- spread: `1.15`

They should not be promoted into the editor/config API until visual calibration and full regression validation are complete.

## Render contract

`ambientOpeningSources(...)` derives deterministic exterior sources.

`ambientDaylightAtPoint(...)` is the reference scalar field used by geometry tests.

`ambientDaylightPatches(...)` exposes renderer-ready broad trapezoids with:

- exact source opening id,
- target Area id,
- four patch points,
- opening-to-room gradient axis,
- normalized source opacity.

The patch geometry intentionally may extend outside its room. The eventual SVG renderer must clip it with the exact Area polygon. Keeping clipping in the renderer avoids duplicating polygon clipping math in the physical model while tests can still assert both responsibilities separately.

## Planned integration sequence

1. Keep the model and its tests isolated until the full upstream validation suite passes.
2. Add a small SVG render helper with Area clip paths and soft gradients.
3. Add `ambientDaylight?: boolean` to `FloorplanCardConfig`, default off.
4. Make `collectWatchedEntities` watch `sun.sun` whenever ambient daylight is enabled because elevation changes the layer even when direct sunlight is disabled or sun bearing is pinned.
5. Insert the ambient render pass immediately after Area fills without reordering existing layers.
6. Add editor/helper text and README documentation before considering the feature public.
7. Only after visual review and explicit approval may it be enabled in Markvarec production.

## Later extensions, deliberately outside V1

- cloud/weather attenuation,
- calibration from a local irradiance/lux source,
- orientation-dependent sky exposure,
- attenuated propagation through open interior doors,
- curtains/blinds transmission beyond the existing simple shutter factor,
- vertical opening geometry,
- moonlight/night ambient contribution,
- semantic room-state overlays.
