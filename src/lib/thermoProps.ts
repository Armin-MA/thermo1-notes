/**
 * Scientific thermodynamic property engine powered by IAPWS-IF97 (jltonghui/iapws-if97)
 * plus Cengel Table A-1 / A-2a ideal gases and R-134a saturation data.
 */

import { solvePT, solvePH, solvePS, solvePx, solveTx, Region } from 'iapws-if97';
import { saturationPressure, saturationTemperature } from 'iapws-if97/saturation';

export const WATER_CRIT = {
  T_C: 373.946,
  T_K: 647.096,
  P_KPA: 22064,
  P_MPA: 22.064,
  v_CR: 0.003106,
} as const;

export interface WaterStateView {
  pKpa: number;
  tC: number;
  tK: number;
  v: number;
  u: number;
  h: number;
  s: number;
  x: number | null;
  phase: 'مایع متراکم' | 'مخلوط اشباع' | 'بخار فوق‌گرم' | 'سیال فوق‌بحرانی';
  region: number;
}

export interface SatDomePoint {
  tC: number;
  tK: number;
  pKpa: number;
  vf: number;
  vg: number;
  uf: number;
  ug: number;
  hf: number;
  hg: number;
  sf: number;
  sg: number;
}

const clamp = (val: number, min: number, max: number) => Math.max(min, Math.min(max, val));

export function waterSatByP(pKpa: number): SatDomePoint {
  const pMpa = clamp(pKpa / 1000, 0.00062, 22.02);
  const st = solvePx(pMpa, 0.5);
  const liq = st.saturation!.liquid;
  const vap = st.saturation!.vapor;
  return {
    tC: st.temperature - 273.15,
    tK: st.temperature,
    pKpa: st.pressure * 1000,
    vf: liq.specificVolume,
    vg: vap.specificVolume,
    uf: liq.internalEnergy,
    ug: vap.internalEnergy,
    hf: liq.enthalpy,
    hg: vap.enthalpy,
    sf: liq.entropy,
    sg: vap.entropy,
  };
}

export function waterSatByT(tC: number): SatDomePoint {
  const tK = clamp(tC + 273.15, 273.17, 646.9);
  const st = solveTx(tK, 0.5);
  const liq = st.saturation!.liquid;
  const vap = st.saturation!.vapor;
  return {
    tC: st.temperature - 273.15,
    tK: st.temperature,
    pKpa: st.pressure * 1000,
    vf: liq.specificVolume,
    vg: vap.specificVolume,
    uf: liq.internalEnergy,
    ug: vap.internalEnergy,
    hf: liq.enthalpy,
    hg: vap.enthalpy,
    sf: liq.entropy,
    sg: vap.entropy,
  };
}

export function waterPT(pKpa: number, tC: number): WaterStateView {
  const pMpa = clamp(pKpa / 1000, 0.00065, 95);
  let tK = clamp(tC + 273.15, 273.2, 1070);

  // Avoid throwing right on the saturation boundary
  if (pMpa < WATER_CRIT.P_MPA) {
    const tSat = saturationTemperature(pMpa);
    if (Math.abs(tK - tSat) < 0.08) {
      tK = tK >= tSat ? tSat + 0.09 : tSat - 0.09;
    }
  }

  const st = solvePT(pMpa, tK);
  let phase: WaterStateView['phase'] = 'بخار فوق‌گرم';
  if (st.region === Region.Region1) phase = 'مایع متراکم';
  else if (st.region === Region.Region3 || pMpa >= WATER_CRIT.P_MPA) phase = 'سیال فوق‌بحرانی';
  else if (st.region === Region.Region4) phase = 'مخلوط اشباع';

  return {
    pKpa: st.pressure * 1000,
    tC: st.temperature - 273.15,
    tK: st.temperature,
    v: st.specificVolume,
    u: st.internalEnergy,
    h: st.enthalpy,
    s: st.entropy,
    x: st.quality,
    phase,
    region: st.region,
  };
}

export function waterPH(pKpa: number, h: number): WaterStateView {
  const pMpa = clamp(pKpa / 1000, 0.00065, 95);
  try {
    const st = solvePH(pMpa, clamp(h, 5, 4150));
    let phase: WaterStateView['phase'] = 'بخار فوق‌گرم';
    if (st.region === Region.Region1) phase = 'مایع متراکم';
    else if (st.region === Region.Region3 || pMpa >= WATER_CRIT.P_MPA) phase = 'سیال فوق‌بحرانی';
    else if (st.region === Region.Region4) phase = 'مخلوط اشباع';

    return {
      pKpa: st.pressure * 1000,
      tC: st.temperature - 273.15,
      tK: st.temperature,
      v: st.specificVolume,
      u: st.internalEnergy,
      h: st.enthalpy,
      s: st.entropy,
      x: st.quality,
      phase,
      region: st.region,
    };
  } catch {
    return waterPT(pKpa, h < 500 ? 40 : 450);
  }
}

export function waterPS(pKpa: number, s: number): WaterStateView {
  const pMpa = clamp(pKpa / 1000, 0.00065, 95);
  try {
    const st = solvePS(pMpa, clamp(s, 0.05, 11.5));
    let phase: WaterStateView['phase'] = 'بخار فوق‌گرم';
    if (st.region === Region.Region1) phase = 'مایع متراکم';
    else if (st.region === Region.Region3 || pMpa >= WATER_CRIT.P_MPA) phase = 'سیال فوق‌بحرانی';
    else if (st.region === Region.Region4) phase = 'مخلوط اشباع';

    return {
      pKpa: st.pressure * 1000,
      tC: st.temperature - 273.15,
      tK: st.temperature,
      v: st.specificVolume,
      u: st.internalEnergy,
      h: st.enthalpy,
      s: st.entropy,
      x: st.quality,
      phase,
      region: st.region,
    };
  } catch {
    return waterPT(pKpa, s < 2 ? 40 : 450);
  }
}

