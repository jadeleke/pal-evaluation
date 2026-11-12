const fieldTypes = {
 text:'Short text', paragraph:'Paragraph', number:'Number', currency:'Currency amount',
 date:'Date', time:'Time', datetime:'Date and time', dropdown:'Dropdown', radio:'Single choice',
 checkbox:'Multiple choice', yesno:'Yes / No', rating:'Rating', scale:'Linear scale', email:'Email', phone:'Phone'
};
const choiceTypes = ['dropdown','radio','checkbox','yesno'];
const numericTypes = ['number','currency','rating','scale'];
const dateTypes = ['date','time','datetime'];
const id = () => crypto.randomUUID();
const question = (title='New question', type='text', required=false) => ({
 id:id(), title, type, required,
 ...(type==='yesno'?{options:['Yes','No']}:['dropdown','radio','checkbox'].includes(type)?{options:['Option 1','Option 2']}:{}),
 ...(['rating','scale'].includes(type)?{min:1,max:5}:{}),
 ...(type==='currency'?{currency:'GHS'}:{})
});
const section = (title='Section', questions=[]) => ({id:id(),title,questions});
const templates = {
 blank:['Blank custom form'],
 session:['Volunteer session report',['Session date','date'],['Session topic','text'],['Children enrolled','number'],['Children attended','number'],['Session outcome','radio'],['Progress assessment','radio'],['Session summary','paragraph'],['Challenges','paragraph'],['Next steps','paragraph']],
 training:['Training evaluation',['Training date','date'],['Was the training completed?','yesno'],['How useful was the training?','rating'],['What should we improve?','paragraph']],
 feedback:['Volunteer feedback',['How was your experience?','rating'],['What worked well?','paragraph'],['What support would help?','paragraph']],
 event:['Event registration',['Name','text'],['Email','email'],['Phone','phone']],
 programme:['Programme assessment',['Assessment date','date'],['Progress rating','scale'],['Outcomes observed','paragraph']],
 attendance:['Attendance report',['Session date','date'],['Expected participants','number'],['Participants present','number']],
 activity:['Activity evaluation',['Activity','text'],['Activity date','date'],['Was the activity completed?','yesno'],['Outcome rating','rating'],['Observations','paragraph']],
 survey:['General survey',['Your feedback','paragraph'],['Overall rating','rating']],
 children:['Children’s Programme Evaluation']
};
function template(key) {
 if(key==='children'){
  const age=question('What is your age range?','dropdown');
  age.options=['Under 10','10–12','13–15','16–17','18 or older','Prefer not to say'];
  const programme=question('Which programme did you participate in?','radio',true);
  programme.options=['YAGEP','BIG','PAL-TECH'];
  return {
   title:templates.children[0],
   description:'For participants in YAGEP, BIG and PAL-TECH. Please leave names, contact details and other identifying information out of your answers.',
   template:key,
   sections:[
    section('About your participation',[age,programme]),
    section('Your experience',[
     question('What were your expectations before joining the programme?','paragraph',true),
     question('How would you describe your experience with the programme?','paragraph',true),
     question('What did you enjoy most about the programme?','paragraph',true),
     question('What new things did you learn or gain from the programme?','paragraph',true)
    ]),
    section('Challenges and next steps',[
     question('What challenges or difficulties did you experience?','paragraph',true),
     question('What would you like us to improve or do differently in the next cohort?','paragraph',true),
     question('Would you like to take part in the next cohort? Why or why not?','paragraph',true)
    ])
   ]
  };
 }
 const [title,...fields]=templates[key];
 const questions=fields.map(([label,type])=>{
  const q=question(label,type,true);
  if(type==='number')q.min=0;
  if(label==='Session outcome')q.options=['Completed','Partially completed','Cancelled'];
  if(label==='Progress assessment')q.options=['On track','Needs support','Not assessed'];
  if(['Challenges','Next steps','Phone'].includes(label))q.required=false;
  return q;
 });
 return {title,description:'',template:key,sections:[section('Details',questions)]};
}
const visible = (item,answers) => !item.when || answers[item.when.id]===item.when.equals;
export function visibleAnswers(definition, answers) {
 const result={};
 for(const s of definition.sections){
  if(!visible(s,result))continue;
  for(const q of s.questions){
   if(visible(q,result)&&Object.hasOwn(answers,q.id))result[q.id]=answers[q.id];
  }
 }
 return result;
}

