import { BlendMode } from './types';

export const BLEND_MODES = [
  { label: 'Normal', value: BlendMode.NORMAL },
  { label: 'Multiply', value: BlendMode.MULTIPLY },
  { label: 'Screen', value: BlendMode.SCREEN },
  { label: 'Overlay', value: BlendMode.OVERLAY },
  { label: 'Darken', value: BlendMode.DARKEN },
  { label: 'Lighten', value: BlendMode.LIGHTEN },
  { label: 'Color Dodge', value: BlendMode.COLOR_DODGE },
  { label: 'Color Burn', value: BlendMode.COLOR_BURN },
  { label: 'Hard Light', value: BlendMode.HARD_LIGHT },
  { label: 'Soft Light', value: BlendMode.SOFT_LIGHT },
  { label: 'Difference', value: BlendMode.DIFFERENCE },
  { label: 'Exclusion', value: BlendMode.EXCLUSION },
  { label: 'Hue', value: BlendMode.HUE },
  { label: 'Saturation', value: BlendMode.SATURATION },
  { label: 'Color', value: BlendMode.COLOR },
  { label: 'Luminosity', value: BlendMode.LUMINOSITY },
];

export const INITIAL_LAYER_WIDTH = 300;
export const INITIAL_LAYER_HEIGHT = 300;
