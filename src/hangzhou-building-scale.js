// The Civic single tower is the ordinary-building bulk reference.
// Broader bodies and taller varied profiles preserve the real geographic inputs.
export const hangzhouBuildingScale = Object.freeze({
  referenceId: 'civic-center-single-glass-tower',
  baselineVersion: '0.16',
  baselineCacheKey: 'a9614ec7732c7cf1591cf5b23fa0987a4e7e31d0cba51f65683b4b85e6f952dd',
  bodyWidth: 0.03783847669877166,
  bodyDepth: 0.03178432057153849,
  bodyHeight: 0.29772050344832757,
  mode: 'streetwall-and-skyline',
  maximumBodyHeightRatio: 1.25,
  plannedFootprintGrowth: 1.9,
  maximumSourceEdgeExtensionMeters: 80,
  maximumBodyVolumeFactor: 2.4,
  policy: 'Calibrate ordinary primary building bulk against the unchanged Civic single tower. Keep source anchors fixed; enlarge display footprints by at most 80 m within road/natural barriers and use taller varied profiles without reducing infill height. Preserve broad low industrial halls, roof/body support, real roads, water and natural exclusions.'
});
