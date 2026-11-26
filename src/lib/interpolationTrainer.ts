/**
 * Pure physics & Cengel paper-exam table interpolation trainer engine.
 * Generates realistic neighboring slices of Tables A-4, A-5, and A-6
 * using IAPWS-IF97 via thermoProps.ts and diagnoses classic exam traps.
 */

import {
  waterSatByP,
  waterSatByT,
  waterPT,
  waterTsatC,
  waterPsatKpa,
} from './thermoProps.ts';

export type TrainerMode = 'region' | 'linear1d' | 'inverse' | 'double2d';
export type WaterPhaseKey = 'compressed' | 'saturated' | 'superheated';

export type TrainerSubmission = {
  phase?: WaterPhaseKey;
  r?: number;
  value?: number;
};

export type TrapType =
  | 'swapped_r'
  | 'wrong_r'
  | 'out_of_range_r'
  | 'out_of_bracket'
  | 'calculation_error'
  | 'phase_mismatch'
  | 'inverted_p_sat_rule'
  | 'missing_input'
  | 'invalid_input';

export interface TrainerTableRow {
  cells: (string | number)[];
  highlight?: boolean;
}

export interface TrainerTableSlice {
  tableId: 'A-4' | 'A-5' | 'A-6';
  titleFa: string;
  headers: string[];
  rows: TrainerTableRow[];
}

export interface TrainerProblem {
  mode: TrainerMode;
  promptFa: string;
  tableSlice: TrainerTableSlice;
  expectedRegion?: WaterPhaseKey;
  x1?: number;
  x?: number;
  x2?: number;
  y1?: number;
  y2?: number;
  r?: number;
  expectedY?: number;
  expectedVal?: number;
  p1?: number;
  p?: number;
  p2?: number;
  t1?: number;
  t?: number;
  t2?: number;
  rT?: number;
  rP?: number;
  corners?: [[number, number], [number, number]];
  propSymbol?: string;
  propUnit?: string;
  inputSymbol?: string;
  inputUnit?: string;
  givenInputs?: {
    pKpa?: number;
    tC?: number;
    propSymbol?: string;
    propValue?: number;
    propUnit?: string;
  };
}

export interface TrainerFeedback {
  correct: boolean;
  rOk?: boolean;
  valueOk?: boolean;
  phaseOk?: boolean;
  trapDetected: TrapType | null;
  messageFa: string;
  hintFa?: string;
  expectedVal?: number;
  expectedR?: number;
  expectedRegion?: WaterPhaseKey;
}

type WaterPropKey =
  | 'pSat'
  | 'tSat'
  | 'vf'
  | 'vg'
  | 'hf'
  | 'hg'
  | 'sf'
  | 'sg'
  | 'v'
  | 'h'
  | 's';

interface PropSpec {
  symbol: string;
  unit: string;
  decimals: number;
  labelFa: string;
}

const PROP_SPECS: Record<WaterPropKey, PropSpec> = {
  pSat: { symbol: 'P_sat', unit: 'kPa', decimals: 2, labelFa: 'فشار اشباع' },
  tSat: { symbol: 'T_sat', unit: '°C', decimals: 2, labelFa: 'دمای اشباع' },
  vf: { symbol: 'v_f', unit: 'm³/kg', decimals: 6, labelFa: 'حجم مخصوص مایع اشباع' },
  vg: { symbol: 'v_g', unit: 'm³/kg', decimals: 5, labelFa: 'حجم مخصوص بخار اشباع' },
  hf: { symbol: 'h_f', unit: 'kJ/kg', decimals: 2, labelFa: 'آنتالپی مایع اشباع' },
  hg: { symbol: 'h_g', unit: 'kJ/kg', decimals: 1, labelFa: 'آنتالپی بخار اشباع' },
  sf: { symbol: 's_f', unit: 'kJ/(kg·K)', decimals: 4, labelFa: 'آنتروپی مایع اشباع' },
  sg: { symbol: 's_g', unit: 'kJ/(kg·K)', decimals: 4, labelFa: 'آنتروپی بخار اشباع' },
  v: { symbol: 'v', unit: 'm³/kg', decimals: 5, labelFa: 'حجم مخصوص' },
  h: { symbol: 'h', unit: 'kJ/kg', decimals: 1, labelFa: 'آنتالپی' },
  s: { symbol: 's', unit: 'kJ/(kg·K)', decimals: 4, labelFa: 'آنتروپی' },
};

const PHASE_LABEL_FA: Record<WaterPhaseKey, string> = {
  compressed: 'مایع متراکم (زیرسرد)',
  saturated: 'مخلوط اشباع (دوفازی)',
  superheated: 'بخار فوق‌گرم (سوپرهیت)',
};

const A4_TEMPS: readonly number[] = [
  10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95,
  100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 220, 240, 260,
  280, 300, 320, 340, 350,
];

