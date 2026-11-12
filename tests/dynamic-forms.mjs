import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  newQuestion, blankSchema, formTemplate, currencyCodes,
  visibleBy, filterVisibleAnswers, summarizeQuestion
} from '../dynamic-forms.js';

const templateIds=['blank','session','training','volunteer','event','assessment','attendance','activity','survey'];
for(const id of templateIds){
  const value=formTemplate(id);
  assert.ok(value.title?.trim(),id+' template needs a title');
  assert.ok(value.schema.sections.length,id+' template needs sections');
  assert.ok(value.schema.sections.every(s=>s.questions.length),id+' template needs questions');
  const ids=value.schema.sections.flatMap(s=>[s.id,...s.questions.map(q=>q.id)]);
  assert.equal(new Set(ids).size,ids.length,'Template IDs must be unique');
}
const a=formTemplate('session'),b=formTemplate('session');
assert.notEqual(a.schema.sections[0].id,b.schema.sections[0].id,'Templates must not share section IDs');
assert.notEqual(a.schema.sections[0].questions[0].id,b.schema.sections[0].questions[0].id,'Templates must not share question IDs');

assert.equal(newQuestion('heading').required,false);
assert.ok(currencyCodes.includes(newQuestion('currency').currencyCode));
assert.equal(blankSchema().sections.length,1);

const condition={questionId:'done',value:'Yes'};
assert.ok(visibleBy(condition,{done:'Yes'}));
assert.equal(visibleBy(condition,{done:'No'}),false);
const schema={sections:[
 {id:'first',title:'First',questions:[{id:'done',type:'yesno',label:'Was it done?'}]},
 {id:'second',title:'Follow-up',when:condition,questions:[
  {id:'feedback',type:'paragraph',label:'Outcome'},
  {id:'hidden',type:'text',label:'Hidden',when:{questionId:'done',value:'No'}}
 ]}
]};
const onlyVisible=filterVisibleAnswers(schema,{done:'No',feedback:'must drop',hidden:'keep'});
assert.deepEqual(onlyVisible,{done:'No'});
const yesVisible=filterVisibleAnswers(schema,{done:'Yes',feedback:'keep',hidden:'must drop'});
assert.deepEqual(yesVisible,{done:'Yes',feedback:'keep'});
assert.equal(summarizeQuestion({type:'number'},[5,10,null]).sum,15);
assert.equal(summarizeQuestion({type:'number'},[5,10,null]).avg,7.5);
assert.equal(summarizeQuestion({type:'rating'},[]).kind,'empty');
assert.deepEqual(summarizeQuestion({type:'radio'},['Yes','No','Yes']).counts,{Yes:2,No:1});
assert.deepEqual(summarizeQuestion({type:'checkbox'},[['One','Two'],['One']]).counts,{One:2,Two:1});
assert.equal(summarizeQuestion({type:'paragraph'},['text']).kind,'text');

const js=readFileSync(new URL('../dynamic-forms.js',import.meta.url),'utf8');
const sql=readFileSync(new URL('../supabase/migrations/20261111230000_dynamic_cohort_forms.sql',import.meta.url),'utf8');
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
assert.ok(html.includes('dynamic-forms.css'));
assert.ok(app.includes('mountDynamicForms')&&app.includes('dynamicForms.publicMode'));
assert.ok(js.includes("client.rpc('submit_dynamic_form'"));
for(const name of ['dynamic_forms','dynamic_form_versions','dynamic_form_submissions','dynamic_form_audit'])
  assert.ok(sql.includes('create table public.'+name),name+' migration missing');
assert.ok(sql.includes('foreign key(form_id,cohort_id) references public.dynamic_forms(id,cohort_id)'));
assert.ok(sql.includes('p_version_id uuid'),'Version-specific submission required');
assert.ok(sql.includes('private.is_super_admin()'),'Admin check required');
assert.ok(sql.includes("token_hash=encode(extensions.digest(p_token,'sha256'),'hex')"));
assert.ok(!js.includes('sb_secret_')&&!js.includes('service_role'));
console.log('PASS: dynamic forms templates, conditions, type-aware summaries, wiring and SQL safety contracts');
