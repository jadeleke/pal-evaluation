// Dynamic form builder. Backend RPCs enforce authorization and cohort isolation.
// Existing fixed session reports and public forms remain unchanged.
const uuid=()=>crypto.randomUUID();
const TYPES=[
 ['text','Short text'],['paragraph','Long text'],['number','Number'],['currency','Currency / amount'],
 ['date','Date'],['time','Time'],['datetime','Date & time'],['select','Dropdown'],
 ['radio','Single choice'],['checkbox','Multiple choice'],['yesno','Yes / No'],
 ['rating','Rating scale'],['linear','Linear scale'],['email','Email'],['phone','Phone'],
 ['heading','Section heading / description']
];
export const newQuestion=(type='text',label='New question')=>({
 id:uuid(),type,label,required:type!=='heading',help:'',placeholder:'',
 ...( ['select','radio','checkbox'].includes(type)?{options:['Option 1','Option 2']}:{} ),
 ...( ['rating','linear'].includes(type)?{min:1,max:5}:{} )
});
export const blankSchema=()=>({sections:[{id:uuid(),title:'Section 1',description:'',questions:[newQuestion()]}]});
const tmpl=(title,types)=>({title,schema:{sections:[{id:uuid(),title:'About this activity',description:'',questions:types.map(([type,label])=>newQuestion(type,label))}]}});
export function formTemplate(id){
 switch(id){
 case 'session':return tmpl('Volunteer session report',[['date','Session date'],['text','Session topic'],['number','Learners attending'],['paragraph','Session summary'],['paragraph','Challenges'],['paragraph','Next steps']]);
 case 'training':return tmpl('Training evaluation',[['text','Training name'],['date','Training date'],['rating','Overall rating'],['paragraph','What was most useful?'],['paragraph','What should improve?']]);
 case 'volunteer':return tmpl('Volunteer feedback',[['radio','How was your experience?'],['paragraph','Suggestions']]);
 case 'event':return tmpl('Event registration',[['text','Full name'],['email','Email address'],['radio','Will you attend?']]);
 case 'assessment':return tmpl('Programme assessment',[['text','Programme activity'],['rating','Outcome rating'],['paragraph','Observations']]);
 case 'attendance':return tmpl('Attendance reporting',[['date','Date'],['number','Total attendance'],['paragraph','Notes']]);
 case 'activity':return tmpl('Activity evaluation',[['text','Activity'],['rating','Effectiveness'],['paragraph','Outcomes']]);
 case 'survey':return tmpl('General survey',[['radio','How would you rate this?'],['paragraph','Additional comments']]);
 default:return {title:'Untitled custom form',schema:blankSchema()};
 }
}
export function visibleBy(rule,answers){return !rule||String(answers[rule.questionId]??'')===String(rule.value??'');}
export function filterVisibleAnswers(schema,answers){
 const out={};
 for(const section of schema.sections||[]){
  if(!visibleBy(section.when,answers))continue;
  for(const q of section.questions||[]){
   if(q.type!=='heading'&&visibleBy(q.when,answers)&&Object.prototype.hasOwnProperty.call(answers,q.id))out[q.id]=answers[q.id];
  }
 }
 return out;
}
export function summarizeQuestion(q,values){
 const a=values.filter(v=>v!==null&&v!==undefined&&v!==''&&(!Array.isArray(v)||v.length));
 if(!a.length)return {count:0,kind:'empty'};
 if(['number','currency','rating','linear'].includes(q.type)){
   const ns=a.map(Number).filter(Number.isFinite);
   return {count:ns.length,kind:'numeric',sum:ns.reduce((x,y)=>x+y,0),avg:ns.length?ns.reduce((x,y)=>x+y,0)/ns.length:null,min:ns.length?Math.min(...ns):null,max:ns.length?Math.max(...ns):null};
 }
 if(['select','radio','checkbox','yesno'].includes(q.type)){
   const counts={};for(const v of a){for(const item of (Array.isArray(v)?v:[v]))counts[String(item)]=(counts[String(item)]||0)+1;}
   return {count:a.length,kind:'choice',counts};
 }
 return {count:a.length,kind:'text'};
}
const localTime=value=>value?new Date(value).toISOString().slice(0,16):'';
const csvCell=v=>'"'+String(v??'').replace(/^[=+\-@\t\r]/,"'$&").replace(/"/g,'""')+'"';
const csvDownload=(filename,rows)=>{
 const a=document.createElement('a'),url=URL.createObjectURL(new Blob([rows.map(r=>r.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
 a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
const opt=(value,label,selected='')=>'<option value="'+value+'" '+(String(value)===String(selected)?'selected':'')+'>'+label+'</option>';
export function mountDynamicForms(client,{esc,refresh}){
 const $=id=>document.getElementById(id), token=new URLSearchParams(location.hash.slice(1)).get('dynamic');
 const publicMode=token!==null, links=new Map();
 let forms=[],versions=[],submissions=[],cohorts=[],programmes=[],current=null,dirty=false,selectedForm=null,loadError='';
 document.querySelector('#nav').insertAdjacentHTML('afterbegin','<button class="nav-link" type="button" data-page="dynamic-forms" data-admin hidden><span class="nav-icon">▧</span> Form builder</button>');
 document.querySelector('.content').insertAdjacentHTML('beforeend',
  '<section id="page-dynamic-forms" class="page"><div class="heading-row"><div><div class="eyebrow">SUPER ADMIN</div><h1>Form builder</h1><p class="muted">Create custom forms for each cohort. Existing session reporting remains available.</p></div></div>'+
  '<p id="dynamic-notice" role="status" aria-live="polite"></p>'+
  '<div class="panel dynamic-toolbar"><label>Start from a template<select id="dynamic-template">'+
  [['blank','Blank form'],['session','Volunteer session report'],['training','Training evaluation'],['volunteer','Volunteer feedback'],['event','Event registration'],['assessment','Programme assessment'],['attendance','Attendance'],['activity','Activity evaluation'],['survey','General survey']].map(x=>'<option value="'+x[0]+'">'+x[1]+'</option>').join('')+
  '</select></label><button id="dynamic-new" type="button" class="primary-button">＋ Create form</button></div>'+
  '<div id="dynamic-builder" class="panel dynamic-builder" hidden></div>'+
  '<div class="section-head"><h2>Manage forms</h2></div><div id="dynamic-list" class="cohort-grid"></div>'+
  '<div id="dynamic-analytics" class="panel dynamic-analytics" hidden></div></section>');
 const notice=v=>{$('dynamic-notice').textContent=v;};
 const normalize=s=>JSON.parse(JSON.stringify(s));
 const allRows=async(table,columns)=>{
  let rows=[];for(let offset=0;offset<50000;offset+=500){
   const {data,error}=await client.from(table).select(columns).order('id').range(offset,offset+499);
   if(error)throw error;rows.push(...data);if(data.length<500)break;
  }return rows;
 };
 async function load(){
  try{
   [forms,versions,submissions]=await Promise.all([
    allRows('dynamic_forms','id,cohort_id,title,description,status,draft_schema,published_version_id,opens_at,closes_at,created_at,updated_at'),
    allRows('dynamic_form_versions','id,form_id,version_no,schema,published_at'),
    allRows('dynamic_form_submissions','id,form_id,cohort_id,version_id,answers,created_at')
   ]);loadError='';
  }catch(error){loadError='Dynamic forms are not available: '+error.message;forms=[];versions=[];submissions=[];}
 }
 function fresh(template='blank'){
  if(!confirmUnsaved())return;
  const built=formTemplate(template);
  current={id:null,cohort_id:'',title:built.title,description:'',status:'draft',
   draft_schema:built.schema,opens_at:localTime(new Date()),closes_at:localTime(Date.now()+30*86400000)};
  dirty=true;renderBuilder();
 }
 function confirmUnsaved(){return !dirty||window.confirm('Discard unsaved form changes?');}
 function conditionEditor(rule,eligible,prefix){
  const ref=rule?.questionId||'';
  return '<label>Show condition<select data-field="'+prefix+'.when.questionId"><option value="">Always show</option>'+
   eligible.map(q=>opt(esc(q.id),esc(q.label),ref)).join('')+'</select></label>'+
   (ref?'<label>When answer equals<input data-field="'+prefix+'.when.value" value="'+esc(rule?.value||'')+'" placeholder="Choice value"></label>':'');
 }
 function renderBuilder(){
  const host=$('dynamic-builder');host.hidden=!current;if(!current)return;
  const s=current.draft_schema;
  let earlier=[];
  const sections=s.sections.map((section,si)=>{
    const heading='<div class="dynamic-section-head"><h3>Section '+(si+1)+'</h3>'+
     '<div><button data-action="up-section" data-section="'+si+'" type="button">↑</button> <button data-action="down-section" data-section="'+si+'" type="button">↓</button> '+
     '<button data-action="copy-section" data-section="'+si+'" type="button">Duplicate</button> <button data-action="delete-section" data-section="'+si+'" type="button">Delete</button></div></div>'+
     '<div class="dynamic-grid"><label>Section title<input data-field="sections.'+si+'.title" value="'+esc(section.title)+'" maxlength="120"></label>'+
     '<label>Section description<input data-field="sections.'+si+'.description" value="'+esc(section.description||'')+'" maxlength="1000"></label>'+
     conditionEditor(section.when,earlier,'sections.'+si)+'</div>';
    const qs=(section.questions||[]).map((q,qi)=>{
      const prefix='sections.'+si+'.questions.'+qi, before=[...earlier];
      const typOptions=TYPES.map(t=>opt(esc(t[0]),esc(t[1]),q.type)).join('');
      const body='<div class="dynamic-question"><div class="dynamic-section-head"><strong>Question '+(qi+1)+'</strong><div>'+
       '<button type="button" data-action="up-question" data-section="'+si+'" data-question="'+qi+'">↑</button> '+
       '<button type="button" data-action="down-question" data-section="'+si+'" data-question="'+qi+'">↓</button> '+
       '<button type="button" data-action="copy-question" data-section="'+si+'" data-question="'+qi+'">Duplicate</button> '+
       '<button type="button" data-action="delete-question" data-section="'+si+'" data-question="'+qi+'">Delete</button></div></div>'+
       '<div class="dynamic-grid"><label>Question / heading<input data-field="'+prefix+'.label" value="'+esc(q.label)+'" maxlength="160"></label>'+
       '<label>Answer type<select data-field="'+prefix+'.type">'+typOptions+'</select></label>'+
       '<label>Help text<input data-field="'+prefix+'.help" value="'+esc(q.help||'')+'" maxlength="500"></label>'+
       '<label>Placeholder<input data-field="'+prefix+'.placeholder" value="'+esc(q.placeholder||'')+'" maxlength="180"></label>'+
       '<label><input type="checkbox" data-field="'+prefix+'.required" '+(q.required?'checked':'')+'> Required</label>'+
       (['select','radio','checkbox'].includes(q.type)?'<label class="dynamic-span">Answer options (one per line)<textarea data-field="'+prefix+'.options" rows="3">'+esc((q.options||[]).join('\n'))+'</textarea></label>':'')+
       (['rating','linear','number','currency'].includes(q.type)?'<label>Minimum<input type="number" data-field="'+prefix+'.min" value="'+esc(q.min??'')+'"></label><label>Maximum<input type="number" data-field="'+prefix+'.max" value="'+esc(q.max??'')+'"></label>':'')+
       conditionEditor(q.when,before,prefix)+'</div></div>';
      if(['select','radio','yesno'].includes(q.type))earlier.push(q);
      return body;
    }).join('');
    return '<article class="dynamic-section">'+heading+qs+
     '<button data-action="add-question" data-section="'+si+'" type="button" class="secondary-button">＋ Add question</button></article>';
  }).join('');
  const selectedC=cohorts.find(c=>c.id===current.cohort_id);
  host.innerHTML='<div class="dynamic-section-head"><div><h2>'+(current.id?'Edit form':'Create form')+'</h2><p class="muted">Saved forms stay linked to one cohort. Published submissions retain their original version.</p></div><button id="dynamic-cancel" type="button" class="secondary-button">Close editor</button></div>'+
   '<div class="dynamic-grid"><label>Programme<select id="dynamic-programme" '+(current.id?'disabled':'')+'>'+
    opt('','Choose programme',!selectedC?'':selectedC.programme_id)+programmes.map(p=>opt(esc(p.id),esc(p.name),selectedC?.programme_id)).join('')+'</select></label>'+
   '<label>Cohort *<select id="dynamic-cohort" '+(current.id?'disabled':'')+'>'+
    opt('','Choose cohort',current.cohort_id)+cohorts.filter(c=>!current.id||c.id===current.cohort_id).map(c=>opt(esc(c.id),esc(c.name),current.cohort_id)).join('')+'</select></label>'+
   '<label class="dynamic-span">Form title<input id="dynamic-title" maxlength="120" value="'+esc(current.title)+'" required></label>'+
   '<label class="dynamic-span">Description<textarea id="dynamic-description" maxlength="1000">'+esc(current.description||'')+'</textarea></label>'+
   '<label>Opens at<input type="datetime-local" id="dynamic-opens" value="'+esc(current.opens_at||'')+'"></label>'+
   '<label>Closes at<input type="datetime-local" id="dynamic-closes" value="'+esc(current.closes_at||'')+'"></label></div>'+
   sections+
   '<div class="dynamic-controls"><button type="button" class="secondary-button" data-action="add-section">＋ Add section</button>'+
   '<button type="button" class="secondary-button" data-action="preview">Preview</button>'+
   '<button type="button" class="secondary-button" data-action="save">Save draft changes</button>'+
   '<button type="button" class="primary-button" data-action="publish">Publish version</button></div>'+
   '<div id="dynamic-preview" hidden></div>';
  $('dynamic-programme').value=selectedC?.programme_id||'';
  updateCohorts();
  $('dynamic-cancel').onclick=()=>{if(confirmUnsaved()){current=null;dirty=false;renderBuilder();}};
 }
 function updateCohorts(){
  const element=$('dynamic-cohort');if(!element||!current)return;
  const old=current.cohort_id,programme=$('dynamic-programme').value;
  const subset=cohorts.filter(c=>c.programme_id===programme&&(c.status==='active'||c.id===old));
  element.innerHTML='<option value="">Choose a cohort</option>'+subset.map(c=>opt(esc(c.id),esc(c.name),old)).join('');
 }
 function setNested(path,value){
  const parts=path.split('.'),root=current.draft_schema;
  let obj=root;
  for(let i=0;i<parts.length-1;i++){const part=parts[i];
   if(part==='when'&&!obj.when)obj.when={};
   obj=obj[part];
  }
  const k=parts.at(-1);if(parts.includes('when')&&k==='questionId'&&!value){
    const parent=parts.slice(0,-2).reduce((obj,p)=>obj[p],root);delete parent.when;
  }else if(k==='options')obj[k]=value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  else if(k==='required')obj[k]=value;
  else if(['min','max','minLength','maxLength'].includes(k)){if(value==='')delete obj[k];else obj[k]=Number(value);}
  else obj[k]=value;
 }
 function changeField(event){
  if(!current)return;
  const e=event.target;let path=e.dataset.field;
  if(path){
   setNested(path,e.type==='checkbox'?e.checked:e.value);
   dirty=true;if(path.endsWith('.type')){const parts=path.split('.'),q=current.draft_schema.sections[Number(parts[1])].questions[Number(parts[3])];
    Object.assign(q,{required:q.type!=='heading'});if(['select','radio','checkbox'].includes(q.type)&&!q.options)q.options=['Option 1','Option 2'];
    if(['rating','linear'].includes(q.type)){q.min??=1;q.max??=5;}
   }
   if(path.endsWith('.type')||path.includes('.when.questionId'))renderBuilder();
  }
 }
 $('dynamic-builder').addEventListener('change',changeField);
 $('dynamic-builder').addEventListener('input',e=>{if(e.target.dataset.field&&current)dirty=true;});
 $('dynamic-builder').addEventListener('change',e=>{
  if(!current)return;
  const id=e.target.id;
  if(id==='dynamic-programme'){current.cohort_id='';updateCohorts();}
  if(id==='dynamic-cohort')current.cohort_id=e.target.value;
  if(id==='dynamic-title')current.title=e.target.value;
  if(id==='dynamic-description')current.description=e.target.value;
  if(id==='dynamic-opens')current.opens_at=e.target.value;
  if(id==='dynamic-closes')current.closes_at=e.target.value;
  dirty=true;
 });
 function move(items,at,delta){const next=at+delta;if(next<0||next>=items.length)return;[items[at],items[next]]=[items[next],items[at]];}
 $('dynamic-builder').addEventListener('click',async event=>{
  const b=event.target.closest('[data-action]');if(!b||!current)return;
  const a=b.dataset.action,si=Number(b.dataset.section),qi=Number(b.dataset.question);
  const ss=current.draft_schema.sections,s=ss[si];
  if(a==='add-section')ss.push({id:uuid(),title:'New section',description:'',questions:[]});
  else if(a==='add-question')s.questions.push(newQuestion());
  else if(a==='up-section')move(ss,si,-1);
  else if(a==='down-section')move(ss,si,1);
  else if(a==='delete-section'&&window.confirm('Delete this section and its questions?'))ss.splice(si,1);
  else if(a==='copy-section'){const copy=normalize(s);copy.id=uuid();copy.questions=copy.questions.map(q=>({...q,id:uuid()}));ss.splice(si+1,0,copy);}
  else if(a==='up-question')move(s.questions,qi,-1);
  else if(a==='down-question')move(s.questions,qi,1);
  else if(a==='delete-question'&&window.confirm('Delete this question?'))s.questions.splice(qi,1);
  else if(a==='copy-question')s.questions.splice(qi+1,0,{...normalize(s.questions[qi]),id:uuid()});
  else if(a==='preview'){$('dynamic-preview').hidden=!$('dynamic-preview').hidden;renderPreview();return;}
  else if(a==='save'||a==='publish'){await save(a);return;}
  else return;
  dirty=true;renderBuilder();
 });
 function renderPreview(){
  const target=$('dynamic-preview');if(!target)return;
  target.innerHTML='<h3>Form preview</h3><p class="muted">Layout preview; conditions are evaluated when volunteers answer.</p>'+
   current.draft_schema.sections.map(s=>'<div class="dynamic-preview-section"><h4>'+esc(s.title)+'</h4>'+
     '<p>'+esc(s.description||'')+'</p>'+s.questions.map(q=>
      '<div class="dynamic-preview-question"><strong>'+esc(q.label)+'</strong> '+(q.required?'*':'')+
       '<p class="muted">'+esc(TYPES.find(t=>t[0]===q.type)?.[1]||'')+(q.when?' · Conditional':'')+'</p></div>').join('')+'</div>').join('');
 }
 async function api(args){
  const {data,error}=await client.rpc('manage_dynamic_form',args);
  if(error)throw error;
  if(data?.token){links.set(data.id,location.origin+'/#dynamic='+data.token);notice('Link created. Copy it before leaving; only its hash is stored.');}
  return data;
 }
 async function save(action){
  if(!current?.cohort_id||!current.title?.trim()){notice('Choose a cohort and enter a title.');return;}
  if(!current.draft_schema.sections.length){notice('Add at least one section.');return;}
  const iso=s=>s?new Date(s).toISOString():null;
  if(!current.opens_at||!current.closes_at||current.opens_at>=current.closes_at){notice('Choose valid opening and closing dates.');return;}
  try{
   const id=current.id;
   let result=await api({p_action:id?'save':'create',p_id:id,p_cohort_id:current.cohort_id,
     p_title:current.title,p_description:current.description,p_schema:current.draft_schema,
     p_opens_at:iso(current.opens_at),p_closes_at:iso(current.closes_at)});
   current.id=result.id;dirty=false;
   if(action==='publish')await api({p_action:'publish',p_id:current.id});
   notice(action==='publish'?'Form published. Share its link from the form card.':'Draft changes saved.');
   await load();render(cohorts,programmes);if(action==='publish'){current=null;renderBuilder();}
  }catch(err){notice('Could not save: '+err.message);}
 }
 $('dynamic-template').addEventListener('change',()=>{});
 $('dynamic-new').addEventListener('click',()=>fresh($('dynamic-template').value));
 function render(c,p){
  cohorts=c;programmes=p;
  const list=$('dynamic-list');
  if(loadError)notice(loadError);
  list.innerHTML=forms.length?forms.map(f=>{
   const c=cohorts.find(c=>c.id===f.cohort_id),counts=submissions.filter(s=>s.form_id===f.id).length;
   const link=links.get(f.id);
   const actions=[['edit','Edit'],['preview','Preview'],['duplicate','Duplicate'],['publish','Publish'],['close','Close'],['archive','Archive'],[link?'copy':'rotate',link?'Copy link':'Replace link'],['responses','Responses & analytics']]
     .map(([action,label])=>'<button class="secondary-button" type="button" data-form-action="'+action+'" data-form-id="'+esc(f.id)+'">'+label+'</button>').join('');
   return '<article class="cohort-card dynamic-form-card"><span class="badge-neutral">'+esc(f.status)+'</span>'+
    '<h3>'+esc(f.title)+'</h3><p>'+esc(c?.name||'Unknown cohort')+' · '+esc(c?.programme||'')+'</p>'+
    '<p>Submissions: '+counts+' · Versions: '+versions.filter(v=>v.form_id===f.id).length+'</p><div class="form-actions">'+actions+'</div></article>';
  }).join(''):'<p class="muted">No customizable forms yet. Choose a template to create one.</p>';
 }
 $('dynamic-list').addEventListener('click',async e=>{
  const b=e.target.closest('[data-form-action]');if(!b)return;
  const f=forms.find(f=>f.id===b.dataset.formId);if(!f)return;
  const a=b.dataset.formAction;
  if(['edit','duplicate','preview'].includes(a)){
   if(!confirmUnsaved())return;
   current=normalize(f);current.opens_at=localTime(f.opens_at);current.closes_at=localTime(f.closes_at);
   if(a==='duplicate'){current.id=null;current.cohort_id='';current.title+=' (copy)';current.status='draft';}
   dirty=false;renderBuilder();
   if(a==='preview'){$('dynamic-preview').hidden=false;renderPreview();}
   $('dynamic-builder').scrollIntoView({behavior:'smooth'});return;
  }
  if(a==='copy'){
   try{await navigator.clipboard.writeText(links.get(f.id));notice('Link copied.');}
   catch{notice('Copy link from this browser session: '+links.get(f.id));}
   return;
  }
  if(a==='responses'){selectedForm=f.id;renderAnalytics();return;}
  if(a==='rotate'&&!window.confirm('Replace the current public link? The previous link will stop working.'))return;
  if(a==='archive'&&!window.confirm('Archive this form? It will no longer accept responses.'))return;
  b.disabled=true;try{
   await api({p_action:a,p_id:f.id});
   await load();render(cohorts,programmes);notice((a==='rotate'?'Public link replaced. Copy the new one now.':'Form updated.'));
  }catch(err){notice(err.message);}finally{b.disabled=false;}
 });
 function renderAnalytics(){
  const host=$('dynamic-analytics'),f=forms.find(f=>f.id===selectedForm);host.hidden=!f;if(!f)return;
  const prevCohort=host.querySelector('#dynamic-filter-cohort')?.value||f.cohort_id;
  const selectedVersion=host.querySelector('#dynamic-filter-version')?.value||'';
  const from=host.querySelector('#dynamic-filter-from')?.value||'',to=host.querySelector('#dynamic-filter-to')?.value||'';
  const cohortOptions=cohorts.map(c=>opt(esc(c.id),esc(c.name),prevCohort)).join('');
  host.innerHTML='<div class="dynamic-section-head"><h2>Responses & analytics: '+esc(f.title)+'</h2><button id="dynamic-analytics-close" class="secondary-button">Close</button></div>'+
   '<div class="dynamic-grid"><label>Cohort<select id="dynamic-filter-cohort">'+cohortOptions+'</select></label>'+
   '<label>Version<select id="dynamic-filter-version">'+opt('','All versions',selectedVersion)+versions.filter(v=>v.form_id===f.id).map(v=>opt(esc(v.id),'Version '+v.version_no,selectedVersion)).join('')+'</select></label>'+
   '<label>From<input id="dynamic-filter-from" type="date" value="'+esc(from)+'"></label>'+
   '<label>To<input id="dynamic-filter-to" type="date" value="'+esc(to)+'"></label></div>'+
   '<div id="dynamic-results"></div><button type="button" class="secondary-button" id="dynamic-export">↓ Export filtered CSV</button>';
  $('dynamic-filter-cohort').value=prevCohort;
  const rows=()=>submissions.filter(s=>s.form_id===f.id&&s.cohort_id===$('dynamic-filter-cohort').value
    &&(!$('dynamic-filter-version').value||s.version_id===$('dynamic-filter-version').value)
    &&(!$('dynamic-filter-from').value||s.created_at.slice(0,10)>=$('dynamic-filter-from').value)
    &&(!$('dynamic-filter-to').value||s.created_at.slice(0,10)<=$('dynamic-filter-to').value));
  const update=()=>{
   const rs=rows(),cards=[];
   for(const v of versions.filter(v=>v.form_id===f.id&&(!$('dynamic-filter-version').value||v.id===$('dynamic-filter-version').value))){
    const vr=rs.filter(r=>r.version_id===v.id);
    for(const sec of v.schema.sections||[])for(const q of sec.questions||[]){
     if(q.type==='heading')continue;
     const summary=summarizeQuestion(q,vr.map(r=>r.answers[q.id]));
     let details=summary.kind==='numeric'?'Average: '+(summary.avg?.toFixed(2)||'—')+' · Total: '+summary.sum+' · Min: '+summary.min+' · Max: '+summary.max
       :summary.kind==='choice'?Object.entries(summary.counts).map(([k,n])=>esc(k)+': '+n).join(' · ')
       :summary.kind==='text'?'Responses available in CSV':'No responses';
     cards.push('<div class="dynamic-stat"><strong>'+esc(q.label)+' (v'+v.version_no+')</strong><div>'+summary.count+' answers</div><p>'+details+'</p></div>');
    }
   }
   $('dynamic-results').innerHTML='<p class="muted">'+rs.length+' submissions for this form and selected cohort.</p>'+
    '<div class="dynamic-stats">'+(cards.join('')||'<p>No analytical data available.</p>')+'</div>';
  };
  for(const id of ['dynamic-filter-cohort','dynamic-filter-version','dynamic-filter-from','dynamic-filter-to'])$(id).addEventListener('change',update);
  $('dynamic-analytics-close').onclick=()=>{selectedForm=null;host.hidden=true;};
  $('dynamic-export').onclick=()=>{
   const rs=rows(),rowsOut=[['Submission ID','Cohort','Version','Date','Question ID','Question','Answer']];
   for(const r of rs){const v=versions.find(v=>v.id===r.version_id);if(!v)continue;
    for(const sec of v.schema.sections||[])for(const q of sec.questions||[]){
     if(Object.prototype.hasOwnProperty.call(r.answers,q.id))
      rowsOut.push([r.id,r.cohort_id,v.version_no,r.created_at,q.id,q.label,Array.isArray(r.answers[q.id])?r.answers[q.id].join('; '):r.answers[q.id]]);
    }
   }csvDownload('pal-dynamic-responses.csv',rowsOut);
  };
  update();host.scrollIntoView({behavior:'smooth'});
 }
 async function start(){
  if(!publicMode)return;
  $('app').hidden=true;$('auth-page').hidden=true;$('password-page').hidden=true;
  document.body.insertAdjacentHTML('beforeend','<main class="dynamic-public" id="dynamic-public"><div class="eyebrow">PLAY & LEARN FOUNDATION · PUBLIC FORM</div>'+
   '<h1 id="dynamic-public-title">Loading form…</h1><p id="dynamic-public-description"></p><p id="dynamic-public-context"></p>'+
   '<p role="status" id="dynamic-public-status" tabindex="-1"></p><div id="dynamic-public-host"></div></main>');
  const {data,error}=await client.rpc('get_dynamic_form',{p_token:token});
  if(error||!data){$('dynamic-public-title').textContent='Form unavailable';$('dynamic-public-status').textContent='This link is invalid, closed, expired or unavailable. Contact the programme coordinator.';return;}
  $('dynamic-public-title').textContent=data.title;
  $('dynamic-public-description').textContent=data.description||'';
  $('dynamic-public-context').textContent=data.programme+' / '+data.cohort;
  let answers={},submissionKey=uuid(),sending=false;
  const inputFor=q=>{
   const name='name="'+esc(q.id)+'"', val=answers[q.id]??'',required=q.required?'required':'';
   if(q.type==='heading')return '<h3>'+esc(q.label)+'</h3><p>'+esc(q.help||'')+'</p>';
   if(q.type==='paragraph')return '<textarea '+name+' rows="4" placeholder="'+esc(q.placeholder||'')+'" '+required+'>'+esc(val)+'</textarea>';
   if(q.type==='select')return '<select '+name+' '+required+'><option value="">Choose an option</option>'+q.options.map(x=>opt(esc(x),esc(x),val)).join('')+'</select>';
   if(q.type==='radio'||q.type==='yesno')return '<div class="dynamic-choices">'+(q.type==='yesno'?['Yes','No']:q.options).map(x=>
    '<label><input type="radio" '+name+' value="'+esc(x)+'" '+(val===x?'checked':'')+'>'+esc(x)+'</label>').join('')+'</div>';
   if(q.type==='checkbox')return '<div class="dynamic-choices">'+q.options.map(x=>
    '<label><input type="checkbox" '+name+' value="'+esc(x)+'" '+(Array.isArray(val)&&val.includes(x)?'checked':'')+'>'+esc(x)+'</label>').join('')+'</div>';
   if(q.type==='rating'||q.type==='linear')return '<select '+name+' '+required+'><option value="">Choose rating</option>'+
      Array.from({length:q.max-q.min+1},(_,i)=>opt(i+q.min,i+q.min,val)).join('')+'</select>';
   const type=({text:'text',email:'email',phone:'tel',date:'date',time:'time',datetime:'datetime-local',number:'number',currency:'number'})[q.type]||'text';
   const numberAttrs=['number','currency'].includes(q.type)?'step="'+(q.type==='currency'?'0.01':'any')+'" ':'';
   return '<input '+name+' type="'+type+'" value="'+esc(val)+'" placeholder="'+esc(q.placeholder||'')+'" '+numberAttrs+required+'>';
  };
  function renderPublic(){
   $('dynamic-public-host').innerHTML='<form id="dynamic-response-form">'+data.schema.sections.filter(s=>visibleBy(s.when,answers)).map(s=>
    '<section class="panel dynamic-public-section"><h2>'+esc(s.title)+'</h2><p>'+esc(s.description||'')+'</p>'+
    s.questions.filter(q=>visibleBy(q.when,answers)).map(q=>
      '<div class="dynamic-public-question">'+(q.type==='heading'?'':'<label for="">'+esc(q.label)+(q.required?' *':'')+'</label>')+
      (q.help&&q.type!=='heading'?'<small>'+esc(q.help)+'</small>':'')+inputFor(q)+'</div>').join('')+'</section>').join('')+
    '<label class="dynamic-honeypot" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>'+
    '<button class="primary-button" type="submit" id="dynamic-public-submit">Submit responses</button></form>';
   const form=$('dynamic-response-form');
   form.addEventListener('input',capture);
   form.addEventListener('change',event=>{capture(event);if(['select','radio','checkbox'].includes(event.target.type)||event.target.tagName==='SELECT')renderPublic();});
   form.addEventListener('submit',submit);
  }
  function capture(e){
   const el=e.target,qn=(data.schema.sections.flatMap(s=>s.questions)).find(q=>q.id===el.name);
   if(!qn)return;
   if(qn.type==='checkbox')answers[qn.id]=[...document.querySelectorAll('input[name="'+qn.id+'"]:checked')].map(n=>n.value);
   else answers[qn.id]=['number','currency','rating','linear'].includes(qn.type)&&el.value!==''?Number(el.value):el.value;
  }
  async function submit(e){
   e.preventDefault();if(sending)return;
   const honeypot=e.currentTarget.elements.website.value;if(honeypot)return;
   const clean=filterVisibleAnswers(data.schema,answers);
   for(const section of data.schema.sections.filter(s=>visibleBy(s.when,answers)))
    for(const q of section.questions.filter(q=>q.type!=='heading'&&visibleBy(q.when,answers))){
     if(q.required&&(clean[q.id]===undefined||clean[q.id]===''||(Array.isArray(clean[q.id])&&!clean[q.id].length))){
      $('dynamic-public-status').textContent='Complete the required field: '+q.label;
      $('dynamic-public-status').focus();return;
     }
    }
   sending=true;$('dynamic-public-submit').disabled=true;
   try{
    const {error}=await client.rpc('submit_dynamic_form',{
     p_token:token,p_version_id:data.version_id,p_answers:clean,p_submission_key:submissionKey,p_website:''
    });
    if(error)throw error;
    $('dynamic-public-host').innerHTML='<div class="panel"><h2>Thank you. Your form has been submitted.</h2><p>Your responses were recorded for '+esc(data.cohort)+'.</p><button id="dynamic-again" class="secondary-button">Submit another response</button></div>';
    $('dynamic-again').onclick=()=>{answers={};submissionKey=uuid();sending=false;renderPublic();};
    $('dynamic-public-status').textContent='';
   }catch(err){$('dynamic-public-status').textContent='Could not submit: '+err.message;$('dynamic-public-status').focus();sending=false;renderPublic();}
  }
  renderPublic();
 }
 window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
 return {publicMode,start,load,render};
}
