/**
 * The marks drawn by hand over the timeline: a rough star, a lopsided heart,
 * an underline, a flourish. They are decoration and say nothing about the
 * photo, so a frame carries one only because its id says so.
 *
 * Nothing here is a clean shape. Each doodle is a few control points nudged by
 * a random amount and joined by curves, and the random source is seeded from
 * the photo's id, so the same photo gets the same mark, the same wobble and the
 * same place on every render and every visit.
 */
import type { HtmlBuilder } from "foldkit/html";

import type { Child } from "./shared";

type Point = readonly [number, number];
type Rng = () => number;

/** Small seeded generator (mulberry32). */
const seeded = (seed: number): Rng => {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const hashOf = (id: string): number => {
  let hash = 2166136261;
  for (const char of id)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash;
};

const jitter = (rng: Rng, [x, y]: Point, r: number): Point => [
  x + (rng() - 0.5) * 2 * r,
  y + (rng() - 0.5) * 2 * r,
];

const wobble = (
  rng: Rng,
  r: number,
  points: ReadonlyArray<Point>,
): ReadonlyArray<Point> => points.map((p) => jitter(rng, p, r));

const n = (value: number): string => value.toFixed(1);

/** A smooth curve through the points (Catmull-Rom as cubic Béziers). */
const smooth = (points: ReadonlyArray<Point>): string => {
  const first = points[0]!;
  let d = `M${n(first[0])} ${n(first[1])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    d += ` C${n(p1[0] + (p2[0] - p0[0]) / 6)} ${n(p1[1] + (p2[1] - p0[1]) / 6)} ${n(p2[0] - (p3[0] - p1[0]) / 6)} ${n(p2[1] - (p3[1] - p1[1]) / 6)} ${n(p2[0])} ${n(p2[1])}`;
  }
  return d;
};

/** Straight-ish strokes with corners, each leg bowed a little off true. */
const strokes = (
  points: ReadonlyArray<Point>,
  rng: Rng,
  bow = 0.12,
): string => {
  const first = points[0]!;
  let d = `M${n(first[0])} ${n(first[1])}`;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1]!;
    const [x1, y1] = points[i]!;
    const o = (rng() - 0.5) * 2 * bow;
    d += ` Q${n((x0 + x1) / 2 - (y1 - y0) * o)} ${n((y0 + y1) / 2 + (x1 - x0) * o)} ${n(x1)} ${n(y1)}`;
  }
  return d;
};

type Shape = {
  readonly width: number;
  readonly height: number;
  /** Where it sits on the frame: the top corners, the bottom edge, or the left edge. */
  readonly place: "corner" | "below" | "side";
  readonly draw: (rng: Rng) => ReadonlyArray<string>;
};

const SHAPES: ReadonlyArray<Shape> = [
  {
    width: 40,
    height: 40,
    place: "corner",
    // A five-point star in one stroke that doesn't quite close.
    draw: (rng) => [
      strokes(
        [0, 1, 2, 3, 4, 0].map((k, i) => {
          const angle = ((-90 + k * 144) * Math.PI) / 180;
          const radius = 15 + (rng() - 0.5) * 5;
          return jitter(
            rng,
            [20 + radius * Math.cos(angle), 20 + radius * Math.sin(angle)],
            i === 5 ? 4 : 1,
          );
        }),
        rng,
        0.1,
      ),
    ],
  },
  {
    width: 40,
    height: 40,
    place: "corner",
    draw: (rng) => [
      smooth(
        wobble(rng, 1.4, [
          [20, 34],
          [8, 23],
          [6, 13],
          [13, 8],
          [20, 16],
          [27, 8],
          [34, 12],
          [33, 23],
          [22, 36],
        ]),
      ),
    ],
  },
  {
    width: 40,
    height: 40,
    place: "corner",
    draw: (rng) => [
      strokes(
        wobble(rng, 2, [
          [20, 3],
          [20, 37],
        ]),
        rng,
      ),
      strokes(
        wobble(rng, 2, [
          [4, 20],
          [36, 18],
        ]),
        rng,
      ),
      strokes(
        wobble(rng, 2, [
          [9, 9],
          [31, 31],
        ]),
        rng,
      ),
    ],
  },
  {
    width: 40,
    height: 40,
    place: "corner",
    draw: (rng) => [
      strokes(
        wobble(rng, 1.6, [
          [5, 22],
          [13, 33],
          [35, 6],
        ]),
        rng,
        0.15,
      ),
    ],
  },
  {
    width: 64,
    height: 32,
    place: "corner",
    draw: (rng) => [
      smooth(
        wobble(rng, 1.4, [
          [4, 25],
          [16, 9],
          [29, 21],
          [21, 27],
          [15, 14],
          [32, 6],
          [60, 16],
        ]),
      ),
    ],
  },
  {
    width: 110,
    height: 12,
    place: "below",
    draw: (rng) => [
      smooth(
        wobble(rng, 1.5, [
          [3, 6],
          [32, 3],
          [64, 8],
          [104, 4],
        ]),
      ),
      smooth(
        wobble(rng, 1, [
          [24, 10],
          [60, 9],
          [86, 8],
        ]),
      ),
    ],
  },
  {
    width: 64,
    height: 14,
    place: "below",
    draw: (rng) => [
      smooth(
        wobble(
          rng,
          1.2,
          [2, 10, 18, 26, 34, 42, 50, 62].map((x, i): Point => [
            x,
            i % 2 ? 11 : 3,
          ]),
        ),
      ),
    ],
  },
  {
    width: 30,
    height: 26,
    place: "side",
    draw: (rng) =>
      [0, 1, 2].map((i) =>
        strokes(
          [
            [6 + i * 9, 3 + (rng() - 0.5) * 2],
            [2 + i * 9, 23 + (rng() - 0.5) * 3],
          ],
          rng,
          0.1,
        ),
      ),
  },
];

/** About one frame in four carries a mark, so a month has a few and no frame
 *  is the one that matters. */
const SHARE = 0.26;

const POSITION = {
  corner: ["-top-[18px]", "-right-3.5", "-left-3"],
  below: ["-bottom-4", "left-1"],
  side: ["-top-1.5", "-left-3"],
} as const;

/** The doodle on this photo's frame, or nothing. Stable for a given id. */
export const doodleFor = <M>(
  id: string,
  h: HtmlBuilder<M>,
): ReadonlyArray<Child> => {
  const hash = hashOf(id);
  const rng = seeded(hash);
  if (rng() >= SHARE) return [];

  const shape = SHAPES[Math.floor(rng() * SHAPES.length)]!;
  const scale = 0.7 + rng() * 0.2;
  const width = shape.width * scale;
  const height = shape.height * scale;
  const rotation = (rng() - 0.5) * 24;
  const strokeWidth = 2.1 + rng() * 0.8;
  const fromLeft = rng() < 0.4;
  const [vertical, right, left] = POSITION[shape.place];
  const horizontal =
    shape.place === "corner" ? (fromLeft ? left : right) : right;

  return [
    h.svg(
      [
        h.AriaHidden(true),
        h.Xmlns("http://www.w3.org/2000/svg"),
        h.ViewBox(`0 0 ${shape.width} ${shape.height}`),
        h.Fill("none"),
        h.Stroke("currentColor"),
        h.StrokeWidth(n(strokeWidth)),
        h.StrokeLinecap("round"),
        h.StrokeLinejoin("round"),
        h.Width(n(width)),
        h.Height(n(height)),
        h.Class(
          `pointer-events-none absolute z-10 overflow-visible text-role-accent ${vertical} ${horizontal}`,
        ),
        h.Style({ transform: `rotate(${n(rotation)}deg)` }),
      ],
      shape.draw(rng).map((d) => h.path([h.D(d)])),
    ),
  ];
};
