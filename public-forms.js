// Cohort-specific fixed reporting templates. All authorization is enforced in PostgreSQL.
import { readSessionReport } from './report-fields.js';
export function mountPublicForms(client, {esc, refresh, today}) {
 const $=id=>document.getElementById(id);
 const token=new URLSearchParams(location.hash.slice(1)).get('form');
 const publicMode=token!==null;
 let forms=[], cohortList=[], editing=null, submissionKey=crypto.randomUUID();
 document.querySelector('#nav').insertAdjacentHTML('beforeend','<button type="button" class="nav-link" data-page="forms" data-admin hidden>▤ Public forms</button>');
 document.querySelector('.content').insertAdjacentHTML('beforeend',`<section id="page-forms" class="page">
 <div class="heading-row"><div><div class="eyebrow">SUPER ADMIN</div><h1>Cohort public forms</h1><p>No volunteer account needed. Each form belongs permanently to one cohort.</p></div></div>
 <div class="panel report-form"><h2 id="public-editor-title">Create a reporting form</h2><p>Uses the PAL session report template. Do not request personal details about children.</p>
 <form id="public-form-editor" class="form-grid">
 <label>Cohort *<select name="cohort" required></select></label><label>Title *<input name="title" maxlength="120" required></label>
 <label class="span-2">Instructions<textarea name="description" maxlength="1000"></textarea></label>
 <label>Opens at *<input name="opens" type="datetime-local" required></label><label>Closes at *<input name="closes" type="datetime-local" required></label>
 <div class="span-2"><button class="primary-button" type="submit">Save form</button> <button class="secondary-button" id="public-editor-reset" type="button">New form</button></div></form>
 <p id="public-admin-message" role="status"></p>
 <div id="public-link-panel" hidden><label>New share link — copy and keep it now<input id="public-share-link" readonly></label><button type="button" id="public-copy-link" class="secondary-button">Copy link</button><p>Only the link hash is stored. Rotate the link to generate a replacement. Rotation immediately disables the old link.</p></div></div>
 <div id="public-forms-list" class="cohort-grid"></div></section>`);
 const editor=$('public-form-editor');
 const localDate=d=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
 function reset(){editing=null;editor.reset();editor.elements.cohort.disabled=false;$('public-editor-title').textContent='Create a reporting form';editor.elements.opens.value=localDate(new Date());editor.elements.closes.value=localDate(new Date(Date.now()+30*86400000));}
 function note(s){$('public-admin-message').textContent=s;}
 async function manage(args){const {data,error}=await client.rpc('manage_public_form',args);if(error)throw error;if(data.token){$('public-link-panel').hidden=false;$('public-share-link').value=location.origin+'/#form='+data.token;}return data;}
 editor.addEventListener('submit',async e=>{
  e.preventDefault();const b=e.submitter;b.disabled=true;note('');
  try{const f=editor.elements;await manage({p_action:editing?'edit':'create',p_id:editing,p_cohort_id:f.cohort.value,p_title:f.title.value.trim(),p_description:f.description.value,p_opens_at:new Date(f.opens.value).toISOString(),p_closes_at:new Date(f.closes.value).toISOString()});note(editing?'Form updated.':'Draft created. Copy the link, then publish the form below.');reset();await refresh();}catch(err){note(err.message);}finally{b.disabled=false;}
 });
 $('public-editor-reset').addEventListener('click',reset);
 $('public-copy-link').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('public-share-link').value);note('Link copied.');}catch{note('Select the link and copy it manually.');}});
 $('public-forms-list').addEventListener('click',async e=>{
  const b=e.target.closest('[data-form-action]');if(!b)return;const f=forms.find(f=>f.id===b.dataset.id);if(!f)return;
  const action=b.dataset.formAction;
  if(action==='edit'||action==='duplicate'){
   editing=action==='edit'?f.id:null;editor.elements.cohort.value=f.cohort_id;editor.elements.cohort.disabled=!!editing;
   editor.elements.title.value=f.title+(editing?'':' (copy)');editor.elements.description.value=f.description;
   editor.elements.opens.value=localDate(new Date(f.opens_at));editor.elements.closes.value=localDate(new Date(f.closes_at));
   $('public-editor-title').textContent=editing?'Edit reporting form':'Duplicate reporting form';editor.scrollIntoView({behavior:'smooth'});return;
  }
  b.disabled=true;try{await manage({p_action:action,p_id:f.id});note(action==='rotate'?'New link generated. The old link is disabled.':'Form status updated.');await refresh();}catch(err){note(err.message);}finally{b.disabled=false;}
 });
 reset();
 async function allRows(table,columns){let rows=[];for(let offset=0;;offset+=500){const {data,error}=await client.from(table).select(columns).order('id').range(offset,offset+499);if(error)throw error;rows.push(...data);if(data.length<500)return rows;}}
 async function load(){forms=await allRows('public_report_forms','id,cohort_id,title,description,status,opens_at,closes_at');return allRows('public_report_submissions','id,cohort_id,form_id,reporter_name,reporter_email,session_date,outcome,enrolled_count,attended_count,topic,progress,summary,challenges,next_steps,co_facilitators');}
 function render(cohorts){
  cohortList=cohorts;const prior=editor.elements.cohort.value;
  editor.elements.cohort.innerHTML='<option value="">Select one cohort</option>'+cohorts.map(c=>`<option value="${esc(c.id)}">${esc(c.programme)} / ${esc(c.name)}</option>`).join('');editor.elements.cohort.value=prior;
  $('public-forms-list').innerHTML=forms.map(f=>`<div class="cohort-card"><span class="badge-neutral">${esc(f.status)}</span><h3>${esc(f.title)}</h3><p>${esc(cohortList.find(c=>c.id===f.cohort_id)?.name)}</p><p>${esc(new Date(f.opens_at).toLocaleString())} – ${esc(new Date(f.closes_at).toLocaleString())}</p><div class="form-actions">${[['edit','Edit'],['duplicate','Duplicate'],['published','Publish'],['closed','Close'],['rotate','Replace link']].map(([a,label])=>`<button type="button" class="secondary-button" data-form-action="${a}" data-id="${esc(f.id)}">${label}</button>`).join('')}</div></div>`).join('')||'<p>No public forms yet.</p>';
 }
 async function start(){
  if(!publicMode)return;
  $('app').hidden=true;$('auth-page').hidden=true;$('password-page').hidden=true;
  document.body.insertAdjacentHTML('beforeend','<main id="public-report-page" class="public-report-page"><div class="eyebrow">VOLUNTEER REPORTING · PLAY & LEARN FOUNDATION</div><h1 id="public-title">Loading reporting form…</h1><p id="public-description"></p><p id="public-context"></p><p id="public-status" role="status" tabindex="-1"></p><section id="public-receipt" class="panel report-form" hidden aria-labelledby="public-receipt-title"><h2 id="public-receipt-title">Session report submitted</h2><div id="public-receipt-details"></div><button type="button" id="public-another-report" class="primary-button">Submit another session report</button></section><div id="public-report-host"></div></main>');
  const {data,error}=await client.rpc('get_public_form',{p_token:token});
  if(error||!data){$('public-title').textContent='Form unavailable';$('public-status').textContent='This link may be invalid, closed, expired or not yet open. Contact your PAL coordinator for a current link.';return;}
  $('public-title').textContent='Submit a session report';$('public-description').textContent='Capture what happened, who attended, and what comes next.';$('public-context').textContent=data.title+' · '+data.programme+' / '+data.cohort;
  const layout=$('report-form').closest('.form-layout').cloneNode(true);
  layout.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));
  const form=layout.querySelector('form');form.id='public-session-form';
  for(const [name,value] of [['programme',data.programme],['cohort',data.cohort]]){
   const select=form.elements[name],input=document.createElement('input');input.name=name;input.value=value;input.readOnly=true;select.replaceWith(input);
  }
  const guide=layout.querySelector('.tip-white ol');if(guide)guide.innerHTML='<li>Confirm the linked programme and cohort</li><li>Record attendance and outcomes</li><li>Summarise the session</li><li>Submit and review your confirmation</li>';
  if(data.description){const instructions=document.createElement('p');instructions.className='public-instructions';instructions.textContent=data.description;form.querySelector('.form-heading').after(instructions);}
  form.querySelector('.form-alert')?.remove();
  form.querySelector('.form-grid').insertAdjacentHTML('afterbegin','<label>Your name *<input name="reporter_name" maxlength="120" autocomplete="name" required></label><label>Your email *<input name="reporter_email" type="email" maxlength="254" autocomplete="email" required></label><label class="spam-field" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>');
  form.querySelector('.form-footer > span').textContent='Your name and email are self-reported and visible only to PAL Super Admins. No child-identifying details.';
  form.elements.date.value=today();$('public-report-host').append(layout);
  $('public-another-report').addEventListener('click',()=>{
   const name=form.elements.reporter_name.value,email=form.elements.reporter_email.value;
   form.reset();form.elements.reporter_name.value=name;form.elements.reporter_email.value=email;
   form.elements.programme.value=data.programme;form.elements.cohort.value=data.cohort;form.elements.date.value=today();
   submissionKey=crypto.randomUUID();$('public-receipt').hidden=true;layout.hidden=false;$('public-status').textContent='';form.querySelector('[type="submit"]').disabled=false;form.elements.date.focus();
  });
  form.addEventListener('submit',async e=>{
   e.preventDefault();const b=e.submitter;
   const f=new FormData(form),s=k=>String(f.get(k)||'').trim();
   let payload;try{payload={...readSessionReport(f),reporter_name:s('reporter_name'),reporter_email:s('reporter_email')};}catch(err){$('public-status').textContent=err.message;$('public-status').focus();return;}
   b.disabled=true;$('public-status').textContent='Submitting…';
   try{const {error}=await client.rpc('submit_public_report',{p_token:token,p_payload:payload,p_submission_key:submissionKey,p_website:s('website')});if(error)throw error;layout.hidden=true;$('public-status').textContent='Thank you. Your report was saved for '+data.cohort+'.';
    const date=new Intl.DateTimeFormat('en-GB',{dateStyle:'medium'}).format(new Date(payload.session_date+'T12:00:00'));
    const outcome={completed:'Completed',partial:'Partially completed',cancelled:'Cancelled'}[payload.outcome];
    $('public-receipt-details').innerHTML='<h3>'+esc(payload.topic)+'</h3><p>'+esc(data.programme)+' · '+esc(data.cohort)+'</p><p>'+esc(date)+' · '+esc(outcome)+'</p><p>Attendance: '+payload.attended_count+' of '+payload.enrolled_count+'</p>';
    $('public-receipt').hidden=false;$('public-status').focus();
   }catch(err){$('public-status').textContent='Could not submit: '+err.message;b.disabled=false;$('public-status').focus();}
  });
 }
 return {publicMode,start,load,render,allRows};
}
