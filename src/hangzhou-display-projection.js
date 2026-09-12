// Use the same base Web Mercator frame for the complete municipality.
// No regional lens, radial expansion, or landmark-driven ground deformation.
export function createHangzhouDisplayProjection(base){
  return {
    ...base,
    warp(x,z){return [x,z];},
    unwarp(x,z){return [x,z];},
    displayPolicy:{
      revision:'hangzhou-base-geography-v0.9.2',
      horizontalDeformation:false,
      center:[...base.center],centerScale:1,
      localizedLenses:[],minRadialDerivative:1,
      inverse:'identity; source-to-scene uses the unchanged regional Web Mercator projection',
      policy:'No additional cartographic deformation anywhere in the municipality. Landmark symbols fit the existing land; source geography does not fit symbols.',
    },
  };
}