const A5_PRESSURES_KPA: readonly number[] = [
  50, 75, 100, 125, 150, 175, 200, 250, 300, 350, 400, 500, 600, 700, 800,
  900, 1000, 1200, 1400, 1600, 1800, 2000, 2500, 3000, 3500, 4000, 5000,
  6000, 7000, 8000, 9000, 10000,
];

const A6_PRESSURES_KPA: readonly number[] = [
  100, 200, 300, 400, 500, 600, 800, 1000, 1200, 1400, 1600, 1800, 2000,
  2500, 3000, 3500, 4000, 5000, 6000, 7000, 8000, 9000, 10000,
];

const A6_TEMPS: readonly number[] = [
  150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 800,
];

const clamp01 = (val: number): number => Math.max(0, Math.min(0.999999999999, val));

const roundTo = (val: number, decimals: number): number => {
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
};

function pickIndex(rng: () => number, length: number): number {
  return Math.floor(clamp01(rng()) * length);
}

/**
 * Picks a clean 2-decimal fraction strictly inside [0.16, 0.35] U [0.65, 0.84],
 * guaranteeing r in [0.15, 0.85] and keeping (1 - r) clearly separated from r.
 */
function pickFraction(rng: () => number): number {
  const u = clamp01(rng());
  const raw =
    u < 0.5 ? 0.16 + (u / 0.5) * 0.19 : 0.65 + ((u - 0.5) / 0.5) * 0.19;
  return Math.round(raw * 100) / 100;
}

function readSatProp(
  sat: ReturnType<typeof waterSatByT>,
  key: 'pSat' | 'tSat' | 'vf' | 'vg' | 'hf' | 'hg' | 'sf' | 'sg'
): number {
  const raw =
    key === 'pSat'
      ? sat.pKpa
      : key === 'tSat'
        ? sat.tC
        : sat[key];
  return roundTo(raw, PROP_SPECS[key].decimals);
}

function readSuperProp(
  pKpa: number,
  tC: number,
  key: 'v' | 'h' | 's'
): number {
  const st = waterPT(pKpa, tC);
  return roundTo(st[key], PROP_SPECS[key].decimals);
}

function isValueWithinTolerance(submitted: number, expected: number): boolean {
  if (!Number.isFinite(submitted) || !Number.isFinite(expected)) return false;
  const tol = Math.abs(expected) < 0.01 ? 2e-5 : Math.abs(expected) * 0.006;
  return Math.abs(submitted - expected) <= tol;
}

function bilinear(
  corners: readonly [readonly [number, number], readonly [number, number]],
  rT: number,
  rP: number
): number {
  const valP1 = corners[0][0] + rT * (corners[0][1] - corners[0][0]);
  const valP2 = corners[1][0] + rT * (corners[1][1] - corners[1][0]);
  return valP1 + rP * (valP2 - valP1);
}

