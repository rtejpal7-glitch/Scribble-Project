/**
 * Ink data model. Coordinates are stored in *page units* (CSS pixels at 100 % zoom,
 * 96 DPI), so 1 unit = 25.4 / 96 mm. Points are stored as parallel arrays because
 * that is compact in IndexedDB and maps 1:1 onto the MyScript stroke format.
 */

export type PenColor = 'black' | 'blue' | 'red' | 'green';

export const PEN_COLORS: Record<PenColor, string> = {
  black: '#1f2328',
  blue: '#1d4ed8',
  red: '#dc2626',
  green: '#15803d',
};

export const PEN_WIDTHS = [1.6, 2.6, 4, 6.5] as const;
/** Eraser diameters in page units. */
export const ERASER_SIZES = [12, 24, 44] as const;

export type InkPointerType = 'pen' | 'mouse' | 'touch';

export interface Stroke {
  id: string;
  pageId: string;
  /** X coordinates in page units. */
  x: number[];
  /** Y coordinates in page units. */
  y: number[];
  /** Normalised pressure 0..1, only present when the device reported real pressure. */
  p?: number[];
  /** Epoch timestamps (ms) for each point, non-decreasing. */
  t: number[];
  /** CSS colour. */
  color: string;
  /** Base width in page units (before pressure modulation). */
  width: number;
  pointerType: InkPointerType;
  /** Creation time of the original stroke; split pieces inherit it to keep z-order. */
  createdAt: number;
}

export type ToolType = 'pen' | 'eraser';
export type EraserMode = 'stroke' | 'partial';

export interface ToolState {
  tool: ToolType;
  color: PenColor;
  width: number;
  eraserMode: EraserMode;
  eraserSize: number;
  /** When false (default) fingers scroll and only pen / mouse draw. */
  fingerDrawing: boolean;
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** A4 portrait at 96 DPI. */
export const PAGE_WIDTH = 794;
export const PAGE_HEIGHT = 1123;
/** 10 mm ruling (matches MyScript's default guide gap). */
export const LINE_SPACING = 37.8;
export const RULE_TOP = 113.4;
export const MARGIN_LEFT = 75.6;

/** An undoable change to ink. Stored with the full strokes so it can be inverted. */
export type InkOperation =
  | { kind: 'add'; pageId: string; stroke: Stroke }
  | { kind: 'erase'; pageId: string; removed: Stroke[]; added: Stroke[] }
  | { kind: 'clear'; pageId: string; removed: Stroke[] };
