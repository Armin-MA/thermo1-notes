import test from 'node:test';
import assert from 'node:assert/strict';

import { computePrintFitPlan } from '../src/lib/printFit.ts';
import {
  generateTrainerProblem,
  evaluateTrainerSubmission,
} from '../src/lib/interpolationTrainer.ts';
import { waterTsatC } from '../src/lib/thermoProps.ts';

function makeRng(seed = 20261126) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function assertNoNaN(value, path = 'root') {
  if (typeof value === 'number') {
    assert.ok(Number.isFinite(value), `Expected finite number at ${path}, got ${value}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, idx) => assertNoNaN(item, `${path}[${idx}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, val] of Object.entries(value)) {
      assertNoNaN(val, `${path}.${key}`);
    }
  }
}

test('computePrintFitPlan handles standard and edge page-fit scenarios', () => {
  const fit1 = computePrintFitPlan(900);
  assert.equal(fit1.targetPages, 1);
  assert.equal(fit1.dense, false);
  assert.equal(fit1.zoom, 1);
  assert.ok(Math.abs(fit1.rawPages - 900 / 1032) < 1e-6);

  const fit2 = computePrintFitPlan(1480);
  assert.equal(fit2.targetPages, 1);
  assert.equal(fit2.dense, true);
  assert.ok(fit2.zoom >= 0.78 && fit2.zoom < 1, `Expected 0.78 <= zoom < 1, got ${fit2.zoom}`);

  const fit3 = computePrintFitPlan(1750);
  assert.equal(fit3.targetPages, 2);
  assert.equal(fit3.dense, false);
  assert.equal(fit3.zoom, 1);

  const fit4 = computePrintFitPlan(2450);
  assert.equal(fit4.targetPages, 2);
  assert.equal(fit4.dense, true);
  assert.ok(fit4.zoom >= 0.78 && fit4.zoom < 1, `Expected 0.78 <= zoom < 1, got ${fit4.zoom}`);

  const fitLarge = computePrintFitPlan(3100);
  assert.equal(fitLarge.targetPages, 4);
  assert.equal(fitLarge.dense, false);
  assert.equal(fitLarge.zoom, 1);

  for (const edge of [
    computePrintFitPlan(0),
    computePrintFitPlan(-120),
    computePrintFitPlan(900, 0),
    computePrintFitPlan(900, -500),
    computePrintFitPlan(Number.NaN),
  ]) {
    assertNoNaN(edge, 'printFitEdge');
    assert.ok(edge.targetPages >= 1);
    assert.ok(edge.zoom >= 0.78 && edge.zoom <= 1);
  }
});

test('generateTrainerProblem("region") produces valid tableSlice and phase across 20 deterministic draws', () => {
  const rng = makeRng(101);
  const seen = new Set();
  for (let i = 0; i < 20; i++) {
    const p = generateTrainerProblem('region', rng);
    assert.equal(p.mode, 'region');
    assertNoNaN(p, `region[${i}]`);
    assert.ok(['compressed', 'saturated', 'superheated'].includes(p.expectedRegion));
    seen.add(p.expectedRegion);
    assert.ok(p.tableSlice && ['A-4', 'A-5', 'A-6'].includes(p.tableSlice.tableId));
    assert.ok(Array.isArray(p.tableSlice.headers) && p.tableSlice.headers.length >= 2);
    assert.ok(Array.isArray(p.tableSlice.rows) && p.tableSlice.rows.length >= 1);
  }
  assert.equal(seen.size, 3, 'Expected all three water phase regions across 20 draws');
});

test('generateTrainerProblem("linear1d") maintains x1 < x < x2, r in [0.15, 0.85], and exact linear expectedY', () => {
  const rng = makeRng(202);
  for (let i = 0; i < 20; i++) {
    const p = generateTrainerProblem('linear1d', rng);
    assert.equal(p.mode, 'linear1d');
    assertNoNaN(p, `linear1d[${i}]`);
    assert.ok(p.x1 < p.x && p.x < p.x2, `Expected x1 < x < x2, got ${p.x1}, ${p.x}, ${p.x2}`);
    assert.ok(p.r >= 0.15 && p.r <= 0.85, `Expected r in [0.15, 0.85], got ${p.r}`);
    const interp = p.y1 + p.r * (p.y2 - p.y1);
    assert.ok(Math.abs(p.expectedY - interp) < 1e-9, `expectedY mismatch: ${p.expectedY} vs ${interp}`);
    assert.equal(p.expectedVal, p.expectedY);
  }
});