function buildRegionProblem(rng: () => number): TrainerProblem {
  const regions: readonly WaterPhaseKey[] = ['compressed', 'saturated', 'superheated'];
  const expectedRegion = regions[pickIndex(rng, regions.length)];

  if (expectedRegion === 'saturated') {
    const useTempTable = rng() < 0.5;
    const q = pickFraction(rng);
    const propKey = (['v', 'h', 's'] as const)[pickIndex(rng, 3)];
    const fKey = `${propKey}f` as 'vf' | 'hf' | 'sf';
    const gKey = `${propKey}g` as 'vg' | 'hg' | 'sg';

    if (useTempTable) {
      const idx = 4 + pickIndex(rng, A4_TEMPS.length - 10);
      const tC = A4_TEMPS[idx];
      const sat = waterSatByT(tC);
      const yf = readSatProp(sat, fKey);
      const yg = readSatProp(sat, gKey);
      const propVal = roundTo(yf + q * (yg - yf), PROP_SPECS[gKey].decimals);
      const spec = PROP_SPECS[propKey];

      return {
        mode: 'region',
        expectedRegion,
        promptFa: `آب در دمای ${tC} °C و ${spec.labelFa} ${spec.symbol} = ${propVal} ${spec.unit} قرار دارد. ناحیه فازی سیستم چیست؟`,
        tableSlice: {
          tableId: 'A-4',
          titleFa: 'برش جدول A-4 (آب اشباع بر حسب دما)',
          headers: ['T (°C)', 'P_sat (kPa)', `${spec.symbol}_f`, `${spec.symbol}_g`],
          rows: [
            {
              cells: [tC, readSatProp(sat, 'pSat'), yf, yg],
              highlight: true,
            },
          ],
        },
        givenInputs: {
          tC,
          propSymbol: spec.symbol,
          propValue: propVal,
          propUnit: spec.unit,
        },
      };
    }

    const idx = 2 + pickIndex(rng, A5_PRESSURES_KPA.length - 6);
    const pKpa = A5_PRESSURES_KPA[idx];
    const sat = waterSatByP(pKpa);
    const yf = readSatProp(sat, fKey);
    const yg = readSatProp(sat, gKey);
    const propVal = roundTo(yf + q * (yg - yf), PROP_SPECS[gKey].decimals);
    const spec = PROP_SPECS[propKey];

    return {
      mode: 'region',
      expectedRegion,
      promptFa: `آب در فشار ${pKpa} kPa و ${spec.labelFa} ${spec.symbol} = ${propVal} ${spec.unit} قرار دارد. ناحیه فازی سیستم چیست؟`,
      tableSlice: {
        tableId: 'A-5',
        titleFa: 'برش جدول A-5 (آب اشباع بر حسب فشار)',
        headers: ['P (kPa)', 'T_sat (°C)', `${spec.symbol}_f`, `${spec.symbol}_g`],
        rows: [
          {
            cells: [pKpa, readSatProp(sat, 'tSat'), yf, yg],
            highlight: true,
          },
        ],
      },
      givenInputs: {
        pKpa,
        propSymbol: spec.symbol,
        propValue: propVal,
        propUnit: spec.unit,
      },
    };
  }

  const usePTPath = rng() < 0.65;
  if (usePTPath) {
    const idx = 2 + pickIndex(rng, A5_PRESSURES_KPA.length - 6);
    const pKpa = A5_PRESSURES_KPA[idx];
    const sat = waterSatByP(pKpa);
    const tSatRounded = readSatProp(sat, 'tSat');
    const offset = 25 + Math.round(rng() * 75);
    const tC =
      expectedRegion === 'compressed'
        ? Math.max(10, Math.round(sat.tC - offset))
        : Math.round(sat.tC + offset);

    // Ensure strict separation from saturation curve
    const safeTC =
      expectedRegion === 'compressed' && tC >= sat.tC - 5
        ? Math.max(5, Math.floor(sat.tC - 10))
        : expectedRegion === 'superheated' && tC <= sat.tC + 5
          ? Math.ceil(sat.tC + 20)
          : tC;

    const pSatAtT = roundTo(waterPsatKpa(safeTC), 2);
    return {
      mode: 'region',
      expectedRegion,
      promptFa: `آب در فشار ${pKpa} kPa و دمای ${safeTC} °C قرار دارد. با توجه به دمای اشباع در جدول، وضعیت فازی را مشخص کنید.`,
      tableSlice: {
        tableId: 'A-5',
        titleFa: 'برش جدول A-5 (مقایسه T و T_sat در فشار معلوم)',
        headers: ['P (kPa)', 'T_sat (°C)', 'h_f (kJ/kg)', 'h_g (kJ/kg)'],
        rows: [
          {
            cells: [
              pKpa,
              tSatRounded,
              readSatProp(sat, 'hf'),
              readSatProp(sat, 'hg'),
            ],
            highlight: true,
          },
        ],
      },
      givenInputs: {
        pKpa,
        tC: safeTC,
        propSymbol: 'P_sat(T)',
        propValue: pSatAtT,
        propUnit: 'kPa',
      },
    };
  }

  // Property comparison path (h or s against y_f / y_g in A-4)
  const idx = 4 + pickIndex(rng, A4_TEMPS.length - 10);
  const tC = A4_TEMPS[idx];
  const sat = waterSatByT(tC);
  const propKey = rng() < 0.5 ? 'h' : 's';
  const fKey = `${propKey}f` as 'hf' | 'sf';
  const gKey = `${propKey}g` as 'hg' | 'sg';
  const yf = readSatProp(sat, fKey);
  const yg = readSatProp(sat, gKey);
  const spec = PROP_SPECS[propKey];
  const propVal =
    expectedRegion === 'compressed'
      ? roundTo(yf * (0.6 + 0.25 * rng()), spec.decimals)
      : roundTo(yg + (propKey === 'h' ? 120 + 200 * rng() : 0.35 + 0.55 * rng()), spec.decimals);

  return {
    mode: 'region',
    expectedRegion,
    promptFa: `آب در دمای ${tC} °C و ${spec.labelFa} ${spec.symbol} = ${propVal} ${spec.unit} قرار دارد. ناحیه فازی سیستم چیست؟`,
    tableSlice: {
      tableId: 'A-4',
      titleFa: 'برش جدول A-4 (مقایسه خاصیت با y_f و y_g)',
      headers: ['T (°C)', 'P_sat (kPa)', `${spec.symbol}_f`, `${spec.symbol}_g`],
      rows: [
        {
          cells: [tC, readSatProp(sat, 'pSat'), yf, yg],
          highlight: true,
        },
      ],
    },
    givenInputs: {
      tC,
      propSymbol: spec.symbol,
      propValue: propVal,
      propUnit: spec.unit,
    },
  };
}

