// The KITT race's course geometry: where a track runs on a given screen, which pixels are road, and the car's exact
// outline (from the picture's alpha) so touching a wall is decided by the paint, not a box.
import { TRACKS } from './raceTracks.js';

export { TRACKS };

/** How wide the car is on a screen: big enough to see, small enough that a track with hairpins fits. The picture is 2:1. */
export const carSizeFor = (W, H) => Math.max(44, Math.min(112, Math.round(Math.min(W / 14, H / 10))));

/** A track's control points in pixels on a W x H canvas: rows of bends joined by hairpins at the sides. */
export function controlPoints(track, W, H, pad, swing) {
  const turn = Math.min(W * 0.1, 140); // how far a hairpin reaches past the rows' ends
  const x0 = pad + turn;
  const x1 = W - pad - turn;
  const rowGap = (H - 2 * pad) / (track.rows - 1);
  const points = [];
  for (let r = 0; r < track.rows; r++) {
    const y = pad + r * rowGap;
    const ltr = r % 2 === 0;
    for (let i = 0; i < track.perRow; i++) {
      const t = i / (track.perRow - 1);
      const x = ltr ? x0 + t * (x1 - x0) : x1 - t * (x1 - x0);
      const inner = i > 0 && i < track.perRow - 1;
      points.push({ x, y: y + (inner ? (i % 2 ? swing : -swing) : 0) });
    }
    if (r < track.rows - 1) points.push({ x: ltr ? x1 + turn : x0 - turn, y: y + rowGap / 2 }); // the hairpin's apex
  }
  return points;
}

/** The path stretched to fill the canvas with `pad` to spare on every side (the curve swings past its control points). */
function fit(path, pad, W, H) {
  const xs = path.map((p) => p.x), ys = path.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const kx = (W - 2 * pad) / Math.max(1, maxX - minX), ky = (H - 2 * pad) / Math.max(1, maxY - minY);
  return path.map((p) => ({ x: pad + (p.x - minX) * kx, y: pad + (p.y - minY) * ky }));
}

/** Whether every two stretches of road that aren't neighbours along the path keep `gap` between their middles. */
function clear(path, gap, skip) {
  const g2 = gap * gap;
  for (let i = 0; i < path.length; i++) {
    for (let j = i + skip; j < path.length; j++) {
      const dx = path[i].x - path[j].x, dy = path[i].y - path[j].y;
      if (dx * dx + dy * dy < g2) return false;
    }
  }
  return true;
}

const PER = 18; // samples per stretch between control points

/** The track's centreline on this canvas, filling it, with the bends eased off until no two rows run into each other. */
export function layout(track, W, H, carW) {
  const width = track.width * carW;
  const pad = width / 2 + 16;
  let swing = track.wobble * H;
  let path;
  for (let tries = 0; tries < 10; tries++) {
    path = fit(spline(controlPoints(track, W, H, pad, swing), PER), pad, W, H);
    if (clear(path, width + 10, PER * 2)) break;
    swing *= 0.75;
  }
  return { path, width };
}

/** A smooth curve through the points (Catmull-Rom), as a dense polyline. */
export function spline(pts, per = 18) {
  const out = [];
  const P = (i) => pts[Math.max(0, Math.min(pts.length - 1, i))];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    for (let j = 0; j < per; j++) {
      const t = j / per, t2 = t * t, t3 = t2 * t;
      const at = (k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
      out.push({ x: at('x'), y: at('y') });
    }
  }
  out.push({ ...pts[pts.length - 1] });
  return out;
}

export function strokePath(ctx, path, width, style) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = width;
  ctx.strokeStyle = style;
  ctx.beginPath();
  path.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.stroke();
}

const unit = (a, b) => { const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1; return { x: dx / l, y: dy / l }; };

/** Everything the race needs about a track on this screen, including a pixel test for "is this point on the road?". */
export function buildCourse(track, W, H) {
  const carW = carSizeFor(W, H);
  const carH = Math.round(carW / 2);
  const { path, width } = layout(track, W, H, carW);
  const start = path[0];
  const startDir = unit(path[0], path[2]);
  const end = path[path.length - 1];
  const endDir = unit(path[path.length - 3], end);
  const mask = document.createElement('canvas');
  mask.width = W;
  mask.height = H;
  const m = mask.getContext('2d', { willReadFrequently: true });
  strokePath(m, path, width, '#000');
  const alpha = m.getImageData(0, 0, W, H).data;
  const onRoad = (x, y) => {
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= W || yi >= H) return false;
    return alpha[(yi * W + xi) * 4 + 3] > 0;
  };
  // The car starts just past the start line, nose along the road, and finishes once its middle crosses the chequered
  // line: the stretch of road just past the last point, not everything beyond it.
  const startAt = { x: start.x + startDir.x * carW * 0.55, y: start.y + startDir.y * carW * 0.55 };
  const pastFinish = (x, y) => {
    const along = (x - end.x) * endDir.x + (y - end.y) * endDir.y;
    const across = Math.abs((x - end.x) * -endDir.y + (y - end.y) * endDir.x);
    return along >= 0 && along <= width && across <= width / 2;
  };
  return { track, W, H, carW, carH, width, path, start, startDir, end, endDir, startAt, onRoad, pastFinish, facesRight: startDir.x > 0 };
}

/**
 * The car's edge: every painted pixel of the picture (drawn at the race's size) that has an unpainted neighbour, as
 * offsets from the picture's middle. The soft shadow under the car doesn't count as the car.
 */
export function carOutline(img, carW, carH) {
  const c = document.createElement('canvas');
  c.width = carW;
  c.height = carH;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0, carW, carH);
  const a = x.getImageData(0, 0, carW, carH).data;
  const solid = (i, j) => i >= 0 && j >= 0 && i < carW && j < carH && a[(j * carW + i) * 4 + 3] > 128;
  const pts = [];
  for (let j = 0; j < carH; j++) {
    for (let i = 0; i < carW; i++) {
      if (solid(i, j) && !(solid(i - 1, j) && solid(i + 1, j) && solid(i, j - 1) && solid(i, j + 1))) pts.push({ x: i + 0.5 - carW / 2, y: j + 0.5 - carH / 2 });
    }
  }
  return pts;
}

/** Whether the car, centred at (cx, cy) and facing right when `flipped`, has any edge pixel off the road. */
export const touchesWall = (course, outline, cx, cy, flipped) => outline.some((p) => !course.onRoad(cx + (flipped ? -p.x : p.x), cy + p.y));

export function fmtMs(ms) {
  const s = ms / 1000;
  return s >= 60 ? `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}` : `${s.toFixed(2)}s`;
}