test('generateTrainerProblem("inverse") restricts to monotonic intervals and recovers bracketed property', () => {
  const rng = makeRng(303);
  for (let i = 0; i < 20; i++) {
    const p = generateTrainerProblem('inverse', rng);
    assert.equal(p.mode, 'inverse');
    assertNoNaN(p, `inverse[${i}]`);
    assert.ok(Math.abs(p.y2 - p.y1) > 1e-4, `Expected |y2 - y1| > 1e-4, got ${Math.abs(p.y2 - p.y1)}`);
    const yMin = Math.min(p.y1, p.y2);
    const yMax = Math.max(p.y1, p.y2);
    assert.ok(p.x > yMin && p.x < yMax, `Expected target x inside (${yMin}, ${yMax}), got ${p.x}`);
    const recoveredR = (p.x - p.y1) / (p.y2 - p.y1);
    const recoveredVal = p.x1 + recoveredR * (p.x2 - p.x1);
    assert.ok(
      Math.abs(p.expectedVal - recoveredVal) < 1e-9,
      `expectedVal mismatch: ${p.expectedVal} vs ${recoveredVal}`
    );
    assert.ok(p.expectedVal > p.x1 && p.expectedVal < p.x2);
    if (p.tableSlice.tableId === 'A-4') {
      assert.ok(p.x1 >= 10 && p.x2 <= 350, `Expected A-4 inverse T in [10, 350], got ${p.x1}..${p.x2}`);
    } else {
      assert.equal(p.tableSlice.tableId, 'A-6');
    }
  }
});

test('generateTrainerProblem("double2d") guarantees strictly superheated A-6 2x2 corners', () => {
  const rng = makeRng(404);
  for (let i = 0; i < 20; i++) {
    const p = generateTrainerProblem('double2d', rng);
    assert.equal(p.mode, 'double2d');
    assertNoNaN(p, `double2d[${i}]`);
    assert.equal(p.tableSlice.tableId, 'A-6');
    assert.ok(p.p1 < p.p && p.p < p.p2, `Expected p1 < p < p2`);
    assert.ok(p.t1 < p.t && p.t < p.t2, `Expected t1 < t < t2`);
    const tSatP2 = waterTsatC(p.p2);
    assert.ok(p.t1 > tSatP2 + 10, `Expected t1 > tSat(p2) + 10 (${tSatP2 + 10}), got ${p.t1}`);
    assert.ok(p.t1 > tSatP2 + 15, `Expected t1 > tSat(p2) + 15 (${tSatP2 + 15}), got ${p.t1}`);
    assert.ok(Array.isArray(p.corners) && p.corners.length === 2);
    assert.ok(p.corners[0].length === 2 && p.corners[1].length === 2);
    for (const row of p.corners) {
      for (const cell of row) {
        assert.ok(Number.isFinite(cell));
      }
    }
    const rT = (p.t - p.t1) / (p.t2 - p.t1);
    const rP = (p.p - p.p1) / (p.p2 - p.p1);
    const valP1 = p.corners[0][0] + rT * (p.corners[0][1] - p.corners[0][0]);
    const valP2 = p.corners[1][0] + rT * (p.corners[1][1] - p.corners[1][0]);
    const expected = valP1 + rP * (valP2 - valP1);
    assert.ok(Math.abs(p.expectedVal - expected) < 1e-9);
  }
});