function buildLinear1DProblem(rng: () => number): TrainerProblem {
  const sourceKind = pickIndex(rng, 3); // 0: A-4, 1: A-5, 2: A-6
  const r = pickFraction(rng);

  if (sourceKind === 0) {
    const idx = pickIndex(rng, A4_TEMPS.length - 1);
    const x1 = A4_TEMPS[idx];
    const x2 = A4_TEMPS[idx + 1];
    const propKey = (['pSat', 'hf', 'hg', 'vg', 'sf', 'sg'] as const)[pickIndex(rng, 6)];
    const y1 = readSatProp(waterSatByT(x1), propKey);
    const y2 = readSatProp(waterSatByT(x2), propKey);
    const x = roundTo(x1 + r * (x2 - x1), 2);
    const exactR = (x - x1) / (x2 - x1);
    const expectedY = y1 + exactR * (y2 - y1);
    const spec = PROP_SPECS[propKey];

    return {
      mode: 'linear1d',
      x1,
      x,
      x2,
      y1,
      y2,
      r: exactR,
      expectedY,
      expectedVal: expectedY,
      propSymbol: spec.symbol,
      propUnit: spec.unit,
      inputSymbol: 'T',
      inputUnit: '°C',
      promptFa: `با استفاده از جدول A-4، مقدار ${spec.labelFa} (${spec.symbol}) را در دمای T = ${x} °C به روش درونیابی خطی محاسبه کنید.`,
      tableSlice: {
        tableId: 'A-4',
        titleFa: 'برش دو سطر مجاور از جدول A-4',
        headers: ['T (°C)', `${spec.symbol} (${spec.unit})`],
        rows: [
          { cells: [x1, y1] },
          { cells: [x, '?'], highlight: true },
          { cells: [x2, y2] },
        ],
      },
    };
  }

  if (sourceKind === 1) {
    const idx = pickIndex(rng, A5_PRESSURES_KPA.length - 1);
    const x1 = A5_PRESSURES_KPA[idx];
    const x2 = A5_PRESSURES_KPA[idx + 1];
    const propKey = (['tSat', 'hf', 'hg', 'sf', 'sg'] as const)[pickIndex(rng, 5)];
    const y1 = readSatProp(waterSatByP(x1), propKey);
    const y2 = readSatProp(waterSatByP(x2), propKey);
    const x = roundTo(x1 + r * (x2 - x1), 2);
    const exactR = (x - x1) / (x2 - x1);
    const expectedY = y1 + exactR * (y2 - y1);
    const spec = PROP_SPECS[propKey];

    return {
      mode: 'linear1d',
      x1,
      x,
      x2,
      y1,
      y2,
      r: exactR,
      expectedY,
      expectedVal: expectedY,
      propSymbol: spec.symbol,
      propUnit: spec.unit,
      inputSymbol: 'P',
      inputUnit: 'kPa',
      promptFa: `با استفاده از جدول A-5، مقدار ${spec.labelFa} (${spec.symbol}) را در فشار P = ${x} kPa به روش درونیابی خطی محاسبه کنید.`,
      tableSlice: {
        tableId: 'A-5',
        titleFa: 'برش دو سطر مجاور از جدول A-5',
        headers: ['P (kPa)', `${spec.symbol} (${spec.unit})`],
        rows: [
          { cells: [x1, y1] },
          { cells: [x, '?'], highlight: true },
          { cells: [x2, y2] },
        ],
      },
    };
  }

  // A-6 fixed-pressure superheated vapor interpolation on T
  const pKpa = A6_PRESSURES_KPA[pickIndex(rng, A6_PRESSURES_KPA.length)];
  const tSat = waterTsatC(pKpa);
  const validTIndices: number[] = [];
  for (let i = 0; i < A6_TEMPS.length - 1; i++) {
    if (A6_TEMPS[i] > tSat + 15) {
      validTIndices.push(i);
    }
  }
  const tIdx = validTIndices[pickIndex(rng, validTIndices.length)];
  const x1 = A6_TEMPS[tIdx];
  const x2 = A6_TEMPS[tIdx + 1];
  const propKey = (['v', 'h', 's'] as const)[pickIndex(rng, 3)];
  const y1 = readSuperProp(pKpa, x1, propKey);
  const y2 = readSuperProp(pKpa, x2, propKey);
  const x = roundTo(x1 + r * (x2 - x1), 2);
  const exactR = (x - x1) / (x2 - x1);
  const expectedY = y1 + exactR * (y2 - y1);
  const spec = PROP_SPECS[propKey];

  return {
    mode: 'linear1d',
    x1,
    x,
    x2,
    y1,
    y2,
    r: exactR,
    expectedY,
    expectedVal: expectedY,
    propSymbol: spec.symbol,
    propUnit: spec.unit,
    inputSymbol: 'T',
    inputUnit: '°C',
    promptFa: `در جدول A-6 و فشار ثابت P = ${(pKpa / 1000).toFixed(2)} MPa (${pKpa} kPa)، مقدار ${spec.labelFa} (${spec.symbol}) را در دمای T = ${x} °C بیابید.`,
    tableSlice: {
      tableId: 'A-6',
      titleFa: `برش جدول A-6 در فشار ${(pKpa / 1000).toFixed(2)} MPa`,
      headers: ['T (°C)', `${spec.symbol} (${spec.unit})`],
      rows: [
        { cells: [x1, y1] },
        { cells: [x, '?'], highlight: true },
        { cells: [x2, y2] },
      ],
    },
  };
}

