import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {validateCityStarterConfig} from '../src/city-starter-config.js';
import {REGION_BOUNDARY_LIMITS} from '../src/region-boundaries.js';

const root=fileURLToPath(new URL('../',import.meta.url));
export async function createCity(args,{outputRoot=root}={}){
  const values={};
  const allowed=new Set(['id','name','name-en','lon','lat','boundary','source','license','attribution']);
  for(let i=0;i<args.length;i+=2){
    const key=args[i].slice(2);
    if(!args[i].startsWith('--')||!allowed.has(key)||values[key]!==undefined||args[i+1]===undefined)throw new Error(`Unknown, duplicate or missing argument: ${args[i]}`);
    values[key]=args[i+1];
  }
  for(const key of allowed)if(key!=='name-en'&&!values[key]?.trim())throw new Error(`Required: --${key}`);
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(values.id))throw new Error('--id must be a lowercase URL-safe slug');
  const input=path.resolve(values.boundary),stat=await fs.stat(input);
  if(!stat.isFile()||stat.size>REGION_BOUNDARY_LIMITS.maxResponseBytes)throw new Error('Boundary must be a GeoJSON Feature file no larger than 2 MiB');
  const bytes=await fs.readFile(input),feature=JSON.parse(bytes);
  const names=[feature.properties?.name,feature.properties?.nameEn,feature.properties?.['name:en']].filter(Boolean);
  const normalize=name=>String(name).normalize('NFKC').trim().toLowerCase().replace(/市$/,'').replace(/ city$/,'');
  if(names.length&&![values.name,values['name-en']].filter(Boolean).some(name=>names.some(known=>normalize(name)===normalize(known)))) {
    throw new Error('The supplied name does not match boundary metadata. Use its real name (or --name-en); do not rename another city’s boundary.');
  }
  const config={schema:'city-starter-v1',id:values.id,name:values.name,...(values['name-en']?{nameEn:values['name-en']}:{}),
    coordinates:[Number(values.lon),Number(values.lat)],
    boundary:{path:`./data/regions/custom/${values.id}.geojson`,sha256:createHash('sha256').update(bytes).digest('hex'),
      source:{url:values.source,license:values.license,attribution:values.attribution}},
    airports:{status:'unverified'},landmarks:[]};
  validateCityStarterConfig(config,feature);
  const target=path.join(outputRoot,'data/regions/custom',`${config.id}.geojson`),configPath=path.join(outputRoot,'data/cities',`${config.id}.json`);
  // Refuse replacement and copy the supplied bytes verbatim, including provenance.
  for(const file of [target,configPath]){try{await fs.access(file);throw new Error(`Refusing to overwrite ${file}`);}catch(error){if(error.code!=='ENOENT')throw error;}}
  await fs.mkdir(path.dirname(target),{recursive:true});await fs.mkdir(path.dirname(configPath),{recursive:true});
  await fs.writeFile(target,bytes,{flag:'wx'});
  try{await fs.writeFile(configPath,JSON.stringify(config,null,2)+'\n',{flag:'wx'});}catch(error){await fs.unlink(target);throw error;}
  return {configPath,boundaryPath:target,url:`/examples/city-starter/?city=${config.id}`};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.includes('--help')){
    console.log('node scripts/create-city.mjs --id <slug> --name <real city name> [--name-en <source name>] --lon <longitude> --lat <latitude> --boundary <Feature.geojson> --source <https://source> --license <license> --attribution <credit>\nCreates source-backed configuration only, not bespoke models. See docs/add-a-city.md.');
  }else{
    try{const result=await createCity(process.argv.slice(2));console.log(`Created ${result.configPath}\nOpen after npm start: ${result.url}\nGeometry and point containment checked; geographic accuracy, data license and airports still require your review.`);}
    catch(error){console.error(error.message);process.exitCode=1;}
  }
}
