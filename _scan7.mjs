import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const files=[];
function w(d){ for(const e of readdirSync(d,{withFileTypes:true})){
  if(['node_modules','dist','.git'].includes(e.name)) continue;
  const p=join(d,e.name);
  if(e.isDirectory()) w(p); else if(/\.(jsx|js)$/.test(e.name)&&!/\.(test|spec)\./.test(e.name)) files.push(p);
}}
w('src');
for(const f of files){
  const src=readFileSync(f,'utf8');
  const setters=new Set();
  for(const m of src.matchAll(/set(\w*(?:Loading|Saving|Submitting|Processing|Generating|Analyzing|Busy|Pending|Sending|Uploading))\s*\(\s*true\s*\)/g)) setters.add(m[1]);
  for(const name of setters){
    const trues=[...src.matchAll(new RegExp(`set${name}\\s*\\(\\s*true\\s*\\)`,'g'))].length;
    const falses=[...src.matchAll(new RegExp(`set${name}\\s*\\(\\s*false\\s*\\)`,'g'))].length;
    const hasFinally=new RegExp(`finally\\s*\\{[^}]*set${name}\\s*\\(\\s*false`).test(src.replace(/\n/g,' '));
    if(falses===0) console.log(`NEVER-CLEARED ${f}: set${name} true x${trues}, false x0`);
    else if(!hasFinally && falses<trues) console.log(`FEWER-FALSE ${f}: set${name} true x${trues}, false x${falses}, finally=${hasFinally}`);
  }
}