function buildInverseProblem(rng: () => number): TrainerProblem {
  // Ruling 4: strictly monotonic intervals:
  // (A) v_f, h_f, s_f in A-4 between 10 °C and 350 °C (with |y2 - y1| > 1e-4)
  // OR (B) fixed-pressure superheated A-6 h / s vs T
  const useA4 = rng() < 0.55;
  const targetR = pickFraction(rng);

  if (useA4) {
    const candidates: Array<{
      x1: number;
      x2: number;
      y1: number;
      y2: number;
      propKey: 'vf' | 'hf' | 'sf';
    }> = [];

    const propChoices: readonly ('vf' | 'hf' | 'sf')[] = ['hf', 'sf', 'vf'];
    const pickedProp = propChoices[pickIndex(rng, propChoices.length)];

    const collectForProp = (propKey: 'vf' | 'hf' | 'sf') => {
      for (let i = 0; i < A4_TEMPS.length - 1; i++) {
        const t1 = A4_TEMPS[i];
        const t2 = A4_TEMPS[i + 1];
        if (t1 < 10 || t2 > 350) continue;
        const y1 = readSatProp(waterSatByT(t1), propKey);
        const y2 = readSatProp(waterSatByT(t2), propKey);
        if (Math.abs(y2 - y1) > 1e-4) {
          candidates.push({ x1: t1, x2: t2, y1, y2, propKey });
        }
      }
    };

    collectForProp(pickedProp);
    if (candidates.length === 0) {
      collectForProp('hf');
    }

    const chosen = candidates[pickIndex(rng, candidates.length)];
    const spec = PROP_SPECS[chosen.propKey];
    const xRaw = chosen.y1 + targetR * (chosen.y2 - chosen.y1);
    const x = roundTo(xRaw, spec.decimals);
    const safeX =
      x > Math.min(chosen.y1, chosen.y2) && x < Math.max(chosen.y1, chosen.y2)
        ? x
        : roundTo(xRaw, spec.decimals + 1);
    const r = (safeX - chosen.y1) / (chosen.y2 - chosen.y1);
    const expectedVal = chosen.x1 + r * (chosen.x2 - chosen.x1);

    return {
      mode: 'inverse',
      x1: chosen.x1,
      x2: chosen.x2,
      y1: chosen.y1,
      y2: chosen.y2,
      x: safeX,
      r,
      expectedY: expectedVal,
      expectedVal,
      propSymbol: 'T',
      propUnit: '°C',
      inputSymbol: spec.symbol,
      inputUnit: spec.unit,
      promptFa: `در جدول A-4 (مایع اشباع)، اگر ${spec.labelFa} برابر ${spec.symbol} = ${safeX} ${spec.unit} باشد، دمای متناظر T (°C) را با درونیابی معکوس بیابید.`,
      tableSlice: {
        tableId: 'A-4',
        titleFa: 'برش یکنوای جدول A-4 (درونیابی معکوس)',
        headers: ['T (°C)', `${spec.symbol} (${spec.unit})`],
        rows: [
          { cells: [chosen.x1, chosen.y1] },
          { cells: ['?', safeX], highlight: true },
          { cells: [chosen.x2, chosen.y2] },
        ],
      },
    };
  }

  // Fixed-pressure A-6 superheated vapor: h or s vs T (strictly increasing with T)
  const pKpa = A6_PRESSURES_KPA[pickIndex(rng, A6_PRESSURES_KPA.length)];
  const tSat = waterTsatC(pKpa);
  const validTIndices: number[] = [];
  for (let i = 0; i < A6_TEMPS.length - 1; i++) {
    if (A6_TEMPS[i] > tSat + 15) {
      validTIndices.push(i);
    }
  }
  const tIdx = validTIndices[pickIndex(rng, validTIndices.length)];
  const x1 = A6_TEMPS[tIdx];
  const x2 = A6_TEMPS[tIdx + 1];
  const propKey = rng() < 0.5 ? 'h' : 's';
  const spec = PROP_SPECS[propKey];
  const y1 = readSuperProp(pKpa, x1, propKey);
  const y2 = readSuperProp(pKpa, x2, propKey);
  const xRaw = y1 + targetR * (y2 - y1);
  const x = roundTo(xRaw, spec.decimals);
  const safeX =
    x > Math.min(y1, y2) && x < Math.max(y1, y2)
      ? x
      : roundTo(xRaw, spec.decimals + 1);
  const r = (safeX - y1) / (y2 - y1);
  const expectedVal = x1 + r * (x2 - x1);

  return {
    mode: 'inverse',
    x1,
    x2,
    y1,
    y2,
    x: safeX,
    r,
    expectedY: expectedVal,
    expectedVal,
    propSymbol: 'T',
    propUnit: '°C',
    inputSymbol: spec.symbol,
    inputUnit: spec.unit,
    promptFa: `در جدول A-6 و فشار ثابت P = ${(pKpa / 1000).toFixed(2)} MPa (${pKpa} kPa)، اگر ${spec.labelFa} برابر ${spec.symbol} = ${safeX} ${spec.unit} باشد، دمای بخار T (°C) چقدر است؟`,
    tableSlice: {
      tableId: 'A-6',
      titleFa: `برش یکنوای جدول A-6 در فشار ${(pKpa / 1000).toFixed(2)} MPa`,
      headers: ['T (°C)', `${spec.symbol} (${spec.unit})`],
      rows: [
        { cells: [x1, y1] },
        { cells: ['?', safeX], highlight: true },
        { cells: [x2, y2] },
      ],
    },
  };
}

