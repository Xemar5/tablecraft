import { z } from 'zod';

/**
 * Popups. A popup is a component (kind 'popup') designed like any other but never placed on the table: scripts show it
 * on players' screens with `game.popup`, over the table (the game area), and players close it there. Its settings say
 * where it goes and how it behaves; each `game.popup` call may override them.
 *
 * An open popup (`Project.popups`) is shared state, shown to the seats in `to` (everyone when absent) that haven't
 * closed it (`closed`). Opening and closing popups are never undo steps (history entries don't record them).
 */

const id = z.string().min(1).max(100);
const num = z.number().finite();

/** Where a laid-out popup sits in the game area: one of nine points, like a layer's pivot presets. */
export const POPUP_ANCHORS = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'] as const;
export type PopupAnchor = typeof POPUP_ANCHORS[number];

export const popupSettingsSchema = z.object({
  /**
   * 'layout' places it at `anchor`, `margin` in from the game area's edges, sized by `fit` as the area changes;
   * 'fixed' puts its top-left corner at `x`, `y` of the game area at its own size.
   */
  layout: z.enum(['layout', 'fixed']).optional(),
  anchor: z.enum(POPUP_ANCHORS).optional(),
  /** Space (px) kept between it and the game area's edges in a layout. */
  margin: num.min(0).max(2000).optional(),
  /** In a layout: 'none' keeps its size, 'shrink' scales it down to fit the area (never up), 'fill' scales it up or down to fill it. */
  fit: z.enum(['none', 'shrink', 'fill']).optional(),
  /** Offset (px) in a layout; the top-left corner when fixed. */
  x: num.min(-10000).max(10000).optional(),
  y: num.min(-10000).max(10000).optional(),
  /** Its size relative to the component's (before fitting). */
  scale: num.min(0.1).max(10).optional(),
  /** Blurs (and dims) the table behind it, which can't be used until it's closed. */
  blur: z.boolean().optional(),
  /** Players can drag it to another place on their screen (only theirs). */
  draggable: z.boolean().optional(),
  /** Players can close it with its × button (or Escape). */
  closable: z.boolean().optional(),
  /** 'each': each player closes their own copy; 'all': closing it closes it for everyone. */
  dismiss: z.enum(['each', 'all']).optional(),
  /** Closes by itself after this many seconds (0: stays until closed). */
  duration: num.min(0).max(3600).optional(),
  /** Closes it for that player once a layer click has run the component's script action. */
  closeOnAction: z.boolean().optional(),
});
export type PopupSettings = z.infer<typeof popupSettingsSchema>;
export type ResolvedPopupSettings = Required<PopupSettings>;

export const POPUP_DEFAULTS: ResolvedPopupSettings = {
  layout: 'layout', anchor: 'center', margin: 24, fit: 'shrink', x: 0, y: 0, scale: 1,
  blur: false, draggable: false, closable: true, dismiss: 'each', duration: 0, closeOnAction: false,
};

/** An open popup: which popup component (and data row) shows, to whom, and what this call changed. */
export const popupSchema = z.object({
  id,
  componentId: id,
  /** The data row its {{fields}} read (from 0). */
  row: z.number().int().min(0).default(0),
  /** Field values for its {{fields}}, over the row's. */
  data: z.record(z.string().max(100), z.string().max(4000)).optional(),
  /** The seats it's shown to; everyone when absent. */
  to: z.array(id).max(100).optional(),
  /** Seats that closed their copy. */
  closed: z.array(id).max(100).optional(),
  /** Settings this call overrides. */
  settings: popupSettingsSchema.optional(),
  /** The seat whose action opened it. */
  player: id.optional(),
});
export type Popup = z.infer<typeof popupSchema>;
export const POPUP_LIMIT = 50;

/** A popup's settings: its component's, then the call's overrides, then the defaults. */
export const popupSettings = (component: { popup?: PopupSettings }, popup?: Pick<Popup, 'settings'>): ResolvedPopupSettings =>
  ({ ...POPUP_DEFAULTS, ...defined(component.popup), ...defined(popup?.settings) });
const defined = <T extends object>(value: T | undefined): Partial<T> =>
  Object.fromEntries(Object.entries(value ?? {}).filter(([, entry]) => entry !== undefined)) as Partial<T>;

/** Whether a seat (or a seatless viewer, `undefined`) sees an open popup. */
export const popupShownTo = (popup: Pick<Popup, 'to' | 'closed'>, seat: string | undefined) =>
  (!popup.to || (!!seat && popup.to.includes(seat))) && !(seat && popup.closed?.includes(seat));

const ANCHOR_SHARE: Record<PopupAnchor, [number, number]> = {
  'top-left': [0, 0], top: [.5, 0], 'top-right': [1, 0], left: [0, .5], center: [.5, .5], right: [1, .5],
  'bottom-left': [0, 1], bottom: [.5, 1], 'bottom-right': [1, 1],
};

/**
 * Where a popup of `size` (the component's) goes in a game area of `area`: its box in the area's pixels and the scale
 * its face is drawn at. A layout keeps it `margin` in from the edges at its anchor (an offset moves it from there) and
 * fits it to the room left; fixed popups sit at x, y at their own size.
 */
export function popupBox(size: { width: number; height: number }, area: { width: number; height: number }, settings: ResolvedPopupSettings) {
  let scale = settings.scale, width = size.width * scale, height = size.height * scale;
  if (settings.layout === 'fixed') return { left: settings.x, top: settings.y, width, height, scale };
  const room = { width: Math.max(1, area.width - 2 * settings.margin), height: Math.max(1, area.height - 2 * settings.margin) };
  const fit = Math.min(room.width / width, room.height / height);
  const factor = settings.fit === 'fill' ? fit : settings.fit === 'shrink' ? Math.min(1, fit) : 1;
  scale *= factor; width *= factor; height *= factor;
  const [ax, ay] = ANCHOR_SHARE[settings.anchor];
  return { left: settings.margin + (room.width - width) * ax + settings.x, top: settings.margin + (room.height - height) * ay + settings.y, width, height, scale };
}

/**
 * Closes popups for some seats: each seat's copy closes, and a popup is gone once every seat it's shown to closed it
 * (`everyone` is the table's seats, for popups shown to all). Without seats, or for a popup closed by everyone at
 * once (`dismiss: 'all'`), it's gone at once.
 */
export function closePopups(popups: Popup[], ids: ReadonlySet<string>, seats: string[] | undefined, everyone: string[], dismissAll: (popup: Popup) => boolean): Popup[] {
  return popups.flatMap(popup => {
    if (!ids.has(popup.id)) return [popup];
    if (!seats || dismissAll(popup)) return [];
    const closed = [...new Set([...popup.closed ?? [], ...seats.filter(seat => !popup.to || popup.to.includes(seat))])];
    return (popup.to ?? everyone).every(seat => closed.includes(seat)) ? [] : [{ ...popup, closed }];
  });
}