export function summarizeAnswers(q, rows) {
 const answers=rows.map(r=>r.answers[q.id]).filter(v=>v!==undefined);
 if(numericTypes.includes(q.type)&&answers.length){
  const total=answers.reduce((sum,value)=>sum+value,0);
  const min=answers.reduce((a,b)=>Math.min(a,b),Infinity);
  const max=answers.reduce((a,b)=>Math.max(a,b),-Infinity);
  const bins=new Map();
  const width=(max-min)/8;
  for(const value of answers){
   const index=width?Math.min(7,Math.floor((value-min)/width)):0;
   const label=q.type==='rating'||q.type==='scale'||!width?String(value):
    (min+index*width).toLocaleString('en-GH',{maximumFractionDigits:2})+'–'+(min+(index+1)*width).toLocaleString('en-GH',{maximumFractionDigits:2});
   bins.set(label,(bins.get(label)||0)+1);
  }
  return {count:answers.length,total,average:total/answers.length,min,max,bins};
 }
 const bins=new Map();
 if(choiceTypes.includes(q.type)||dateTypes.includes(q.type)){
  for(const answer of answers)for(const value of Array.isArray(answer)?answer:[answer]){
   const key=q.type==='datetime'?value.slice(0,10):value;
   bins.set(key,(bins.get(key)||0)+1);
  }
 }
 return {count:answers.length,bins};
}

