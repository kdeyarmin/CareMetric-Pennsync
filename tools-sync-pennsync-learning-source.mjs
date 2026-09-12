import fs from 'node:fs';
const root=new URL('./',import.meta.url);
const target=new URL('base44/functions/centralAdminRead/entry.ts',root);
const fields=JSON.parse(fs.readFileSync(new URL('base44/_shared/pennsyncLearningSourceFields.json',root),'utf8'));
const helper=fs.readFileSync(new URL('base44/_shared/pennsyncLearningSource.ts',root),'utf8')
  .replace('declare const pennsyncSourceFields: Record<string, string[]>;',`const pennsyncSourceFields: Record<string, string[]> = ${JSON.stringify(fields)};`);
const block=`// BEGIN PENNSYNC LEARNING SOURCE\n${helper.trim()}\n// END PENNSYNC LEARNING SOURCE`;
const source=fs.readFileSync(target,'utf8');
const updated=source.includes('// BEGIN PENNSYNC LEARNING SOURCE')
  ? source.replace(/\/\/ BEGIN PENNSYNC LEARNING SOURCE[\s\S]*?\/\/ END PENNSYNC LEARNING SOURCE/,block)
  : source.replace('\nDeno.serve(',`\n${block}\n\nDeno.serve(`);
if(process.argv.includes('--check')) {if(updated!==source)throw new Error('PennSync learning source inline copy is stale');}
else fs.writeFileSync(target,updated);
