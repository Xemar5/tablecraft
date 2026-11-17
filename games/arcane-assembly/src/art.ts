// Vector illustrations. Card art is drawn as light glyphs so it sits on any faction colour;
// resource art is drawn in each resource's own colour.
import { C, P, Draw, circlePts, crescentPts, dropPts, ellipsePts, flamePts, gearPts, heartPts, leafPts, mix, polyPts, roundRectPts, spiralPts, workerPts } from './kit';

const W = '#FFFFFF', S = 'rgba(255, 255, 255, 0.55)', D = 'rgba(16, 18, 28, 0.5)';

/** Card illustrations on a 100 × 100 canvas. */
export const ART: Record<string, (d: Draw) => void> = {
  gear: d => { d.path(gearPts(50, 50, 46, 37, 10, 0.42), W); d.ell(32, 32, 36, 36, D); d.ell(42, 42, 16, 16, W); },
  golem: d => {
    d.rect(30, 74, 15, 20, W, { radius: 4 }); d.rect(55, 74, 15, 20, W, { radius: 4 });
    d.rect(9, 40, 13, 34, S, { radius: 6 }); d.rect(78, 40, 13, 34, S, { radius: 6 });
    d.rect(22, 36, 56, 42, W, { radius: 10 }); d.rect(36, 13, 28, 23, W, { radius: 7 });
    d.rect(41, 21, 18, 6, D, { radius: 3 }); d.ell(42, 49, 16, 16, D);
  },
  colossus: d => {
    d.rect(28, 74, 16, 22, W, { radius: 3 }); d.rect(56, 74, 16, 22, W, { radius: 3 });
    d.path([P(14, 30), P(86, 30), P(76, 78), P(24, 78)], W);
    d.ell(2, 20, 28, 24, S); d.ell(70, 20, 28, 24, S);
    d.rect(40, 6, 20, 20, W, { radius: 5 }); d.rect(44, 13, 12, 4, D, { radius: 2 });
    d.star(38, 38, 24, 24, 4, 0.4, D);
  },
  robot: d => {
    d.rect(48, 10, 4, 16, W); d.ell(43, 3, 14, 14, S);
    d.rect(10, 42, 9, 20, S, { radius: 3 }); d.rect(81, 42, 9, 20, S, { radius: 3 });
    d.rect(18, 24, 64, 54, W, { radius: 14 });
    d.ell(30, 40, 15, 15, D); d.ell(55, 40, 15, 15, D); d.rect(36, 63, 28, 6, D, { radius: 3 });
  },
  drone: d => {
    d.rect(10, 38, 80, 5, S, { radius: 2 }); d.ell(0, 32, 34, 9, W); d.ell(66, 32, 34, 9, W);
    d.line([P(40, 66), P(32, 88)], S, 5); d.line([P(60, 66), P(68, 88)], S, 5);
    d.ell(28, 38, 44, 34, W); d.ell(42, 47, 16, 16, D);
  },
  spider: d => {
    for (const leg of [[[38, 52], [20, 36], [8, 52]], [[36, 58], [16, 60], [6, 78]], [[40, 64], [24, 80], [18, 95]]]) {
      d.line(leg.map(([x, y]) => P(x, y)), W, 5);
      d.line(leg.map(([x, y]) => P(100 - x, y)), W, 5);
    }
    d.ell(30, 40, 40, 34, W); d.ell(38, 24, 24, 20, W); d.ell(42, 30, 5, 5, D); d.ell(53, 30, 5, 5, D);
  },
  legion: d => {
    d.rect(4, 80, 92, 14, S, { radius: 4 });
    for (const [x, y] of [[6, 42], [64, 42], [35, 24]]) { d.rect(x, y, 30, 40, W, { radius: 8 }); d.rect(x + 6, y + 12, 18, 6, D, { radius: 3 }); }
  },
  factory: d => {
    d.ell(72, 2, 14, 14, S); d.ell(84, 8, 10, 10, S);
    d.path([P(6, 92), P(6, 52), P(28, 38), P(28, 52), P(50, 38), P(50, 52), P(72, 38), P(72, 92)], W);
    d.rect(76, 18, 14, 74, W);
    d.rect(14, 64, 10, 10, D); d.rect(32, 64, 10, 10, D); d.rect(50, 64, 10, 10, D);
  },
  furnace: d => {
    d.rect(62, 6, 12, 24, S); d.rect(10, 26, 80, 12, W, { radius: 4 }); d.rect(16, 36, 68, 56, W, { radius: 10 });
    d.rect(32, 54, 36, 32, D, { radius: 14 }); d.path(flamePts(50, 58, 20, 26), W);
  },
  minecart: d => {
    d.poly(20, 14, 26, 26, 6, S); d.poly(40, 6, 30, 30, 5, S); d.poly(60, 16, 24, 24, 6, S);
    d.rect(6, 34, 88, 9, W, { radius: 3 }); d.path([P(12, 42), P(88, 42), P(78, 76), P(22, 76)], W);
    d.ell(18, 66, 22, 22, W); d.ell(60, 66, 22, 22, W); d.ell(25, 73, 8, 8, D); d.ell(67, 73, 8, 8, D);
  },
  pickaxe: d => {
    d.rect(45, 28, 10, 66, W, { radius: 4 });
    d.path([C(8, 46, 16, -10, 12, -22), C(50, 16, -24, 0, 24, 0), C(92, 46, -12, -22, -16, -10), C(50, 32, 20, 0, -20, 0)], W);
  },
  boiler: d => {
    d.rect(70, 50, 20, 8, S); d.rect(84, 50, 8, 40, S);
    d.rect(12, 28, 62, 64, W, { radius: 16 }); d.rect(12, 46, 62, 5, D); d.rect(12, 70, 62, 5, D);
    d.ell(52, 4, 36, 36, W); d.ell(57, 9, 26, 26, D); d.path([P(66, 25), P(71, 20), P(80, 11)], W);
  },
  spiral: d => { d.line(spiralPts(50, 50, 4, 42, 3), W, 7); d.ell(44, 44, 12, 12, W); },
  leaf: d => {
    d.path([C(50, 94, 44, -26, -44, -26), C(50, 6, -34, 30, 34, 30)], W);
    d.line([P(50, 88), P(50, 18)], D, 3); d.line([P(50, 62), P(33, 46)], D, 2.5); d.line([P(50, 46), P(66, 31)], D, 2.5);
  },
  seed: d => {
    d.ell(16, 80, 68, 14, S); d.rect(47, 42, 6, 42, W, { radius: 3 });
    d.path(leafPts(50, 48, 14, 26, 12), W); d.path(leafPts(50, 42, 84, 18, 12), W);
  },
  tree: d => {
    d.path([P(42, 94), P(58, 94), P(55, 56), P(45, 56)], W);
    d.ell(10, 16, 46, 46, W); d.ell(44, 8, 46, 46, W); d.ell(24, 34, 52, 36, W);
    d.ell(42, 66, 6, 6, D); d.ell(52, 66, 6, 6, D);
  },
  flower: d => {
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3, cx = 50 + Math.sin(a) * 22, cy = 50 - Math.cos(a) * 22;
      d.ell(cx - 12, cy - 21, 24, 42, i % 2 ? S : W, { rotation: i * 60 });
    }
    d.ell(37, 37, 26, 26, D); d.ell(44, 44, 12, 12, W);
  },
  flame: d => { d.path(flamePts(50, 4, 66, 92), W); d.path(flamePts(50, 44, 30, 48), D); },
  anvil: d => {
    d.path([P(4, 30), P(20, 22), P(94, 22), P(94, 40), P(68, 44), P(62, 62), P(76, 72), P(76, 80), P(24, 80), P(24, 72), P(38, 62), P(34, 44), P(22, 40)], W);
    d.rect(16, 82, 68, 10, S, { radius: 3 });
  },
  hammer: d => {
    const f = d.frame(0, 0, 100, 100, { rotation: -35 });
    f.rect(45, 30, 10, 66, W, { radius: 4 }); f.rect(18, 8, 64, 26, W, { radius: 5 }); f.rect(41, 8, 18, 26, D);
  },
  crystal: d => {
    d.path([P(12, 56), P(24, 44), P(30, 92), P(16, 92)], S); d.path([P(88, 56), P(76, 44), P(70, 92), P(84, 92)], S);
    d.path([P(50, 4), P(74, 28), P(66, 92), P(34, 92), P(26, 28)], W);
    d.path([P(50, 4), P(74, 28), P(50, 38)], D, { opacity: 0.55 }); d.line([P(50, 38), P(50, 92)], D, 2);
  },
  star: d => { d.star(12, 12, 76, 76, 4, 0.34, W); d.star(70, 4, 24, 24, 4, 0.34, S); d.star(6, 70, 20, 20, 4, 0.34, S); },
  moon: d => { d.path(crescentPts(62, 6, 88), W); d.star(66, 24, 18, 18, 4, 0.34, S); d.star(78, 58, 12, 12, 4, 0.34, S); },
  telescope: d => {
    d.line([P(50, 54), P(30, 95)], S, 5); d.line([P(50, 54), P(70, 95)], S, 5); d.line([P(50, 54), P(50, 95)], S, 5);
    const f = d.frame(0, 0, 100, 100, { rotation: -28 });
    f.rect(18, 36, 62, 20, W, { radius: 6 }); f.rect(76, 30, 14, 32, W, { radius: 4 }); f.rect(8, 40, 12, 12, S, { radius: 2 });
  },
  rune: d => {
    d.path([P(32, 6), P(72, 10), P(88, 48), P(72, 92), P(28, 90), P(12, 48)], W);
    d.line([P(40, 26), P(60, 40), P(40, 56), P(60, 72)], D, 5);
  },
  orrery: d => {
    d.ring(50, 50, 44, S, 3);
    d.path(ellipsePts(50, 50, 46, 16, -20), 'transparent', { stroke: W, sw: 3 });
    d.ell(36, 36, 28, 28, W); d.ell(86, 28, 12, 12, W); d.ell(4, 60, 10, 10, S); d.ell(45, 1, 10, 10, S);
  },
  book: d => {
    d.path([P(6, 22), P(48, 30), P(48, 90), P(6, 82)], W); d.path([P(52, 30), P(94, 22), P(94, 82), P(52, 90)], W);
    d.line([P(14, 44), P(40, 49)], D, 3); d.line([P(14, 58), P(40, 63)], D, 3);
    d.line([P(60, 49), P(86, 44)], D, 3); d.line([P(60, 63), P(86, 58)], D, 3);
  },
  scroll: d => {
    d.rect(18, 14, 64, 72, W); d.rect(10, 8, 80, 14, S, { radius: 7 }); d.rect(10, 78, 80, 14, S, { radius: 7 });
    d.rect(28, 34, 44, 4, D); d.rect(28, 46, 44, 4, D); d.rect(28, 58, 28, 4, D);
  },
  crown: d => {
    d.path([P(10, 82), P(10, 34), P(30, 54), P(50, 22), P(70, 54), P(90, 34), P(90, 82)], W);
    d.ell(4, 24, 12, 12, W); d.ell(44, 12, 12, 12, W); d.ell(84, 24, 12, 12, W);
    d.rect(10, 68, 80, 6, D); d.ell(45, 50, 10, 10, D);
  },
  trophy: d => {
    d.ring(20, 30, 12, W, 6); d.ring(80, 30, 12, W, 6);
    d.path([C(22, 10, 0, 36, 0, 0), C(78, 10, 0, 0, 0, 36), C(50, 64, 22, 0, -22, 0)], W);
    d.rect(45, 60, 10, 18, W); d.rect(28, 78, 44, 12, W, { radius: 3 }); d.star(39, 18, 22, 22, 5, 0.45, D);
  },
  tower: d => {
    d.rect(18, 70, 12, 24, S); d.rect(70, 70, 12, 24, S);
    d.rect(30, 34, 40, 60, W); d.path([P(50, 2), P(76, 36), P(24, 36)], W);
    d.rect(44, 46, 12, 14, D, { radius: 6 }); d.rect(44, 70, 12, 14, D, { radius: 6 });
  },
  bolt: d => {
    d.path([P(58, 4), P(22, 56), P(46, 56), P(38, 96), P(80, 40), P(56, 40), P(70, 4)], W);
    d.star(8, 14, 18, 18, 4, 0.3, S); d.star(78, 70, 14, 14, 4, 0.3, S);
  },
  flask: d => {
    d.path([P(40, 6), P(60, 6), P(60, 36), P(86, 80), P(80, 92), P(20, 92), P(14, 80), P(40, 36)], W);
    d.path([P(27, 58), P(73, 58), P(86, 80), P(80, 92), P(20, 92), P(14, 80)], D);
    d.ell(40, 66, 8, 8, W); d.ell(54, 76, 6, 6, W); d.rect(36, 4, 28, 6, S, { radius: 3 });
  },
  heart: d => { d.path(heartPts(50, 14, 100, 78), W); d.path(gearPts(50, 46, 15, 11, 8, 0.45), D); },
  moth: d => {
    d.ell(6, 14, 44, 40, W, { rotation: -20 }); d.ell(50, 14, 44, 40, W, { rotation: 20 });
    d.ell(16, 50, 32, 32, S, { rotation: 25 }); d.ell(52, 50, 32, 32, S, { rotation: -25 });
    d.ell(22, 28, 10, 10, D); d.ell(68, 28, 10, 10, D);
    d.rect(45, 24, 10, 60, D, { radius: 5 });
    d.line([P(48, 26), P(40, 6)], S, 3); d.line([P(52, 26), P(60, 6)], S, 3);
  },
  valve: d => {
    d.ring(50, 50, 38, W, 9); d.rect(46, 14, 8, 72, W); d.rect(14, 46, 72, 8, W);
    d.ell(36, 36, 28, 28, W); d.ell(44, 44, 12, 12, D);
  },
  gauge: d => {
    d.ell(8, 8, 84, 84, W);
    d.rect(48, 14, 4, 10, D); d.rect(14, 48, 10, 4, D); d.rect(76, 48, 10, 4, D);
    d.path([P(45, 53), P(53, 45), P(78, 22)], D); d.ell(42, 42, 16, 16, D);
  },
  cauldron: d => {
    d.ell(26, 8, 14, 14, S); d.ell(46, 0, 10, 10, S); d.ell(58, 10, 18, 18, S);
    d.rect(22, 84, 8, 12, W); d.rect(70, 84, 8, 12, W);
    d.path([C(14, 40, -4, 34, 0, 0), C(86, 40, 0, 0, 4, 34), C(50, 92, 30, 0, -30, 0)], W);
    d.rect(8, 32, 84, 10, W, { radius: 5 }); d.rect(16, 52, 68, 4, D);
  },
  eye: d => {
    d.path([C(4, 50, 24, 36, 24, -36), C(96, 50, -24, -36, -24, 36)], W);
    d.ell(31, 31, 38, 38, D); d.rect(46, 34, 8, 32, W, { radius: 4 });
  },
  banner: d => { d.path([P(24, 6), P(76, 6), P(76, 92), P(50, 74), P(24, 92)], W); d.star(36, 20, 28, 28, 5, 0.45, D); },
  mountain: d => {
    d.ell(68, 4, 20, 20, S);
    d.path([P(2, 92), P(36, 22), P(54, 52), P(68, 36), P(98, 92)], W);
    d.path([P(36, 22), P(54, 52), P(46, 92), P(36, 92)], D, { opacity: 0.6 });
  },
  citadel: d => {
    d.rect(34, 14, 8, 10, W); d.rect(46, 14, 8, 10, W); d.rect(58, 14, 8, 10, W);
    d.path([P(8, 92), P(8, 34), P(22, 34), P(22, 44), P(34, 44), P(34, 22), P(66, 22), P(66, 44), P(78, 44), P(78, 34), P(92, 34), P(92, 92)], W);
    d.rect(42, 66, 16, 26, D, { radius: 8 }); d.rect(46, 32, 8, 10, D, { radius: 4 });
  },
  airship: d => {
    d.line([P(30, 44), P(36, 64)], S, 3); d.line([P(70, 44), P(64, 64)], S, 3);
    d.ell(8, 6, 84, 44, W); d.path(ellipsePts(50, 28, 18, 22), 'transparent', { stroke: D, sw: 3 });
    d.ell(76, 62, 8, 22, S); d.rect(28, 62, 46, 18, W, { radius: 4 });
    d.rect(35, 68, 7, 6, D); d.rect(47, 68, 7, 6, D); d.rect(59, 68, 7, 6, D);
  },
  bridge: d => {
    d.line([C(6, 56, 0, 0, 22, -48), C(94, 56, -22, -48, 0, 0)], S, 5);
    d.line([P(30, 31), P(30, 56)], S, 3); d.line([P(50, 22), P(50, 56)], S, 3); d.line([P(70, 31), P(70, 56)], S, 3);
    d.rect(2, 54, 96, 9, W); d.rect(12, 63, 10, 31, W); d.rect(78, 63, 10, 31, W);
  },
  worker: d => { d.ell(36, 8, 28, 28, W); d.path(workerPts(18, 30, 64, 64), W); d.rect(40, 58, 20, 6, D, { radius: 3 }); },
};

