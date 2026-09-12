// Embedded into centralAdminRead by tools-sync-pennsync-learning-source.mjs.
// Only the current, mapped protected administrator can invoke this reader.
type LearningRow = Record<string, unknown>;
type LearningEntity = { filter: (query: LearningRow, sort: string, limit: number, offset: number, fields: string[]) => Promise<unknown> };
declare const pennsyncSourceFields: Record<string, string[]>;
const learningEncoder = new TextEncoder();
const learningIdPattern = /^[0-9a-f]{24}$/;
function sourceCanonical(value: unknown): string {
  if (value === null || ['string','boolean','number'].includes(typeof value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(sourceCanonical).join(',') + ']';
  if (!value || typeof value !== 'object') throw new Error('Invalid source value');
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + sourceCanonical((value as LearningRow)[key])).join(',') + '}';
}
async function sourceHash(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',learningEncoder.encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function readPennsyncLearningSource(entities: Record<string, LearningEntity>, signal: AbortSignal) {
  const read = async (name: string): Promise<LearningRow[]> => {
    const result: LearningRow[] = []; let previous = '';
    for (let offset=0;offset<=10000;offset+=250) {
      signal.throwIfAborted();
      const limit=Math.min(250,10001-offset);
      const page=await entities[name].filter({},'id',limit,offset,pennsyncSourceFields[name]);
      signal.throwIfAborted();
      if (!Array.isArray(page)||page.length>limit) throw new Error('Invalid source page');
      for(const row of page) {
        if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.id!=='string'||!learningIdPattern.test(row.id)||row.id<=previous) throw new Error('Invalid source order');
        previous=row.id;
        const projected=Object.fromEntries(pennsyncSourceFields[name].filter(key=>row[key]!==undefined).map(key=>[key,row[key]]));
        if(learningEncoder.encode(sourceCanonical(projected)).length>750000) throw new Error('Oversized source record');
        result.push(projected);
      }
      if(result.length>10000)throw new Error('Source scan incomplete');
      if(page.length<limit)return result;
    }
    throw new Error('Source scan incomplete');
  };
  const scan = async () => {
    const result:Record<string,LearningRow[]>={}; const names=Object.keys(pennsyncSourceFields).sort();
    // Bound platform load while reading all pages, including empty entities.
    for(let index=0;index<names.length;index+=4) {
      const group=names.slice(index,index+4);
      const values=await Promise.all(group.map(read));
      group.forEach((name,i)=>{result[name]=values[i];});
    }
    if(learningEncoder.encode(sourceCanonical(result)).length>6000000)throw new Error('Oversized source cohort');
    return result;
  };
  const first=await scan(), second=await scan();
  // Base44 has no cross-entity snapshot transaction. Require two identical,
  // complete reads; the Hub re-reads the same source before committing it.
  if(sourceCanonical(first)!==sourceCanonical(second))throw new Error('Source changed during read');
  const references:Array<{entity:string;sourceId:string;path:string;sha256:string;kind:string}>=[];
  const scrub=async(value:unknown,entity:string,sourceId:string,path:string,depth=0):Promise<unknown>=>{
    if(depth>20)throw new Error('Source nesting exceeds limit');
    const key=path.split('/').at(-1)??'';
    const sensitiveKey=/(?:url|uri|token|secret|password|authorization|api_key|ai_prompt_json)$/i.test(key);
    if(value!=null&&value!==''&&(sensitiveKey||(typeof value==='string'&&/(?:https?:\/\/|Bearer\s+|[?&](?:token|signature|key|x-amz-[a-z-]+)=)/i.test(value)))) {
      if(references.length>=10000)throw new Error('Too many source references');
      const sha256=await sourceHash(sourceCanonical(value));
      references.push({entity,sourceId,path,sha256,kind:sensitiveKey?'source_reference':'embedded_reference'});
      return {sourceReferenceSha256:sha256};
    }
    if(Array.isArray(value))return Promise.all(value.map((item,i)=>scrub(item,entity,sourceId,path+'/'+i,depth+1)));
    if(value&&typeof value==='object') {
      const out:LearningRow={};
      for(const name of Object.keys(value).sort()) {
        if(['__proto__','prototype','constructor'].includes(name)||name.length>160)throw new Error('Invalid source key');
        out[name]=await scrub((value as LearningRow)[name],entity,sourceId,path+'/'+name.replace(/~/g,'~0').replace(/\//g,'~1'),depth+1);
      }
      return out;
    }
    return value;
  };
  const records:Record<string,Array<{id:string;revision:string;fields:unknown}>>={};
  for(const [name,values] of Object.entries(second)) {
    records[name]=[];
    for(const row of values) records[name].push({id:String(row.id),revision:await sourceHash(sourceCanonical(row)),fields:await scrub(row,name,String(row.id),'')});
  }
  const payload=sourceCanonical({contract:'pennsync.learning-source.v1',sourceAppId:'694ec16e72e01b60d22f7cbf',scope:'private-administrator-migration',records,references});
  if(learningEncoder.encode(payload).length>7000000)throw new Error('Oversized source payload');
  return {payload,sourceRevision:await sourceHash(payload)};
}
