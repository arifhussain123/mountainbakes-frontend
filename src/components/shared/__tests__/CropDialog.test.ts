import { describe, expect, it } from 'vitest';
import { dragRect } from '../CropDialog';

const start = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 };
const close = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => {
  for (const k of ['x', 'y', 'w', 'h'] as const) expect(a[k]).toBeCloseTo(b[k], 6);
};

describe('crop frame dragging', () => {
  it('a side moves only its own edge', () => {
    close(dragRect(start, 'e', 0.1, 0.3), { x: 0.2, y: 0.2, w: 0.6, h: 0.5 });
    close(dragRect(start, 'w', -0.1, 0.3), { x: 0.1, y: 0.2, w: 0.6, h: 0.5 });
    close(dragRect(start, 'n', 0.3, 0.1), { x: 0.2, y: 0.3, w: 0.5, h: 0.4 });
    close(dragRect(start, 's', 0.3, -0.1), { x: 0.2, y: 0.2, w: 0.5, h: 0.4 });
  });

  it('a corner grows or shrinks both directions', () => {
    close(dragRect(start, 'se', 0.1, 0.2), { x: 0.2, y: 0.2, w: 0.6, h: 0.7 });
    close(dragRect(start, 'nw', 0.1, 0.1), { x: 0.3, y: 0.3, w: 0.4, h: 0.4 });
    close(dragRect(start, 'ne', -0.2, -0.1), { x: 0.2, y: 0.1, w: 0.3, h: 0.6 });
    close(dragRect(start, 'sw', -0.2, 0.1), { x: 0, y: 0.2, w: 0.7, h: 0.6 });
  });

  it('never leaves the picture', () => {
    close(dragRect(start, 'se', 5, 5), { x: 0.2, y: 0.2, w: 0.8, h: 0.8 });
    close(dragRect(start, 'nw', -5, -5), { x: 0, y: 0, w: 0.7, h: 0.7 });
    close(dragRect(start, 'move', 5, -5), { x: 0.5, y: 0, w: 0.5, h: 0.5 });
  });

  it('never shrinks below the minimum or turns inside out', () => {
    const r = dragRect(start, 'e', -5, 0);
    expect(r.w).toBeCloseTo(0.05, 6);
    expect(r.x).toBeCloseTo(0.2, 6);
    const t = dragRect(start, 'n', 0, 5);
    expect(t.h).toBeCloseTo(0.05, 6);
    expect(t.y + t.h).toBeCloseTo(0.7, 6);
  });

  it('moving keeps the size', () => {
    close(dragRect(start, 'move', 0.1, 0.05), { x: 0.3, y: 0.25, w: 0.5, h: 0.5 });
  });
});