/** Resource art inside a 100 × 100 token face (artwork stays within roughly 26..74). */
export const RESOURCE_ART: Record<string, (d: Draw, c: string, dark: string, tint: string) => void> = {
  coal: (d, c, k) => { d.poly(24, 42, 28, 28, 5, c); d.poly(44, 27, 30, 30, 6, k); d.poly(46, 48, 28, 26, 5, c); },
  copper: (d, c, k, t) => {
    d.path([P(25, 72), P(75, 72), P(68, 55), P(32, 55)], c); d.path([P(33, 52), P(67, 52), P(61, 36), P(39, 36)], k);
    d.rect(43, 41, 12, 3, t, { radius: 1.5 });
  },
  steam: (d, c, k) => {
    d.ell(24, 42, 24, 22, c); d.ell(37, 28, 30, 30, c); d.ell(54, 36, 24, 24, c); d.rect(28, 48, 46, 14, c, { radius: 7 });
    d.rect(32, 67, 26, 4, k, { radius: 2 }); d.rect(44, 74, 24, 4, k, { radius: 2 });
  },
  brasscog: (d, c, k, t) => { d.path(gearPts(50, 50, 25, 18, 8, 0.45), c); d.ell(40, 40, 20, 20, t); d.ell(45, 45, 10, 10, k); },
  mainspring: (d, c, k) => { d.line(spiralPts(50, 50, 3, 22, 2.5), c, 5); d.ell(45, 45, 10, 10, k); },
  sap: (d, c, k, t) => { d.path(dropPts(50, 24, 38, 50), c); d.ell(40, 50, 7, 12, t); d.rect(30, 75, 40, 4, k, { radius: 2 }); },
  bark: (d, c, k) => {
    d.rect(30, 28, 40, 44, c, { radius: 8 });
    d.line([P(40, 34), P(37, 50), P(41, 66)], k, 3); d.line([P(51, 32), P(54, 48), P(50, 68)], k, 3); d.line([P(61, 37), P(59, 52)], k, 3);
  },
  silkvine: (d, c, k, t) => {
    d.rect(37, 36, 26, 28, c); d.rect(37, 44, 26, 2.5, t); d.rect(37, 52, 26, 2.5, t);
    d.rect(31, 29, 38, 8, k, { radius: 3 }); d.rect(31, 63, 38, 8, k, { radius: 3 });
    d.line([P(63, 58), C(74, 64, 0, -6, 0, 6), P(68, 76)], c, 2.5);
  },
  moonpetal: (d, c, k) => { d.path(crescentPts(58, 26, 48), c); d.star(58, 36, 12, 12, 4, 0.34, k); },
  heartseed: (d, c, k, t) => { d.path(heartPts(50, 28, 52, 44), c); d.path(leafPts(50, 48, 60, 38, 4), t); d.ell(46, 46, 8, 8, k); },
  ember: (d, c, k, t) => { d.path(flamePts(50, 24, 38, 50), c); d.path(flamePts(50, 46, 16, 26), t); },
  ash: (d, c, k) => {
    d.path([C(24, 72, 0, 0, 8, -30), C(76, 72, -8, -30, 0, 0)], c);
    d.ell(40, 52, 6, 6, k); d.ell(52, 44, 5, 5, k); d.ell(58, 58, 6, 6, k); d.ell(46, 62, 4, 4, k);
  },
  brimstone: (d, c, k) => {
    d.path([P(34, 46), P(41, 54), P(39, 74), P(28, 74), P(26, 54)], k); d.path([P(66, 46), P(74, 54), P(72, 74), P(61, 74), P(59, 54)], k);
    d.path([P(50, 24), P(63, 42), P(57, 74), P(43, 74), P(37, 42)], c);
  },
  magma: (d, c, k) => {
    d.path([P(30, 40), P(46, 27), P(66, 31), P(75, 52), P(62, 73), P(38, 71), P(25, 56)], k);
    d.line([P(40, 40), P(50, 52), P(45, 64)], c, 4); d.line([P(50, 52), P(64, 45)], c, 4); d.ell(57, 58, 7, 7, c);
  },
  salamander: (d, c, k, t) => {
    d.path([P(28, 30), P(72, 30), C(72, 48, 0, 0, 0, 14), C(50, 76, 14, -6, -14, -6), C(28, 48, 0, 14, 0, 0)], c);
    d.path([P(37, 37), P(63, 37), C(63, 49, 0, 0, 0, 9), C(50, 66, 9, -4, -9, -4), C(37, 49, 0, 9, 0, 0)], k);
    d.line([P(50, 40), P(50, 60)], t, 2.5);
  },
  stardust: (d, c, k) => { d.star(26, 26, 46, 46, 4, 0.3, c); d.star(62, 24, 14, 14, 4, 0.3, k); d.star(28, 60, 13, 13, 4, 0.3, k); },
  prism: (d, c, k) => { d.path([P(50, 24), P(76, 72), P(24, 72)], c); d.path([P(50, 24), P(50, 72), P(24, 72)], k); },
  runestone: (d, c, k, t) => { d.rect(31, 26, 38, 48, c, { radius: 13 }); d.line([P(43, 37), P(57, 47), P(43, 55), P(57, 65)], t, 3.5); },
  quicksilver: (d, c, k, t) => {
    d.ell(27, 40, 28, 28, c); d.ell(46, 27, 24, 24, c); d.ell(48, 47, 26, 26, k);
    d.ell(34, 47, 7, 7, t); d.ell(53, 33, 6, 6, t); d.ell(56, 55, 6, 6, t);
  },
  voidpearl: (d, c, k, t) => { d.ell(28, 28, 44, 44, c); d.ell(28, 28, 44, 44, k, { opacity: 0.35 }); d.ell(36, 35, 13, 13, t); d.star(53, 52, 13, 13, 4, 0.3, t); },
};

export type Rarity = 'abundant' | 'common' | 'uncommon' | 'rare';
export const RARITIES: Rarity[] = ['abundant', 'common', 'uncommon', 'rare'];

/** The rarity outline in a 100 × 100 box: circle, rounded square, hexagon, cog. */
export function rarityOutline(d: Draw, rarity: Rarity, color: string, width = 6.5, props: Record<string, unknown> = {}) {
  const shape = rarity === 'abundant' ? circlePts(50, 50, 45)
    : rarity === 'common' ? roundRectPts(13, 13, 74, 74, 18)
      : rarity === 'uncommon' ? polyPts(50, 50, 45.5, 6)
        : gearPts(50, 50, 46, 39, 8, 0.5);
  return d.path(shape, 'transparent', { stroke: color, sw: width, name: `${rarity} outline`, ...props });
}

export const shade = (c: string) => mix(c, '#101018', 0.38);
export const tint = (c: string) => mix(c, '#FFFFFF', 0.87);