test('evaluateTrainerSubmission checks tolerances and detects swapped_r trap', () => {
  const rng = makeRng(505);

  const regionProb = generateTrainerProblem('region', rng);
  assert.equal(evaluateTrainerSubmission(regionProb, { phase: regionProb.expectedRegion }).correct, true);
  const wrongPhase = regionProb.expectedRegion === 'compressed' ? 'superheated' : 'compressed';
  assert.equal(evaluateTrainerSubmission(regionProb, { phase: wrongPhase }).correct, false);

  const linearProb = generateTrainerProblem('linear1d', rng);
  const tol =
    Math.abs(linearProb.expectedVal) < 0.01 ? 2e-5 : Math.abs(linearProb.expectedVal) * 0.006;

  assert.equal(
    evaluateTrainerSubmission(linearProb, { value: linearProb.expectedVal + tol * 0.8 }).correct,
    true
  );
  assert.equal(
    evaluateTrainerSubmission(linearProb, { value: linearProb.expectedVal + tol * 1.5 }).correct,
    false
  );
  assert.equal(
    evaluateTrainerSubmission(linearProb, { r: linearProb.r + 0.012 }).correct,
    true
  );
  assert.equal(
    evaluateTrainerSubmission(linearProb, { r: linearProb.r + 0.03 }).correct,
    false
  );

  const swappedRFeedback = evaluateTrainerSubmission(linearProb, { r: 1 - linearProb.r });
  assert.equal(swappedRFeedback.correct, false);
  assert.equal(swappedRFeedback.trapDetected, 'swapped_r');

  const swappedVal = linearProb.y1 + (1 - linearProb.r) * (linearProb.y2 - linearProb.y1);
  if (Math.abs(swappedVal - linearProb.expectedVal) > tol) {
    const swappedValFeedback = evaluateTrainerSubmission(linearProb, { value: swappedVal });
    assert.equal(swappedValFeedback.correct, false);
    assert.equal(swappedValFeedback.trapDetected, 'swapped_r');
  }

  // Verify small-magnitude tolerance rule (±2e-5 when |expected| < 0.01)
  const syntheticSmallProblem = {
    ...linearProb,
    y1: 0.00401,
    y2: 0.00451,
    r: 0.3,
    expectedY: 0.00416,
    expectedVal: 0.00416,
  };
  assert.equal(
    evaluateTrainerSubmission(syntheticSmallProblem, { value: 0.00416 + 1.8e-5 }).correct,
    true
  );
  assert.equal(
    evaluateTrainerSubmission(syntheticSmallProblem, { value: 0.00416 + 2.5e-5 }).correct,
    false
  );

  const inverseProb = generateTrainerProblem('inverse', rng);
  assert.equal(
    evaluateTrainerSubmission(inverseProb, {
      r: inverseProb.r,
      value: inverseProb.expectedVal,
    }).correct,
    true
  );
  const invSwapped = evaluateTrainerSubmission(inverseProb, { r: 1 - inverseProb.r });
  assert.equal(invSwapped.correct, false);
  assert.equal(invSwapped.trapDetected, 'swapped_r');

  const doubleProb = generateTrainerProblem('double2d', rng);
  const doubleTol =
    Math.abs(doubleProb.expectedVal) < 0.01
      ? 2e-5
      : Math.abs(doubleProb.expectedVal) * 0.006;
  assert.equal(
    evaluateTrainerSubmission(doubleProb, { value: doubleProb.expectedVal }).correct,
    true
  );
  const swapT =
    doubleProb.corners[0][0] +
    (1 - doubleProb.rT) * (doubleProb.corners[0][1] - doubleProb.corners[0][0]) +
    doubleProb.rP *
      (doubleProb.corners[1][0] +
        (1 - doubleProb.rT) * (doubleProb.corners[1][1] - doubleProb.corners[1][0]) -
        (doubleProb.corners[0][0] +
          (1 - doubleProb.rT) * (doubleProb.corners[0][1] - doubleProb.corners[0][0])));
  if (Math.abs(swapT - doubleProb.expectedVal) > doubleTol) {
    const doubleSwapped = evaluateTrainerSubmission(doubleProb, { value: swapT });
    assert.equal(doubleSwapped.correct, false);
    assert.equal(doubleSwapped.trapDetected, 'swapped_r');
  }

  // Deterministic Cengel Table A-6 double2d swapped_r check (Example 2 style)
  const explicitDouble = {
    ...doubleProb,
    p1: 1000,
    p: 1150,
    p2: 1200,
    t1: 200,
    t: 220,
    t2: 250,
    rT: 0.2,
    rP: 0.75,
    corners: [
      [2828.3, 2943.1],
      [2816.1, 2935.6],
    ],
    expectedVal: 2843.2475,
  };
  const explicitSwapT =
    2828.3 +
    0.8 * (2943.1 - 2828.3) +
    0.75 * (2816.1 + 0.8 * (2935.6 - 2816.1) - (2828.3 + 0.8 * (2943.1 - 2828.3)));
  const explicitDoubleSwapped = evaluateTrainerSubmission(explicitDouble, {
    value: explicitSwapT,
  });
  assert.equal(explicitDoubleSwapped.correct, false);
  assert.equal(explicitDoubleSwapped.trapDetected, 'swapped_r');
});
