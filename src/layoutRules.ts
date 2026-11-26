import type { DesignNode } from './domain';

/**
 * How a layer's position, size and margins work, the same way design tools' auto layout does (Figma, Penpot, CSS
 * flexbox), per axis (x: X, Width, left/right margins; y: Y, Height, top/bottom margins):
 *
 * - **Fixed** size: Width/Height set it. **Hug contents**: it fits its contents (a text layer's words, a stack frame's
 *   children), so only text (unless its font shrinks to fit its box) and stack frames can hug; other layers that were
 *   saved with Hug are treated as Fixed. **Fill parent**: it stretches to its parent.
 * - X/Y place the layer's pivot (see src/layerGeometry.ts), so a Hug layer grows around it.
 * - In an **absolute** parent (or at the top of a face), X/Y place a Fixed or Hug layer. A Fill layer has no X/Y: it is
 *   inset from the parent's edges by its margins on that axis (like left and right constraints).
 * - In a **stack** (a frame with a horizontal or vertical layout), the stack places its children, so X/Y never apply;
 *   margins add space around the layer on every edge. Fill shares the stack's free space along its direction and
 *   stretches across it.
 *
 * The renderer (ComponentView) and the designer's inspector, drag and resize handles all follow these rules, and the
 * inspector grays out a sizing a layer can't use, saying why (`sizingUnavailable`).
 */
export type SizingMode = 'fixed' | 'hug' | 'fill';
export type Axis = 'x' | 'y';

type Sized = Pick<DesignNode, 'type' | 'layout' | 'widthMode' | 'heightMode'> & Partial<Pick<DesignNode, 'autoFontSize'>>;

/**
 * Whether a layer has contents to hug: text (unless its font shrinks to fit a box, which needs the box), and frames
 * that stack their children (absolute children have no size).
 */
export const canHug = (node: Pick<DesignNode, 'type' | 'layout'> & Partial<Pick<DesignNode, 'autoFontSize'>>) =>
  (node.type === 'text' && !node.autoFontSize) || (node.type === 'frame' && node.layout !== 'absolute');

/** The sizing a layer uses on an axis: its own, except Hug on a layer that can't hug, which is Fixed. */
export function sizingOf(node: Sized, axis: Axis): SizingMode {
  const mode = (axis === 'x' ? node.widthMode : node.heightMode) ?? 'fixed';
  return mode === 'hug' && !canHug(node) ? 'fixed' : mode;
}

export type AxisRules = {
  mode: SizingMode;
  /** The parent stacks its children, so it places this layer. */
  stacked: boolean;
  /** X (or Y) places the layer. */
  position: boolean;
  /** Width (or Height) sizes the layer. */
  size: boolean;
  /** Its margins on this axis's two edges apply. */
  margins: boolean;
};

/** The rules for a layer on one axis, under `parent` (undefined at the top of a face, which places layers absolutely). */
export function axisRules(node: Sized, parent: Pick<DesignNode, 'layout'> | undefined, axis: Axis): AxisRules {
  const mode = sizingOf(node, axis), stacked = !!parent && parent.layout !== 'absolute';
  return { mode, stacked, position: !stacked && mode !== 'fill', size: mode === 'fixed', margins: stacked || mode === 'fill' };
}

/** A layer's rules on one axis, finding its parent among the face's layers. */
export function layerAxisRules(node: DesignNode, nodes: readonly DesignNode[], axis: Axis): AxisRules {
  return axisRules(node, node.parent ? nodes.find(item => item.id === node.parent) : undefined, axis);
}

/** Why X/Y (`position`) or Width/Height (`size`) don't apply to a layer on an axis, for the inspector; undefined when they do. */
export function ignoredBecause(rules: AxisRules, field: 'position' | 'size', axis: Axis): string | undefined {
  if (rules[field]) return undefined;
  if (field === 'position') return rules.stacked ? 'Placed by the parent’s stack layout'
    : `Fill parent: placed by its ${axis === 'x' ? 'left and right' : 'top and bottom'} margins`;
  return rules.mode === 'hug' ? 'Hug contents: sized to fit what it contains' : 'Fill parent: sized by its parent';
}

const AXIS_SIZE = { x: 'width', y: 'height' } as const;
/** The stack direction whose main axis is `axis`. */
const STACK_ALONG = { x: 'row', y: 'column' } as const;

/**
 * Why a layer can't use a sizing on an axis, for the inspector to gray it out with; undefined when it can. Fixed always
 * works. Hug needs contents to fit; Fill needs space to fill.
 */
export function sizingUnavailable(node: DesignNode, nodes: readonly DesignNode[], axis: Axis, mode: SizingMode): string | undefined {
  if (mode === 'fixed') return undefined;
  const parent = node.parent ? nodes.find(item => item.id === node.parent) : undefined;
  if (parent?.type === 'compound') return 'Shapes in a boolean group keep a fixed size, so the group can combine their outlines';
  const size = AXIS_SIZE[axis];
  if (mode === 'hug') {
    if (node.type === 'text' && node.autoFontSize) return 'Auto font size shrinks the text to fit a set box, so the box can’t hug the text';
    if (node.type === 'frame' && node.layout === 'absolute') return 'An absolute frame places its children freely, so there’s nothing to hug: give it a horizontal or vertical stack layout';
    if (!canHug(node)) return 'Only text and stack frames have contents to hug';
    if (node.layout === STACK_ALONG[axis] && nodes.some(child => child.parent === node.id && child.visible !== false && sizingOf(child, axis) === 'fill')) {
      return `A child fills this stack’s ${size}, so the stack can’t also hug it`;
    }
  }
  if (mode === 'fill' && parent?.layout === STACK_ALONG[axis] && sizingOf(parent, axis) === 'hug') {
    return `The parent stack hugs its ${size}, so there’s no free space to fill`;
  }
  return undefined;
}