export function mountDynamicForms(client, {esc}) {
 const get=id=>document.getElementById(id);
 const token=new URLSearchParams(location.hash.slice(1)).get('custom');
 const host=document.createElement('div');
 host.className='dynamic-forms';
 get('page-forms').querySelector('.heading-row').after(host);
 let cohorts=[],programmes=[],current=null,definition=null,dirty=false,offset=0,listLoaded=false,hasMore=false;
 let formRows=[];
 let programmeFilter='',cohortFilter='',overview={forms:0,published:0,responses:0};
 const rpc=async(name,args)=>{
  const {data,error}=await client.rpc(name,args);
  if(error)throw new Error(error.message);
  return data;
 };
 const admin=(action,args={})=>rpc('custom_admin',{p_action:action,...args});
 const option=(value,label,selected=false)=>'<option value="'+esc(value)+'"'+(selected?' selected':'')+'>'+esc(label)+'</option>';
 const cohortLabel=cohortId=>{
  if(!cohortId)return 'No cohort assigned';
  const cohort=cohorts.find(c=>c.id===cohortId);
  return cohort?cohort.programme+' · '+cohort.name:'Unavailable cohort';
 };
 const link=raw=>location.origin+location.pathname+'#custom='+raw;
 const message=value=>{host.querySelector('[data-builder-status]').textContent=value;};
 const input=(label,key,value,extra='')=>'<label>'+label+'<input data-key="'+key+'" value="'+esc(value??'')+'" '+extra+'></label>';
 const area=(label,key,value)=>'<label>'+label+'<textarea data-key="'+key+'" rows="2">'+esc(value??'')+'</textarea></label>';
 const button=(action,label,disabled=false)=>'<button type="button" class="'+(['new','publish'].includes(action)?'primary-button':'secondary-button')+'" data-builder="'+action+'"'+(disabled?' disabled':'')+'>'+label+'</button>';
 const actions=(actions)=>'<div class="builder-actions">'+actions.join('')+'</div>';
 const dt=value=>{const d=new Date(value);return new Date(+d-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
 const dateLabel=value=>new Date(value).toLocaleString();
 const announceChange=()=>{dirty=true;host.querySelector('[data-unsaved]').textContent='Unsaved changes';};
 const allowDiscard=()=>!dirty||confirm('Discard unsaved form changes?');
 window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
 host.innerHTML='<section class="panel builder-shell"><h2>Form Builder</h2><div class="builder-actions"><label>Template<select data-template>'+Object.entries(templates).map(([key,[title]])=>option(key,title)).join('')+'</select></label>'+button('new','New custom form')+'</div><p data-builder-status role="status"></p><div data-editor></div><div data-management></div><div data-insights></div></section>';
 const editor=host.querySelector('[data-editor]');
 const management=host.querySelector('[data-management]');
 const insights=host.querySelector('[data-insights]');
 async function loadList(){
  const scope={p_cohort:cohortFilter||null,p_definition:{programme:programmeFilter||null}};
  [formRows,overview]=await Promise.all([admin('list',{...scope,p_offset:offset}),admin('overview',scope)]);
  if(!formRows.length&&offset){offset=Math.max(0,offset-50);formRows=await admin('list',{...scope,p_offset:offset});}
  hasMore=formRows.length===50;
  listLoaded=true;
  drawList();
 }
 function drawList(){
  management.innerHTML='<h3>Custom forms</h3><div class="builder-grid"><label>Filter programme<select data-list-programme>'+option('','All programmes')+programmes.map(p=>option(p.id,p.name,p.id===programmeFilter)).join('')+'</select></label>'+
   '<label>Filter cohort<select data-list-cohort>'+option('','All cohorts')+cohorts.filter(c=>!programmeFilter||c.programme_id===programmeFilter).map(c=>option(c.id,cohortLabel(c.id),c.id===cohortFilter)).join('')+'</select></label></div>'+
   '<p>'+overview.forms+' forms · '+overview.published+' published · '+(overview.forms-overview.published)+' inactive · '+overview.responses+' responses</p>'+
   (formRows.length?'<div class="builder-card-grid">'+formRows.map(form=>{
    const live=form.status==='published';
    const controls=actions([button('edit','Edit'),live?button('copy','Copy link'):button('preview-saved','Preview'),button('responses','Responses')]);
    const extras=actions([
     ...(live?[button('preview-saved','Preview'),button('draft','Unpublish')]:[]),
     button('duplicate','Duplicate'),button('analytics','Analytics'),
     button('closed','Close',form.status==='closed'||form.status==='archived'),
     button('archived','Archive',form.status==='archived'),button('rotate','Replace link')
    ]);
    return '<article class="builder-form-card" data-form="'+esc(form.id)+'"><div class="builder-card-meta"><span class="builder-status-chip">'+esc(form.status)+(form.live_version?' · v'+form.live_version:'')+'</span><span>'+form.responses+' '+(form.responses===1?'response':'responses')+'</span></div>'+
     '<h4>'+esc(form.title)+'</h4><p>'+esc(cohortLabel(form.cohort_id))+'</p><small>'+esc(templates[form.template]?.[0]||'Custom form')+' · Updated '+esc(dateLabel(form.updated_at))+'</small>'+
     controls+'<details class="builder-more"><summary>More actions</summary>'+extras+'</details></article>';
   }).join('')+'</div>':'<p class="builder-empty">No forms in this view. Choose a template to create one.</p>')+
   (offset||hasMore?actions([button('previous','Previous',!offset),button('next','Next',!hasMore)]):'');
 }
 management.addEventListener('change',event=>{
  if(event.target.matches('[data-list-programme]')){
   programmeFilter=event.target.value;
   cohortFilter='';
  }else if(event.target.matches('[data-list-cohort]'))cohortFilter=event.target.value;
  else return;
  offset=0;
  insights.innerHTML='';
  loadList().catch(error=>message(error.message));
 });
 function ruleEditor(item,eligible){
  const choices=eligible.find(q=>q.id===item.when?.id)?.options||[];
  return '<div class="builder-grid"><label>Show when<select data-rule-source>'+option('','Always')+eligible.map(q=>option(q.id,q.title,q.id===item.when?.id)).join('')+'</select></label>'+
   (item.when?'<label>Answer equals<select data-rule-value>'+choices.map(v=>option(v,v,v===item.when.equals)).join('')+'</select></label>':'')+'</div>';
 }
 function drawEditor(){
  if(!definition){editor.innerHTML='';return;}
  const openSettings=new Set([...editor.querySelectorAll('[data-question-settings][open]')].map(details=>details.dataset.questionSettings));
  const eligible=[];
  const routing=current.id&&current.cohort_id&&!current.programme?'<p>Cohort · '+esc(cohortLabel(current.cohort_id))+'</p>':
   '<div class="builder-grid"><label>Programme<select data-programme>'+option('','Choose programme')+programmes.filter(p=>p.active).map(p=>option(p.id,p.name,p.id===current.programme)).join('')+'</select></label>'+
   '<label>Cohort<select data-cohort>'+option('','Choose cohort')+cohorts.filter(c=>c.programme_id===current.programme&&c.status==='active').map(c=>option(c.id,c.name,c.id===current.cohort_id)).join('')+'</select></label></div>';
  editor.innerHTML='<div class="builder-editor"><h3>'+ (current.id?'Edit form':'New form')+'</h3><p data-unsaved role="status">'+(dirty?'Unsaved changes':'')+'</p>'+routing+
   '<div data-definition>'+input('Form title','title',definition.title,'maxlength="120"')+area('Description','description',definition.description)+
   '<div class="builder-grid">'+input('Opens at (optional)','opens',definition.opens?dt(definition.opens):'','type="datetime-local"')+input('Closes at (optional)','closes',definition.closes?dt(definition.closes):'','type="datetime-local"')+'</div></div>'+
   definition.sections.map((s,si)=>{
    const rules=ruleEditor(s,eligible);
    const questions=s.questions.map((q,qi)=>{
     const rule=ruleEditor(q,eligible);
     if(!s.when&&!q.when&&q.required&&['dropdown','radio','yesno'].includes(q.type))eligible.push(q);
     return '<fieldset class="builder-question" data-question="'+qi+'"><legend>Question '+(qi+1)+'</legend>'+
      input('Question','title',q.title,'maxlength="200"')+
      '<div class="builder-grid"><label>Answer type<select data-key="type">'+Object.entries(fieldTypes).map(([k,v])=>option(k,v,k===q.type)).join('')+'</select></label>'+
      '<label class="builder-check"><input type="checkbox" data-key="required"'+(q.required?' checked':'')+'> Required</label></div>'+
      (choiceTypes.includes(q.type)&&q.type!=='yesno'?area('Options (one per line)','options',q.options?.join('\n')):'')+
      '<details class="builder-more" data-question-settings="'+esc(q.id)+'"'+(openSettings.has(q.id)||q.when?' open':'')+'><summary>Question settings</summary>'+
      area('Help text','description',q.description)+
      (['text','paragraph','email','phone','number','currency'].includes(q.type)?input('Placeholder','placeholder',q.placeholder,'maxlength="200"'):'')+
      (q.type==='currency'?input('Currency code','currency',q.currency,'maxlength="3"'):'')+
      (['text','paragraph',...numericTypes,...dateTypes].includes(q.type)?'<div class="builder-grid">'+
       input(['text','paragraph'].includes(q.type)?'Minimum characters':'Minimum','min',q.min,'type="'+(q.type==='datetime'?'datetime-local':dateTypes.includes(q.type)?q.type:'number')+'" step="any"')+
       input(['text','paragraph'].includes(q.type)?'Maximum characters':'Maximum','max',q.max,'type="'+(q.type==='datetime'?'datetime-local':dateTypes.includes(q.type)?q.type:'number')+'" step="any"')+'</div>':'')+rule+'</details>'+
      actions([button('q-up','Move up',!qi),button('q-down','Move down',qi===s.questions.length-1),button('q-copy','Duplicate'),button('q-delete','Delete question')])+'</fieldset>';
    }).join('');
    return '<fieldset class="builder-section" data-section="'+si+'"><legend>Section '+(si+1)+'</legend>'+
     input('Section heading','title',s.title,'maxlength="200"')+area('Section description','description',s.description)+rules+questions+
     actions([button('q-add','Add question'),button('s-up','Move section up',!si),button('s-down','Move section down',si===definition.sections.length-1),button('s-copy','Duplicate section'),button('s-delete','Delete section',definition.sections.length===1)])+'</fieldset>';
   }).join('')+'<div class="builder-editor-bar">'+actions([button('s-add','Add section'),button('preview','Preview'),button('save','Save draft'),button('publish','Publish'),button('cancel','Done')])+'</div></div>';
 }
 function itemFor(target){
  const s=target.closest('[data-section]');
  const q=target.closest('[data-question]');
  if(!s)return definition;
  const sec=definition.sections[Number(s.dataset.section)];
  return q?sec.questions[Number(q.dataset.question)]:sec;
 }
 function editorChange(event){
  const target=event.target;
  if(!definition)return;
  if(target.matches('[data-programme]')){
   current.programme=target.value;current.cohort_id='';announceChange();drawEditor();return;
  }
  if(target.matches('[data-cohort]')){current.cohort_id=target.value;announceChange();return;}
  const item=itemFor(target);
  const key=target.dataset.key;
  if(target.matches('[data-rule-source]')){
   const source=definition.sections.flatMap(s=>s.questions).find(q=>q.id===target.value);
   item.when=source?{id:source.id,equals:source.options[0]}:null;
  }else if(target.matches('[data-rule-value]'))item.when.equals=target.value;
  else if(key==='type'){
   const replacement=question(item.title,target.value,item.required);
   for(const k of ['options','min','max','currency'])delete item[k];
   Object.assign(item,{...replacement,id:item.id});
  }else if(key==='required')item.required=target.checked;
  else if(key==='options')item.options=target.value.split('\n').map(x=>x.trim()).filter(Boolean);
  else if(key==='opens'||key==='closes')item[key]=target.value?new Date(target.value).toISOString():null;
  else if(key==='min'||key==='max')item[key]=target.value?(dateTypes.includes(item.type)?target.value:Number(target.value)):null;
  else if(key==='currency')item.currency=target.value.toUpperCase();
  else if(key)item[key]=target.value;
  else return;
  announceChange();
  if(target.matches('[data-rule-source]')||['type','required'].includes(key))drawEditor();
 }
 editor.addEventListener('input',event=>{
  if(!event.target.matches('select,input[type="checkbox"]'))editorChange(event);
 });
 editor.addEventListener('change',event=>{
  if(event.target.matches('select,input[type="checkbox"]'))editorChange(event);
  else if(['title','options'].includes(event.target.dataset.key)){
   for(const select of editor.querySelectorAll('[data-rule-source]')){
    const selected=select.value;
    const item=itemFor(event.target);
    for(const opt of select.options)if(opt.value===item.id)opt.textContent=item.title;
    select.value=selected;
   }
   if(event.target.dataset.key==='options')for(const select of editor.querySelectorAll('[data-rule-value]')){
    const rule=itemFor(select).when;
    if(rule?.id===itemFor(event.target).id)select.innerHTML=itemFor(event.target).options.map(v=>option(v,v,v===rule.equals)).join('');
   }
  }
 });
 function copySection(s){
  const copy=structuredClone(s);
  const ids=new Map(s.questions.map(q=>[q.id,id()]));
  copy.id=id();
  copy.title+=' (copy)';
  for(const q of copy.questions){
   q.id=ids.get(q.id);
   if(q.when&&ids.has(q.when.id))q.when.id=ids.get(q.when.id);
  }
  return copy;
 }
 function manipulate(action,target){
  const si=Number(target.closest('[data-section]')?.dataset.section);
  const qi=Number(target.closest('[data-question]')?.dataset.question);
  const sec=definition.sections[si];
  if(action==='s-add')definition.sections.push(section());
  else if(action==='q-add')sec.questions.push(question());
  else {
   const list=action.startsWith('q-')?sec.questions:definition.sections;
   const index=action.startsWith('q-')?qi:si;
   const item=list[index];
   if(action.endsWith('-delete')){
    if(!confirm('Remove this item from the draft?'))return;
    list.splice(index,1);
    const removed=new Set([item.id,...(item.questions||[]).map(q=>q.id)]);
    for(const s of definition.sections)for(const candidate of [s,...s.questions])if(removed.has(candidate.when?.id))candidate.when=null;
   }
   if(action.endsWith('-copy'))list.splice(index+1,0,item.questions?copySection(item):{...structuredClone(item),id:id(),title:item.title+' (copy)'});
   if(action.endsWith('-up'))[list[index-1],list[index]]=[list[index],list[index-1]];
   if(action.endsWith('-down'))[list[index],list[index+1]]=[list[index+1],list[index]];
  }
  announceChange();drawEditor();
 }

 function renderRespondent(container,d,{preview=false,submit,context=''}={}){
  let key=id();
  let values={};
  const inputFor=q=>{
   const label=esc(q.title)+(q.required?' *':'');
   const attrs=' data-answer="'+esc(q.id)+'"';
   const placeholder=' placeholder="'+esc(q.placeholder||'')+'"';
   const help=q.description?'<p class="muted">'+esc(q.description)+'</p>':'';
   if(['radio','checkbox','yesno','rating','scale'].includes(q.type)){
    const scale=['rating','scale'].includes(q.type);
    const options=scale?Array.from({length:Math.max(0,Math.min(21,Number(q.max)-Number(q.min)+1))},(_,i)=>Number(q.min)+i):q.options||[];
    return '<fieldset data-visible="'+esc(q.id)+'"><legend>'+label+'</legend>'+help+options.map(value=>
     '<label class="builder-check"><input type="'+(q.type==='checkbox'?'checkbox':'radio')+'" name="'+esc(q.id)+'" value="'+esc(value)+'"'+attrs+
      (q.required&&q.type!=='checkbox'?' required':'')+'> '+esc(value)+'</label>').join('')+'</fieldset>';
   }
   const bounds=['min','max'].map(k=>q[k]==null?'':' '+k+'="'+esc(q[k])+'"').join('');
   const textBounds=' maxlength="'+esc(q.max??4000)+'"'+(q.min?' minlength="'+esc(q.min)+'"':'');
   const required=q.required?' required':'';
   let field;
   if(q.type==='dropdown')field='<select'+attrs+required+'>'+option('','Choose an answer')+(q.options||[]).map(v=>option(v,v)).join('')+'</select>';
   else if(q.type==='paragraph')field='<textarea rows="4"'+attrs+placeholder+required+textBounds+'></textarea>';
   else {
    const type={currency:'number',datetime:'datetime-local',phone:'tel'}[q.type]||q.type;
    field='<input type="'+type+'"'+attrs+placeholder+required+
     (q.type==='text'?textBounds:['number','currency',...dateTypes].includes(q.type)?bounds:'')+
     (['number','currency'].includes(q.type)?' step="any"':'')+({email:' maxlength="254"',phone:' maxlength="30"'}[q.type]||'')+'>';
   }
   return '<div data-visible="'+esc(q.id)+'"><label>'+label+(q.currency?' ('+esc(q.currency)+')':'')+field+'</label>'+help+'</div>';
  };
  container.innerHTML='<h1>'+esc(d.title)+'</h1><p>'+esc(context)+'</p><p class="builder-description">'+esc(d.description||'')+'</p>'+
   '<form class="report-form builder-response" novalidate>'+d.sections.map(s=>
    '<section class="panel builder-answer-section" data-visible="'+esc(s.id)+'"><h2>'+esc(s.title)+'</h2><p class="builder-description">'+esc(s.description||'')+'</p>'+
    s.questions.map(inputFor).join('')+'</section>').join('')+
   '<label class="spam-field" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label><p role="status" data-answer-status></p>'+
   (preview?'<button type="submit" class="primary-button">Check preview</button>':'<button type="submit" class="primary-button">Submit responses</button>')+'</form>';
  const form=container.querySelector('form');
  const status=form.querySelector('[data-answer-status]');
  const items=new Map(d.sections.flatMap(s=>[[s.id,s],...s.questions.map(q=>[q.id,q])]));
  function update(){
   values={};
   for(const field of form.querySelectorAll('[data-answer]')){
    if(['radio','checkbox'].includes(field.type)&&!field.checked||field.value==='')continue;
    const q=items.get(field.dataset.answer);
    if(q.type==='checkbox')(values[q.id]??=[]).push(field.value);
    else values[q.id]=numericTypes.includes(q.type)?Number(field.value):field.value.trim();
   }
   values=visibleAnswers(d,values);
   for(const node of form.querySelectorAll('[data-visible]')){
    const item=items.get(node.dataset.visible);
    node.hidden=!visible(item,values);
   }
   for(const field of form.querySelectorAll('[data-answer]'))field.disabled=Boolean(field.closest('[hidden]'));
  }
  form.addEventListener('input',update);
  update();
  form.addEventListener('submit',async event=>{
   event.preventDefault();update();
   if(!form.reportValidity())return;
   for(const s of d.sections){
    if(!visible(s,values))continue;
    const missing=s.questions.find(q=>q.required&&visible(q,values)&&(!Object.hasOwn(values,q.id)||values[q.id]===''));
    if(missing){status.textContent='Answer “'+missing.title+'” before submitting.';return;}
   }
   if(preview){status.textContent='Preview complete. Responses were not saved.';return;}
   const submitButton=event.submitter;
   submitButton.disabled=true;status.textContent='Submitting…';
   try{
    await submit(values,key,form.elements.website.value);
    const receipt=document.createElement('section');
    receipt.className='panel';receipt.tabIndex=-1;
    receipt.innerHTML='<h2>Response submitted</h2><p>Thank you. Your response was saved.</p>';
    form.replaceWith(receipt);receipt.focus();
   }catch(error){status.textContent=error.message;submitButton.disabled=false;}
  });
 }
 function preview(d,context){
  const dialog=document.createElement('dialog');
  dialog.className='builder-preview';
  const close=document.createElement('button');
  close.type='button';close.className='secondary-button';close.textContent='Close preview';
  close.onclick=()=>dialog.close();
  const body=document.createElement('div');
  dialog.append(close,body);document.body.append(dialog);
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  renderRespondent(body,d,{preview:true,context});
  dialog.showModal();
 }
 async function save(action){
  const cohortId=current.cohort_id||null;
  if(action==='publish'&&!cohortId)throw new Error('Choose a programme and cohort before publishing.');
  if(!current.id){
   current=await admin('create',{p_cohort:cohortId,p_definition:definition});
   dirty=false;
  }
  if(action==='publish'||dirty)current=await admin(action,{p_id:current.id,p_cohort:cohortId,p_revision:current.revision,p_definition:definition});
  dirty=false;
  drawEditor();
  if(action==='publish'){
   message('Published version '+current.live_version+'.');
   const share=document.createElement('input');
   share.readOnly=true;share.value=link(current.token);share.setAttribute('aria-label','Public form link');
   host.querySelector('[data-builder-status]').append(' ',share);
  }else message('Draft saved.');
  await loadList();
 }
 function download(name,headers,rows){
  const cell=value=>{
   let text=typeof value==='object'&&value!==null?JSON.stringify(value):String(value??'');
   if(typeof value!=='number'&&/^[\s\u0000-\u001f]*[=+@-]/.test(text))text="'"+text;
   return '"'+text.replaceAll('"','""')+'"';
  };
  const csv=[headers,...rows].map(row=>row.map(cell).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob(['\uFEFF',csv],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=name+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 async function showInsights(form,versions,mode){
  insights.innerHTML='<p role="status">Loading responses…</p>';
  const rows=[];
  for(let page=0;;page+=200){
   const batch=await admin('responses',{p_id:form.id,p_offset:page});
   rows.push(...batch);
   if(batch.length<200)break;
  }
  insights.innerHTML='<h3>'+esc(form.draft.title)+' · '+(mode==='analytics'?'Analytics':'Responses')+'</h3><p>'+esc(cohortLabel(form.cohort_id))+'</p>'+
   '<div class="builder-grid"><label>Version<select data-filter-version>'+option('','All versions')+versions.map(v=>option(v.version,'Version '+v.version)).join('')+'</select></label>'+
   '<label>Question<select data-filter-question></select></label><label>From<input type="date" data-filter-from></label><label>To<input type="date" data-filter-to></label></div>'+
   '<div class="builder-actions"><button type="button" class="secondary-button" data-export-rows>Export responses</button><button type="button" class="secondary-button" data-export-summary>Export summary</button></div><div data-results></div>';
  const find=selector=>insights.querySelector(selector);
  const dateFor=row=>row.submitted_at.slice(0,10);
  let filtered=[], columns=[], summary=[];
  const chart=(bins,count)=>'<ul class="builder-distribution">'+Array.from(bins,([label,n])=>'<li><span>'+esc(label)+'</span> <meter min="0" max="'+Math.max(1,count)+'" value="'+n+'"></meter> <span>'+n+' ('+Math.round(n/Math.max(count,1)*100)+'%)</span></li>').join('')+'</ul>';
  function draw(){
   const version=find('[data-filter-version]').value;
   const questionSelect=find('[data-filter-question]');
   const selected=questionSelect.value;
   const from=find('[data-filter-from]').value,to=find('[data-filter-to]').value;
   const scope=versions.filter(v=>!version||v.version===Number(version));
   const questions=scope.flatMap(v=>v.definition.sections.flatMap(s=>s.questions.map(q=>({q,version:v.version,key:v.version+':'+q.id}))));
   questionSelect.innerHTML=option('','All questions')+questions.map(c=>option(c.key,'v'+c.version+' · '+c.q.title,c.key===selected)).join('');
   columns=questions.filter(c=>!questionSelect.value||c.key===questionSelect.value);
   filtered=rows.filter(r=>(!version||r.version===Number(version))&&(!from||dateFor(r)>=from)&&(!to||dateFor(r)<=to)&&
    (!questionSelect.value||columns.some(c=>c.version===r.version&&Object.hasOwn(r.answers,c.q.id))));
   const trend=new Map();
   for(const row of [...filtered].reverse()){const day=dateFor(row);trend.set(day,(trend.get(day)||0)+1);}
   let comparison='';
   if(from&&to&&from<=to){
    const days=(Date.parse(to)-Date.parse(from))/86400000+1;
    const prior=new Date(Date.parse(from)-days*86400000).toISOString().slice(0,10);
    const previous=rows.filter(r=>(!version||r.version===Number(version))&&dateFor(r)>=prior&&dateFor(r)<from&&
     (!questionSelect.value||columns.some(c=>c.version===r.version&&Object.hasOwn(r.answers,c.q.id)))).length;
    comparison='<p>Previous '+days+' days · '+previous+' responses</p>';
   }
   summary=[];
   const cards=columns.map(({q,version})=>{
    const m=summarizeAnswers(q,filtered.filter(r=>r.version===version));
    summary.push([version,q.title,'Answers',m.count,'']);
    const units=q.currency?' '+esc(q.currency):'';
    const num=n=>n.toLocaleString('en-GH',{maximumFractionDigits:2})+units;
    if(m.total!==undefined)for(const [name,n] of [['Total',m.total],['Average',m.average],['Minimum',m.min],['Maximum',m.max]])summary.push([version,q.title,name,n,q.currency||'']);
    for(const [label,n] of m.bins)summary.push([version,q.title,label,n,m.count?Math.round(n/m.count*100)+'%':'']);
    return '<section class="builder-question"><h4>'+esc(q.title)+' · v'+version+'</h4><p>'+m.count+' answers</p>'+
     (m.total!==undefined?'<p>Total '+num(m.total)+' · Average '+num(m.average)+' · Range '+num(m.min)+' to '+num(m.max)+'</p>':'')+
     (m.bins.size?chart(m.bins,m.count):'')+'</section>';
   }).join('');
   const responseTable='<div class="builder-table"><table><thead><tr><th>Submitted</th><th>Version</th><th>Answers</th></tr></thead><tbody>'+
    filtered.slice(0,100).map(row=>'<tr><td>'+esc(dateLabel(row.submitted_at))+'</td><td>'+row.version+'</td><td><dl>'+
     columns.filter(c=>c.version===row.version&&Object.hasOwn(row.answers,c.q.id)).map(c=>'<dt>'+esc(c.q.title)+'</dt><dd>'+esc(Array.isArray(row.answers[c.q.id])?row.answers[c.q.id].join(', '):row.answers[c.q.id])+'</dd>').join('')+'</dl></td></tr>').join('')+'</tbody></table></div>';
   find('[data-results]').innerHTML='<p><strong>'+filtered.length+' responses</strong></p>'+comparison+
    (!filtered.length?'<p>No submissions match these filters.</p>':mode==='analytics'?'<h4>Submission trend</h4>'+chart(trend,filtered.length)+cards:
     (filtered.length>100?'<p>Showing the latest 100. Export includes all matching responses.</p>':'')+responseTable);
  }
  insights.onchange=draw;
  find('[data-export-rows]').onclick=()=>download('pal-form-responses',['Submitted at','Version',...columns.map(c=>'v'+c.version+' · '+c.q.title)],filtered.map(r=>[r.submitted_at,r.version,...columns.map(c=>c.version===r.version?r.answers[c.q.id]:'')]));
  find('[data-export-summary]').onclick=()=>download('pal-form-summary',['Version','Question','Metric','Value','Unit or percentage'],summary);
  draw();
  insights.scrollIntoView({block:'start'});
 }
 host.addEventListener('click',async event=>{
  const target=event.target.closest('[data-builder]');
  if(!target)return;
  const action=target.dataset.builder;
  if(action.startsWith('q-')||action.startsWith('s-')){manipulate(action,target);return;}
  if(action==='new'||action==='cancel'){
   if(!allowDiscard())return;
   current=action==='new'?{}:null;
   definition=current?template(host.querySelector('[data-template]').value):null;
   dirty=Boolean(current);drawEditor();message('');
   if(current)editor.querySelector('[data-key=title]')?.focus();
   return;
  }
  if(action==='preview'){preview(definition,cohortLabel(current.cohort_id));return;}
  if(['edit','duplicate'].includes(action)&&!allowDiscard())return;
  if(['draft','closed','archived','rotate'].includes(action)&&!confirm({
   draft:'Unpublish this form and stop accepting responses?',
   closed:'Close this form and stop accepting responses?',
   archived:'Archive this form and stop accepting responses?',
   rotate:'Replace this link? The existing link will stop working.'
  }[action]))return;
  target.disabled=true;
  host.inert=true;
  try{
   if(action==='previous'||action==='next'){offset+=action==='next'?50:-50;await loadList();return;}
   if(action==='save'||action==='publish'){await save(action);return;}
   const formId=target.closest('[data-form]').dataset.form;
   const {form,versions}=await admin('get',{p_id:formId});
   if(action==='edit'||action==='duplicate'){
    current=action==='edit'?form:{cohort_id:form.cohort_id,programme:cohorts.find(c=>c.id===form.cohort_id)?.programme_id};
    definition=structuredClone(form.draft);
    if(action==='duplicate')definition.title=(definition.title+' (copy)').slice(0,120);
    dirty=action==='duplicate';drawEditor();editor.scrollIntoView({block:'start'});message('');return;
   }
   if(action==='preview-saved'){preview(form.draft,cohortLabel(form.cohort_id));return;}
   if(action==='responses'||action==='analytics'){await showInsights(form,versions,action);return;}
   if(action==='copy'){
    const url=link(form.token);
    message('Public form link');
    const share=document.createElement('input');share.readOnly=true;share.value=url;share.setAttribute('aria-label','Public form link');
    host.querySelector('[data-builder-status]').append(' ',share);
    try{await navigator.clipboard.writeText(url);message('Link copied.');}catch{share.select();}
    return;
   }
   const updated=await admin(action,{p_id:form.id,p_revision:form.revision});
   if(current?.id===updated.id&&current.revision===form.revision)current=updated;
   message(action==='rotate'?'Link replaced. Use Copy link to share it.':'Form status updated.');
   await loadList();
  }catch(error){message(error.message);host.querySelector('[data-builder-status]').scrollIntoView({block:'nearest'});}finally{target.disabled=false;host.inert=false;}
 });
 return {
  publicMode:token!==null,
  render(newCohorts,newProgrammes){
   cohorts=newCohorts;programmes=newProgrammes;
   if(!listLoaded)loadList().catch(error=>message(error.message));
   else drawList();
  },
  async start(){
   for(const id of ['app','auth-page','password-page'])get(id).hidden=true;
   const page=document.createElement('main');
   page.className='public-report-page dynamic-public';
   page.textContent='Loading form…';
   document.body.append(page);
   try{
    const data=await rpc('custom_public',{p_token:token});
    if(!data){page.innerHTML='<h1>Form unavailable</h1><p>Contact your PAL coordinator for a current link.</p>';return;}
    renderRespondent(page,data.definition,{context:data.programme+' · '+data.cohort,
     submit:(answers,key,website)=>rpc('custom_submit',{p_token:token,p_version:data.version,p_answers:answers,p_key:key,p_website:website})});
   }catch{page.textContent='Could not load the form. Refresh to try again.';}
  }
 };
}
