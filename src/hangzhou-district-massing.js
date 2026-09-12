// Display hierarchy around existing, source-verified urban anchors. These are
// influence fields, not legal district boundaries or surveyed building heights.
const cores = [
  {id:'qianjiang',point:[120.209,30.247],radius:3600,strength:1},
  {id:'century-city',point:[120.23256,30.22974],radius:3100,strength:.94},
  {id:'wulin',point:[120.158,30.277],radius:2300,strength:.74},
  {id:'future-science',point:[120.008,30.283],radius:3300,strength:.72},
  {id:'binjiang',point:[120.185,30.204],radius:2500,strength:.65},
];
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
// Presentation palettes, not surveyed facade colours. A source-connected block
// chooses one palette; the kit retains its own windows, roofs and metal frames.
export const BUILDING_PALETTES = Object.freeze({
  porcelain:{wallColour:'#e3e4e1',glassColour:'#c6cbcd'},
  pearl:{wallColour:'#cdd1d1',glassColour:'#b6c0c5'},
  mineral:{wallColour:'#aeb8bd',glassColour:'#aab9c2'},
  silver:{wallColour:'#d1d8dc',glassColour:'#ccd4d8'},
  bluegrey:{wallColour:'#b7c4cd',glassColour:'#97acba'},
});
export function buildingPalette(sourceClass,blockSeed){
  const choices=sourceClass==='commercial'?['silver','bluegrey']
    :sourceClass==='industrial'?['pearl','mineral']
    :['college','school','university','hospital'].includes(sourceClass)?['porcelain','pearl']
    :sourceClass==='residential'?['porcelain','pearl','mineral']
    :['porcelain','pearl','mineral','silver'];
  return choices[Math.min(choices.length-1,Math.floor(clamp(blockSeed,0,1)*choices.length))];
}
export function districtMassing(coordinate,sourceClass,blockSeed,variation,rhythmOrigin=coordinate){
  const d=(p)=>Math.hypot((coordinate[0]-p[0])*96360,(coordinate[1]-p[1])*111320);
  const weights=cores.map(c=>({...c,weight:Math.exp(-Math.pow(d(c.point)/(c.radius*1.5),2)*1.8)*c.strength}));
  const strongest=weights.reduce((a,b)=>a.weight>b.weight?a:b);
  const lakeDistance=d([120.143,30.247]);
  const airportDistance=d([120.4291244,30.236]);
  const industrial=sourceClass==='industrial',institutional=['college','school','university','hospital'].includes(sourceClass);
  const fabric=clamp(strongest.weight,0,1);
  let level=industrial?'low':institutional?'low':fabric>.42?'high':fabric>.055?'medium':'low';
  if(sourceClass==='retail'||lakeDistance<1800||airportDistance<5000)level='low';
  // Whole source blocks share a band; variation within a band stays restrained.
  const ranges={low:industrial?[.8,1.1]:[.28,.40],medium:[.48,.70],high:[.72,1.05]};
  const [lo,hi]=ranges[level],heightMultiplier=lo+(hi-lo)*(blockSeed*.75+variation*.25);
  const palettes={low:['#ffffff','#f2f4f5','#e9edef','#f7f8f9','#eef0f1'],medium:['#f4f6f7','#eceff1','#e5ebef','#f1f4f6','#ffffff'],high:['#e5ebef','#f1f4f6','#ffffff','#eaf0f3','#dce5ea']};
  const colours=palettes[level],tint=colours[Math.min(colours.length-1,Math.floor(blockSeed*colours.length))];
  // v0.0.2 is a bounded change relative to the preserved v0.0.1 silhouette.
  // Source-connected parcels share an origin: the field changes continuously
  // between neighbourhoods instead of assigning an independent random height.
  // This field expresses display rhythm, never a planning or survey boundary.
  const x=(rhythmOrigin[0]-120.16)*96360,z=(rhythmOrigin[1]-30.27)*111320;
  const wave=.62*Math.sin(x/1100+.45)*Math.cos(z/1500-.35)+.38*Math.sin((x*.55-z)/2300+1.1);
  const local=(variation-.5)*2;
  let rhythmFactor=1,role='low-wide';
  if(industrial){
    // Production buildings retain their broad, low silhouette.
    rhythmFactor=1;
  }else if(institutional||sourceClass==='retail'){
    rhythmFactor=1+.055*wave;role='low-neighbourhood';
  }else if(sourceClass==='commercial'){
    const accent=fabric>.14&&variation>.72;
    rhythmFactor=accent?1.12+.06*(wave+1)/2:.945+.015*wave;
    role=accent?'commercial-accent':'commercial-streetwall';
  }else{
    rhythmFactor=1+(sourceClass==='residential'?.16:.13)*wave+.018*local;
    role=wave>.3?'upper-terrace':wave<-.3?'lower-terrace':'transition';
  }
  const baselineMultiplier=Math.min(1,heightMultiplier);
  const displayMultiplier=Math.min(1,baselineMultiplier*rhythmFactor);
  return {level,heightMultiplier:displayMultiplier,tint,zone:strongest.weight>.1?strongest.id:'outer-neighbourhood',
    rhythm:{version:'0.0.2',role,origin:rhythmOrigin,baselineMultiplier,factor:displayMultiplier/baselineMultiplier},
    policy:'Bounded display-height rhythm relative to 0.0.1 at unchanged source parcels; no claim of measured heights.'};
}