function buildDouble2DProblem(rng: () => number): TrainerProblem {
  const pIdx = pickIndex(rng, A6_PRESSURES_KPA.length - 1);
  const p1 = A6_PRESSURES_KPA[pIdx];
  const p2 = A6_PRESSURES_KPA[pIdx + 1];
  const tSatP2 = waterTsatC(p2);

  const validTIndices: number[] = [];
  for (let i = 0; i < A6_TEMPS.length - 1; i++) {
    if (A6_TEMPS[i] > tSatP2 + 15) {
      validTIndices.push(i);
    }
  }
  const tIdx = validTIndices[pickIndex(rng, validTIndices.length)];
  const t1 = A6_TEMPS[tIdx];
  const t2 = A6_TEMPS[tIdx + 1];

  const rT = pickFraction(rng);
  const rP = pickFraction(rng);
  const t = roundTo(t1 + rT * (t2 - t1), 2);
  const p = roundTo(p1 + rP * (p2 - p1), 2);
  const exactRT = (t - t1) / (t2 - t1);
  const exactRP = (p - p1) / (p2 - p1);

  const propKey = (['v', 'h', 's'] as const)[pickIndex(rng, 3)];
  const spec = PROP_SPECS[propKey];

  const q11 = readSuperProp(p1, t1, propKey);
  const q12 = readSuperProp(p1, t2, propKey);
  const q21 = readSuperProp(p2, t1, propKey);
  const q22 = readSuperProp(p2, t2, propKey);
  const corners: [[number, number], [number, number]] = [
    [q11, q12],
    [q21, q22],
  ];

  const expectedVal = bilinear(corners, exactRT, exactRP);

  return {
    mode: 'double2d',
    p1,
    p,
    p2,
    t1,
    t,
    t2,
    rT: exactRT,
    rP: exactRP,
    corners,
    expectedY: expectedVal,
    expectedVal,
    propSymbol: spec.symbol,
    propUnit: spec.unit,
    promptFa: `با درونیابی دوبعدی روی جدول بخار فوق‌گرم A-6، مقدار ${spec.labelFa} (${spec.symbol}) را در فشار P = ${p} kPa (${(p / 1000).toFixed(3)} MPa) و دمای T = ${t} °C بیابید.`,
    tableSlice: {
      tableId: 'A-6',
      titleFa: `برش ۲×۲ جدول A-6 (${spec.symbol} بر حسب دما و فشار)`,
      headers: [
        'T \\ P',
        `P₁ = ${p1} kPa`,
        `P = ${p} kPa`,
        `P₂ = ${p2} kPa`,
      ],
      rows: [
        { cells: [`T₁ = ${t1} °C`, q11, '—', q21] },
        { cells: [`T = ${t} °C`, 'y_A', '?', 'y_B'], highlight: true },
        { cells: [`T₂ = ${t2} °C`, q12, '—', q22] },
      ],
    },
  };
}

/**
 * Generates an exam-authentic Cengel steam-table problem for one of the four modes.
 */
export function generateTrainerProblem(
  mode: TrainerMode,
  rng: () => number = Math.random
): TrainerProblem {
  switch (mode) {
    case 'region':
      return buildRegionProblem(rng);
    case 'linear1d':
      return buildLinear1DProblem(rng);
    case 'inverse':
      return buildInverseProblem(rng);
    case 'double2d':
      return buildDouble2DProblem(rng);
  }
}

