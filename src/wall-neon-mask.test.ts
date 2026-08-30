import { describe, it, expect } from "vitest";
/**
 * Read as source text rather than imported, for the same reason as
 * card-styles.test.ts: importing either module drags in Lit's element
 * machinery for a question the source itself answers.
 */
import cardSourceRaw from "./floorplan-card.ts?raw";
import editorSourceRaw from "./editor.ts?raw";

const cardSource = cardSourceRaw as string;
const editorSource = editorSourceRaw as string;

/**
 * Issue #203 — "Neon Glow Ignores Wall Openings".
 *
 * CSS applies `filter` before `mask`. A skin filter set on the wall element
 * itself is therefore computed from the *uncut* wall, and the doorway mask
 * then removes the wall body but not the halo around it. The cut clears
 * `WALL_THICKNESS + 4` (12 units, so ±6 from the centreline); a
 * `drop-shadow` of blur 4 reaches roughly ±8.5. The ~2.5 units of halo on
 * each side that the mask never touches run straight through every opening.
 *
 * Measured on a Tron render before the fix: 35.6 peak luminance inside an
 * opening against a 7.8 background — 4.6x — falling to exactly 7.8 once the
 * filter moved outside the mask.
 *
 * The invariant is structural, so it is guarded structurally: the filter
 * belongs to a group that *wraps* the masked group, never to the wall.
 */
describe("the wall neon sits outside the doorway mask (#203)", () => {
  const blockAfter = (source: string, selector: string): string | undefined => {
    const at = source.indexOf(selector);
    if (at === -1) return undefined;
    return source.slice(at, source.indexOf("}", at));
  };

  it("the card's .wall declares no filter of its own", () => {
    const block = blockAfter(cardSource, "\n    .wall {");
    expect(block, ".wall rule not found").toBeDefined();
    expect(block).not.toMatch(/(^|[;\s])filter\s*:/);
  });

  it("the editor's line.wall declares no filter of its own", () => {
    const block = blockAfter(editorSource, "line.wall {");
    expect(block, "line.wall rule not found").toBeDefined();
    expect(block).not.toMatch(/(^|[;\s])filter\s*:/);
  });

  for (const [name, source] of [
    ["card", cardSource],
    ["editor", editorSource],
  ] as const) {
    it(`${name}: .fp-wall-neon is what carries the skin filter`, () => {
      const block = blockAfter(source, ".fp-wall-neon {");
      expect(block, ".fp-wall-neon rule not found").toBeDefined();
      expect(block).toMatch(/filter\s*:\s*var\(--fp-skin-wall-filter/);
    });
  }

  for (const [name, source] of [
    ["card", cardSource],
    ["editor", editorSource],
  ] as const) {
    it(`${name}: every masked wall opens its own neon group immediately before it`, () => {
      // Per wall, not one group around the collection. Wrapping them together
      // composites the strokes before filtering, so walls meeting at a corner
      // glow once instead of twice and every joint dims — a silent change to
      // how a plan looks, on top of the fix this is actually for.
      const masked = [...source.matchAll(/<line[^>]*class="wall[^"]*"[^>]*mask=/gs)];
      expect(masked.length, `no masked wall lines found in the ${name}`).toBeGreaterThan(0);
      for (const m of masked) {
        const before = source.slice(Math.max(0, m.index! - 160), m.index!);
        expect(before, `unwrapped masked wall in the ${name} at index ${m.index}`).toMatch(
          /<g class="fp-wall-neon">\s*$/,
        );
      }
    });
  }

  it("no neon group wraps the whole wall collection", () => {
    // the shape that regressed joints: a neon group whose body is a .map(...)
    for (const [name, source] of [["card", cardSource], ["editor", editorSource]] as const) {
      const collectionWrap = /<g class="fp-wall-neon">\s*(<g mask|\$\{[a-zA-Z.?]*walls)/;
      expect(collectionWrap.test(source), `${name} wraps the collection, not each wall`).toBe(false);
    }
  });

  it("says why, so the next person does not move it back onto the wall", () => {
    for (const source of [cardSource, editorSource]) {
      const at = source.indexOf(".fp-wall-neon {");
      const nearby = source.slice(Math.max(0, at - 2000), at);
      expect(nearby).toMatch(/filter before mask/i);
      expect(nearby).toMatch(/#203/);
    }
    // and the card must say why it is per wall, since that is the part a
    // future tidy-up would most plausibly "simplify" back into one group
    {
      const at = cardSource.indexOf(".fp-wall-neon {");
      const nearby = cardSource.slice(Math.max(0, at - 2000), at);
      expect(nearby).toMatch(/per wall/i);
      expect(nearby).toMatch(/joint/i);
    }
  });
});