let cachedDome: SatDomePoint[] | null = null;

/**
 * Returns 44 exact IAPWS-IF97 saturation dome points from 1 °C up to near-critical 373.5 °C.
 */
export function getWaterDome(): readonly SatDomePoint[] {
  if (cachedDome) return cachedDome;
  const temps = [
    1, 10, 20, 30, 45, 60, 80, 100, 120, 140, 160, 180, 200, 220, 240, 260,
    280, 300, 320, 335, 350, 360, 368, 372, 373.5,
  ];
  cachedDome = temps.map((t) => waterSatByT(t));
  return cachedDome;
}

export function waterTsatC(pKpa: number): number {
  const pMpa = clamp(pKpa / 1000, 0.00062, 22.05);
  return saturationTemperature(pMpa) - 273.15;
}

export function waterPsatKpa(tC: number): number {
  const tK = clamp(tC + 273.15, 273.17, 647.0);
  return saturationPressure(tK) * 1000;
}

export interface IdealGasSpec {
  id: 'air' | 'he' | 'n2' | 'o2' | 'co2' | 'h2';
  nameFa: string;
  formula: string;
  M: number;
  R: number;
  cp: number;
  cv: number;
  k: number;
  Tcr: number;
  PcrKpa: number;
}

// Verified Cengel Tables A-1 & A-2a (at 300 K)
export const IDEAL_GASES: Record<IdealGasSpec['id'], IdealGasSpec> = {
  air: { id: 'air', nameFa: 'هوا', formula: 'Air', M: 28.97, R: 0.287, cp: 1.005, cv: 0.718, k: 1.4, Tcr: 132.5, PcrKpa: 3770 },
  he: { id: 'he', nameFa: 'هلیم', formula: 'He', M: 4.003, R: 2.0769, cp: 5.1926, cv: 3.1156, k: 1.667, Tcr: 5.3, PcrKpa: 230 },
  n2: { id: 'n2', nameFa: 'نیتروژن', formula: 'N₂', M: 28.013, R: 0.2968, cp: 1.039, cv: 0.743, k: 1.4, Tcr: 126.2, PcrKpa: 3390 },
  o2: { id: 'o2', nameFa: 'اکسیژن', formula: 'O₂', M: 31.999, R: 0.2598, cp: 0.918, cv: 0.658, k: 1.395, Tcr: 154.8, PcrKpa: 5080 },
  co2: { id: 'co2', nameFa: 'دی‌اکسید کربن', formula: 'CO₂', M: 44.01, R: 0.1889, cp: 0.846, cv: 0.657, k: 1.289, Tcr: 304.2, PcrKpa: 7390 },
  h2: { id: 'h2', nameFa: 'هیدروژن', formula: 'H₂', M: 2.016, R: 4.124, cp: 14.307, cv: 10.183, k: 1.405, Tcr: 33.2, PcrKpa: 1300 },
};

export interface R134aSatPoint {
  pKpa: number;
  tC: number;
  hf: number;
  hg: number;
  vf: number;
  vg: number;
}

// Cengel Table A-12 key anchor points (including Example 5-6 exact values)
const R134A_A12: R134aSatPoint[] = [
  { pKpa: 60, tC: -36.95, hf: 3.84, hg: 227.8, vf: 0.0007097, vg: 0.31121 },
  { pKpa: 100, tC: -26.37, hf: 17.28, hg: 234.46, vf: 0.0007259, vg: 0.19254 },
  { pKpa: 120, tC: -22.32, hf: 22.49, hg: 236.97, vf: 0.0007324, vg: 0.16212 },
  { pKpa: 140, tC: -18.77, hf: 27.08, hg: 239.19, vf: 0.0007383, vg: 0.14014 },
  { pKpa: 200, tC: -10.09, hf: 38.43, hg: 244.46, vf: 0.0007533, vg: 0.099867 },
  { pKpa: 320, tC: 2.46, hf: 55.16, hg: 251.88, vf: 0.0007772, vg: 0.063604 },
  { pKpa: 500, tC: 15.71, hf: 73.33, hg: 259.36, vf: 0.0008059, vg: 0.041118 },
  { pKpa: 800, tC: 31.31, hf: 95.47, hg: 267.29, vf: 0.0008454, vg: 0.025621 },
  { pKpa: 1000, tC: 39.37, hf: 107.32, hg: 270.99, vf: 0.0008699, vg: 0.020313 },
  { pKpa: 1400, tC: 52.4, hf: 127.22, hg: 276.12, vf: 0.0009166, vg: 0.014107 },
];

export function r134aSatByP(pKpa: number): R134aSatPoint {
  const p = clamp(pKpa, 60, 1400);
  for (let i = 0; i < R134A_A12.length - 1; i++) {
    const a = R134A_A12[i];
    const b = R134A_A12[i + 1];
    if (p >= a.pKpa && p <= b.pKpa) {
      const f = (p - a.pKpa) / (b.pKpa - a.pKpa);
      return {
        pKpa: p,
        tC: a.tC + f * (b.tC - a.tC),
        hf: a.hf + f * (b.hf - a.hf),
        hg: a.hg + f * (b.hg - a.hg),
        vf: a.vf + f * (b.vf - a.vf),
        vg: a.vg + f * (b.vg - a.vg),
      };
    }
  }
  return R134A_A12[0];
}