function evaluateRegionSubmission(
  problem: TrainerProblem,
  submission: TrainerSubmission
): TrainerFeedback {
  const expectedRegion = problem.expectedRegion;
  if (!submission.phase) {
    return {
      correct: false,
      phaseOk: false,
      trapDetected: 'missing_input',
      messageFa: 'لطفاً یکی از سه ناحیه فازی را انتخاب کنید.',
      expectedRegion,
    };
  }

  if (submission.phase === expectedRegion) {
    return {
      correct: true,
      phaseOk: true,
      trapDetected: null,
      messageFa: `آفرین! ناحیه فازی به درستی «${PHASE_LABEL_FA[expectedRegion]}» تشخیص داده شد.`,
      expectedRegion,
    };
  }

  const invertedPT =
    (expectedRegion === 'compressed' && submission.phase === 'superheated') ||
    (expectedRegion === 'superheated' && submission.phase === 'compressed');

  return {
    correct: false,
    phaseOk: false,
    trapDetected: invertedPT ? 'inverted_p_sat_rule' : 'phase_mismatch',
    messageFa: invertedPT
      ? 'دقت کنید: اگر T < T_sat (یا P > P_sat) باشد مایع متراکم و اگر T > T_sat (یا P < P_sat) باشد بخار فوق‌گرم است.'
      : `ناحیه صحیح «${PHASE_LABEL_FA[expectedRegion!]}» است؛ کران‌های اشباع جدول را دوباره مقایسه کنید.`,
    expectedRegion,
  };
}

function evaluate1DOrInverseSubmission(
  problem: TrainerProblem,
  submission: TrainerSubmission
): TrainerFeedback {
  const hasR = submission.r !== undefined;
  const hasValue = submission.value !== undefined;
  if (!hasR && !hasValue) {
    return {
      correct: false,
      trapDetected: 'missing_input',
      messageFa: 'لطفاً حداقل نسبت r یا مقدار نهایی درونیابی را وارد کنید.',
      expectedR: problem.r,
      expectedVal: problem.expectedVal,
    };
  }

  if (
    (hasR && !Number.isFinite(submission.r!)) ||
    (hasValue && !Number.isFinite(submission.value!))
  ) {
    return {
      correct: false,
      trapDetected: 'invalid_input',
      messageFa: 'ورودی عددی نامعتبر است.',
      expectedR: problem.r,
      expectedVal: problem.expectedVal,
    };
  }

  const expectedR = problem.r!;
  const expectedVal = problem.expectedVal!;

  if (hasR) {
    const rVal = submission.r!;
    const rOk = Math.abs(rVal - expectedR) <= 0.015;
    if (!rOk) {
      if (Math.abs(rVal - (1 - expectedR)) <= 0.02) {
        return {
          correct: false,
          rOk: false,
          trapDetected: 'swapped_r',
          messageFa:
            'تلهٔ رایج امتحانی (برعکس کردن r): به جای r مقدار (1 - r) را وارد کرده‌اید. همیشه فاصله تا سطر پایین‌تر را تقسیم بر طول بازه کنید.',
          expectedR,
          expectedVal,
        };
      }
      if (rVal < 0 || rVal > 1) {
        return {
          correct: false,
          rOk: false,
          trapDetected: 'out_of_range_r',
          messageFa: 'نسبت درونیابی r در میانهٔ دو سطر باید بین ۰ و ۱ باشد.',
          expectedR,
          expectedVal,
        };
      }
      return {
        correct: false,
        rOk: false,
        trapDetected: 'wrong_r',
        messageFa: 'نسبت r خارج از خطای مجاز (±0.015) است؛ صورت و مخرج کسر را بررسی کنید.',
        expectedR,
        expectedVal,
      };
    }
  }

  if (hasValue) {
    const val = submission.value!;
    const valueOk = isValueWithinTolerance(val, expectedVal);
    if (!valueOk) {
      const swappedVal =
        problem.mode === 'linear1d'
          ? problem.y1! + (1 - expectedR) * (problem.y2! - problem.y1!)
          : problem.x1! + (1 - expectedR) * (problem.x2! - problem.x1!);

      if (isValueWithinTolerance(val, swappedVal)) {
        return {
          correct: false,
          ...(hasR ? { rOk: true } : {}),
          valueOk: false,
          trapDetected: 'swapped_r',
          messageFa:
            'تلهٔ رایج امتحانی: پاسخ نهایی با (1 - r) محاسبه شده و به سرِ اشتباه بازه نزدیک‌تر است!',
          expectedR,
          expectedVal,
        };
      }

      const [minB, maxB] =
        problem.mode === 'linear1d'
          ? [Math.min(problem.y1!, problem.y2!), Math.max(problem.y1!, problem.y2!)]
          : [Math.min(problem.x1!, problem.x2!), Math.max(problem.x1!, problem.x2!)];

      if (val < minB || val > maxB) {
        return {
          correct: false,
          ...(hasR ? { rOk: true } : {}),
          valueOk: false,
          trapDetected: 'out_of_bracket',
          messageFa:
            'عدد نهایی خارج از بازهٔ دو سطر مجاور است؛ کنترل منطقی سریع نشان می‌دهد جواب حتماً باید بین دو کران جدول باشد.',
          expectedR,
          expectedVal,
        };
      }

      return {
        correct: false,
        ...(hasR ? { rOk: true } : {}),
        valueOk: false,
        trapDetected: 'calculation_error',
        messageFa: 'مقدار نهایی با دقت ماشین‌حساب هم‌خوانی ندارد؛ عملیات y₁ + r(y₂ - y₁) را مرور کنید.',
        expectedR,
        expectedVal,
      };
    }
  }

  return {
    correct: true,
    ...(hasR ? { rOk: true } : {}),
    ...(hasValue ? { valueOk: true } : {}),
    trapDetected: null,
    messageFa: 'عالی! نسبت درونیابی و مقدار نهایی کاملاً دقیق است.',
    expectedR,
    expectedVal,
  };
}

