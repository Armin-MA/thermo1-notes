/**
 * A4 printable page-fit planner for Phase 1 Night-Exam Formula & Review Sheets.
 */

export interface PrintFitPlan {
  rawPages: number;
  targetPages: number;
  zoom: number;
  dense: boolean;
}

const DEFAULT_PAGE_HEIGHT_PX = 1032;
const MIN_ZOOM = 0.78;
const SAFETY_MARGIN_FACTOR = 0.96;

/**
 * Computes target A4 page count, compact-density flag, and CSS zoom factor
 * so printed formula sheets avoid trailing orphan overflow onto an extra page.
 */
export function computePrintFitPlan(
  contentHeightPx: number,
  pageHeightPx: number = DEFAULT_PAGE_HEIGHT_PX
): PrintFitPlan {
  if (!Number.isFinite(contentHeightPx) || contentHeightPx <= 0) {
    return {
      rawPages: 0,
      targetPages: 1,
      zoom: 1,
      dense: false,
    };
  }

  const safePageHeight =
    Number.isFinite(pageHeightPx) && pageHeightPx > 0
      ? pageHeightPx
      : DEFAULT_PAGE_HEIGHT_PX;

  const rawPages = contentHeightPx / safePageHeight;
  let targetPages: number;
  if (rawPages <= 1.55) {
    targetPages = 1;
  } else if (rawPages <= 2.55) {
    targetPages = 2;
  } else {
    targetPages = Math.ceil(rawPages);
  }

  const dense = rawPages > targetPages;
  const zoom = dense
    ? Math.max(
        MIN_ZOOM,
        Math.min(1, (targetPages * safePageHeight * SAFETY_MARGIN_FACTOR) / contentHeightPx)
      )
    : 1;

  return {
    rawPages,
    targetPages,
    zoom,
    dense,
  };
}
