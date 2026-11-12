import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {readSessionReport} from '../report-fields.js';
import {formCohorts} from '../public-forms.js';
import {visibleAnswers,summarizeAnswers} from '../dynamic-forms.js';
const branching={sections:[
 {questions:[{id:'finished'}]},
 {when:{id:'finished',equals:'Yes'},questions:[{id:'score'}]},
 {when:{id:'finished',equals:'No'},questions:[{id:'reason'}]}
]};
assert.deepEqual(visibleAnswers(branching,{finished:'Yes',score:0,reason:'stale',cohort_id:'other'}),{finished:'Yes',score:0});
assert.deepEqual(visibleAnswers(branching,{finished:'No',score:4,reason:'Follow-up'}),{finished:'No',reason:'Follow-up'});
const exampleRows=[{answers:{amount:0,choices:['A','B']}},{answers:{amount:20,choices:['A']}},{answers:{}}];
const amounts=summarizeAnswers({id:'amount',type:'currency'},exampleRows);
assert.deepEqual([amounts.count,amounts.total,amounts.average,amounts.min,amounts.max],[2,20,10,0,20]);
assert.deepEqual([...summarizeAnswers({id:'choices',type:'checkbox'},exampleRows).bins],[['A',2],['B',1]]);
const independentCohorts=[{id:'tech-jan',programme_id:'tech',status:'active'},{id:'girls-jan',programme_id:'girls',status:'active'},{id:'tech-future',programme_id:'tech',status:'active'},{id:'tech-old',programme_id:'tech',status:'completed'}];
assert.deepEqual(formCohorts(independentCohorts,'tech').map(c=>c.id),['tech-jan','tech-future']);
assert.deepEqual(formCohorts(independentCohorts,'girls').map(c=>c.id),['girls-jan']);
assert.deepEqual(formCohorts(independentCohorts,'library'),[]);
assert.deepEqual(formCohorts(independentCohorts,'tech','tech-old').map(c=>c.id),['tech-jan','tech-future','tech-old']);
const fields=new Map(Object.entries({date:'2026-11-04',outcome:'completed',enrolled:'20',attended:'15',topic:' Reading ',progress:'on_track',summary:' Session summary ',challenges:'',nextSteps:' More reading ',volunteers:' Team '}));
assert.deepEqual(readSessionReport(fields),{session_date:'2026-11-04',outcome:'completed',enrolled_count:20,attended_count:15,topic:'Reading',progress:'on_track',summary:'Session summary',challenges:'',next_steps:'More reading',co_facilitators:'Team'});
for(const [enrolled,attended] of [['20','21'],['-1','0'],['20','1.5'],['5001','0'],['','0']]){
 const invalid=new Map(fields);invalid.set('enrolled',enrolled);invalid.set('attended',attended);assert.throws(()=>readSessionReport(invalid),/Attendance/);
}
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const forms=readFileSync(new URL('../public-forms.js',import.meta.url),'utf8');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
assert.equal(new Set(ids).size,ids.length,'HTML IDs must be unique');
const available=new Set([...ids,...[...forms.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1])]);
for(const m of (app+forms).matchAll(/\$\('([^']+)'\)/g))assert(available.has(m[1]),`Missing HTML ID: ${m[1]}`);
const values={'analytics-programme':'','analytics-cohort':'','analytics-leader':'','analytics-outcome':'','analytics-progress':'','analytics-period':'all','analytics-from':'','analytics-to':''};
const reports=[{cohort_id:'a',programme:'Tech',date:'2026-11-01',outcome:'completed',progress:'on_track',attended:15},{cohort_id:'b',programme:'Tech',date:'2026-11-02',outcome:'partial',progress:'needs_support',attended:7}];
const context=vm.createContext({$:id=>({value:values[id]}),reports,cohorts:[{id:'a',leader_id:'leader-a'},{id:'b',leader_id:'leader-b'}],dateToday:()=> '2026-11-04'});
vm.runInContext(app.slice(app.indexOf('function filteredAnalytics()'),app.indexOf('function metricBar(')),context);
const result=()=>vm.runInContext('filteredAnalytics()',context);
assert.equal(result().length,0,'No combined analytics before explicit selection');
values['analytics-cohort']='a';assert.deepEqual(Array.from(result(),r=>r.cohort_id),['a']);
values['analytics-cohort']='b';assert.deepEqual(Array.from(result(),r=>r.cohort_id),['b']);
values['analytics-cohort']='__all__';assert.equal(result().length,2);
values['analytics-period']='custom';values['analytics-from']='2026-11-02';values['analytics-to']='2026-11-03';assert.equal(result().length,1);
values['analytics-from']='2026-11-04';assert.equal(result().length,0,'Invalid date range also blocks exported data');
values['analytics-period']='all';values['analytics-leader']='leader-a';assert.equal(result().length,1);
console.log('PASS: HTML IDs, cohort-isolated analytics, explicit organization overview, dates and leader filters');
