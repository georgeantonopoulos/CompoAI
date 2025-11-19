
export enum BlendMode {
  NORMAL = 'normal',
  MULTIPLY = 'multiply',
  SCREEN = 'screen',
  OVERLAY = 'overlay',
  DARKEN = 'darken',
  LIGHTEN = 'lighten',
  COLOR_DODGE = 'color-dodge',
  COLOR_BURN = 'color-burn',
  HARD_LIGHT = 'hard-light',
  SOFT_LIGHT = 'soft-light',
  DIFFERENCE = 'difference',
  EXCLUSION = 'exclusion',
  HUE = 'hue',
  SATURATION = 'saturation',
  COLOR = 'color',
  LUMINOSITY = 'luminosity'
}

export interface ColorCorrection {
  brightness: number; // 0-200, default 100
  contrast: number;   // 0-200, default 100
  saturation: number; // 0-200, default 100
  hue: number;        // -180 to 180, default 0
  blur: number;       // 0-20, default 0
}

export interface Layer {
  id: string;
  name: string;
  type: 'image' | 'text'; // simplified to image for MVP, structure ready for text
  src: string; // base64 or url - current display source (could be masked)
  originalSrc?: string; // base64 or url - original source for non-destructive unmasking
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scale: number;
  opacity: number;
  blendMode: BlendMode;
  isVisible: boolean;
  isLocked: boolean;
  isMasked?: boolean; // Track if AI background removal is active
  zIndex: number;
  colorCorrection: ColorCorrection;
}

export type Tool = 'move' | 'hand';

export interface AIRequestState {
  isLoading: boolean;
  error: string | null;
}
