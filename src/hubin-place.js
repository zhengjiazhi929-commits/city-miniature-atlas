// WGS84 polygon centroid of OSM way 109882469 (A district), fetched 2026-09-10.
// This is a named representative anchor, not the centroid of all in77 districts.
export const hubinPlace = {
  id: 'hubin-yintai', name: '湖滨银泰', city: 'hangzhou', en: 'HUBIN IN77',
  type: 'shopping-street', category: 'shopping-street', overviewOnly: true,
  coordinates: [120.157724, 30.2556862],
  coordinateSource: 'https://www.openstreetmap.org/way/109882469',
  coordinateRole: 'WGS84 area centroid of the named A-district OSM building; representative project anchor, not a surveyed centre of the complete complex',
  subtitle: '西湖东岸的开放商业街区',
  description: '在西湖东岸寻找湖滨银泰，沿街店铺、庭院与步行空间串起湖滨商圈。',
  source: './docs/hubin-sources.md',
  modelRole: 'Simplified low-rise commercial-street symbol; floor count, dimensions and individual shop layout are not measured reconstruction',
  // Preserve the primary-source outline for independent location checks.
  sourceFootprintCoordinates: [[120.1576826,30.2551582],[120.1581369,30.25517],
    [120.1581064,30.2560493],[120.1580085,30.2560467],[120.1580059,30.2561217],
    [120.1572395,30.2561018],[120.1572443,30.2559623],[120.1571016,30.2559586],
    [120.1576826,30.2551582]],
};