function evaluateDouble2DSubmission(
  problem: TrainerProblem,
  submission: TrainerSubmission
): TrainerFeedback {
  const hasR = submission.r !== undefined;
  const hasValue = submission.value !== undefined;
  if (!hasR && !hasValue) {
    return {
      correct: false,
      trapDetected: 'missing_input',
      messageFa: 'لطفاً مقدار نهایی درونیابی دوبعدی را وارد کنید.',
      expectedVal: problem.expectedVal,
    };
  }

  if (
    (hasR && !Number.isFinite(submission.r!)) ||
    (hasValue && !Number.isFinite(submission.value!))
  ) {
    return {
      correct: false,
      trapDetected: 'invalid_input',
      messageFa: 'ورودی عددی نامعتبر است.',
      expectedVal: problem.expectedVal,
    };
  }

  const rT = problem.rT!;
  const rP = problem.rP!;
  const corners = problem.corners!;
  const expectedVal = problem.expectedVal!;

  if (hasR) {
    const rVal = submission.r!;
    const matchesT = Math.abs(rVal - rT) <= 0.015;
    const matchesP = Math.abs(rVal - rP) <= 0.015;
    if (!matchesT && !matchesP) {
      if (Math.abs(rVal - (1 - rT)) <= 0.02 || Math.abs(rVal - (1 - rP)) <= 0.02) {
        return {
          correct: false,
          rOk: false,
          trapDetected: 'swapped_r',
          messageFa: 'در یکی از مراحل دما یا فشار، نسبت (1 - r) به جای r استفاده شده است.',
          expectedVal,
        };
      }
      return {
        correct: false,
        rOk: false,
        trapDetected: 'wrong_r',
        messageFa: 'نسبت درونیابی با r_T یا r_P هم‌خوانی ندارد.',
        expectedVal,
      };
    }
  }

  if (hasValue) {
    const val = submission.value!;
    if (!isValueWithinTolerance(val, expectedVal)) {
      const swapT = bilinear(corners, 1 - rT, rP);
      const swapP = bilinear(corners, rT, 1 - rP);
      const swapBoth = bilinear(corners, 1 - rT, 1 - rP);

      if (
        isValueWithinTolerance(val, swapT) ||
        isValueWithinTolerance(val, swapP) ||
        isValueWithinTolerance(val, swapBoth)
      ) {
        return {
          correct: false,
          valueOk: false,
          trapDetected: 'swapped_r',
          messageFa:
            'تلهٔ امتحانی درونیابی دوبعدی: در مرحلهٔ دما یا فشار، نسبت به اشتباه به شکل (1 - r) جای‌گذاری شده است.',
          expectedVal,
        };
      }

      const flatCorners = [corners[0][0], corners[0][1], corners[1][0], corners[1][1]];
      const minC = Math.min(...flatCorners);
      const maxC = Math.max(...flatCorners);
      if (val < minC || val > maxC) {
        return {
          correct: false,
          valueOk: false,
          trapDetected: 'out_of_bracket',
          messageFa: 'جواب نهایی از محدودهٔ چهار گوشهٔ جدول A-6 خارج شده است.',
          expectedVal,
        };
      }

      return {
        correct: false,
        valueOk: false,
        trapDetected: 'calculation_error',
        messageFa: 'عدد نهایی خارج از بازهٔ خطای مجاز است؛ مراحل y_A و y_B و درونیابی سوم را چک کنید.',
        expectedVal,
      };
    }
  }

  return {
    correct: true,
    ...(hasR ? { rOk: true } : {}),
    ...(hasValue ? { valueOk: true } : {}),
    trapDetected: null,
    messageFa: 'عالی! درونیابی دوبعدی جدول A-6 با دقت کامل انجام شد.',
    expectedVal,
  };
}

/**
 * Evaluates a learner's submission against tolerances (±0.6% or ±2e-5 when |expected| < 0.01,
 * ±0.015 on r) and detects classic paper-exam interpolation traps such as swapped (1 - r).
 */
export function evaluateTrainerSubmission(
  problem: TrainerProblem,
  submission: TrainerSubmission
): TrainerFeedback {
  if (problem.mode === 'region') {
    return evaluateRegionSubmission(problem, submission);
  }
  if (problem.mode === 'double2d') {
    return evaluateDouble2DSubmission(problem, submission);
  }
  return evaluate1DOrInverseSubmission(problem, submission);
}
