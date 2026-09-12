import fs from 'node:fs';
const target=new URL('./base44/functions/centralLearningGrade/entry.ts',import.meta.url);
const source=fs.readFileSync(new URL('./base44/functions/gradeTrainingAttempt/entry.ts',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const prompt=source.match(/const prompt = (`You are an experienced healthcare compliance educator[\s\S]*?\$\{JSON.stringify\(questionsForGrading\)\}`);/);
if(!prompt)throw new Error('Native educator prompt could not be located');
const fields=JSON.parse(fs.readFileSync(new URL('./base44/_shared/pennsyncLearningSourceFields.json',import.meta.url),'utf8'));
const block=`// BEGIN NATIVE GRADING SOURCE\n// Generated from the existing native educator prompt and exact source projection.\nconst gradingSourceFields:Record<string,string[]>=${JSON.stringify({TrainingCourse:fields.TrainingCourse,TrainingQuestion:fields.TrainingQuestion})};\nfunction educatorPrompt(questionsForGrading:unknown){return ${prompt[1]};}\n// END NATIVE GRADING SOURCE`;
const current=fs.readFileSync(target,'utf8').replace(/\r\n/g,'\n'),updated=current.replace(/\/\/ BEGIN NATIVE GRADING SOURCE[\s\S]*?\/\/ END NATIVE GRADING SOURCE/,block);
if(process.argv.includes('--check')){if(current!==updated)throw new Error('Native grading provider prompt/projection is stale');}
else fs.writeFileSync(target,updated);
