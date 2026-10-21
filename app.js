import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';

// Browser-safe publishable key. Never put a Supabase secret/service_role key here.
const client = createClient('https://hjzeridpighstfzgnlvr.supabase.co','sb_publishable_Tx567ZnPPiJSY5jxoQgFaw_ae10I06t');
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = value => value ? new Intl.DateTimeFormat('en-GB',{dateStyle:'medium'}).format(new Date(`${value}T12:00:00`)) : '—';
const dateToday=()=>new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
const outcomeText={completed:'Completed',partial:'Partially completed',cancelled:'Cancelled'};
const progressText={on_track:'On track',needs_support:'Needs support',not_assessed:'Not assessed'};
const statusClass=s=>s==='completed'?'completed':s==='partial'?'partial':'cancelled';
const emoji=p=>p==='PAL Tech'?'💻':p==='Girl Empowerment'?'🌸':'📚';
const slug=p=>p==='PAL Tech'?'tech':p==='Girl Empowerment'?'girls':'library';
function accountInitials(name,email){
  const displayName=String(name||'').trim();
  const emailPrefix=String(email||'').split('@')[0]||'';
  const source=displayName||emailPrefix.replace(/[._-]+/g,' ');
  const words=source.split(/\s+/).map(x=>x.replace(/[^\p{L}\p{N}]/gu,'')).filter(Boolean);
  if(!words.length)return 'P';
  return words.length>1
    ? (words[0][0]+words[words.length-1][0]).toLocaleUpperCase().slice(0,2)
    : words[0].slice(0,2).toLocaleUpperCase();
}
function renderProfileShortcut(){
  if(!user||!profile)return;
  const displayName=profile.full_name?.trim()||user.user_metadata?.name?.trim()||profile.email||user.email||'PAL team member';
  const initials=accountInitials(displayName, user.email||profile.email);
  const role=profile.role==='super_admin'?'Super administrator':profile.role==='programme_admin'?'Programme administrator':'Volunteer';
  $('signed-in-name').textContent=displayName;
  $('signed-in-role').textContent=role;
  $('sidebar-avatar').textContent=initials;
  $('topbar-account-button').textContent=initials;
  for(const id of ['sidebar-account-button','topbar-account-button']){
    $(id).setAttribute('aria-label','Account settings for '+displayName+' ('+role+')');
    $(id).title='Account settings · '+displayName;
  }
}
let user=null, profile=null, programmes=[], cohorts=[], reports=[], people=[],memberships=[];
let activePage='dashboard', loading=false, refreshQueued=false;
const linkSetupMode = new URLSearchParams(location.search).get('setup');
const authFragmentType = new URLSearchParams(location.hash.slice(1)).get('type');
let passwordSetupPending = ['invite','recovery'].includes(linkSetupMode) || ['invite','recovery'].includes(authFragmentType);
function showPasswordSetup(){
  $('app').hidden=true;
  $('auth-page').hidden=true;
  $('password-page').hidden=false;
  $('password-title').textContent=linkSetupMode==='invite'||authFragmentType==='invite'?'Create your PAL Evaluation password':'Choose your new password';
}

function message(id,value,success=false){const el=$(id);el.hidden=!value;if(!value)return;el.textContent=value;el.classList.toggle('success',success)}
function go(page){if(['analytics','team'].includes(page)&&profile?.role!=='super_admin')return;activePage=page;document.querySelectorAll('.page').forEach(el=>el.classList.toggle('active',el.id==='page-'+page));document.querySelectorAll('.nav-link').forEach(el=>el.classList.toggle('active',el.dataset.page===page));$('page-breadcrumb').textContent=({dashboard:'Overview','new-report':'Submit report',reports:'Report history',cohorts:'Programmes & cohorts',analytics:'Evaluation & analytics',team:'Manage volunteers',account:'Account settings'})[page]||page;$('sidebar').classList.remove('mobile-open');render();window.scrollTo({top:0,behavior:'smooth'});}
function setVisibility(showApp=false){$('app').hidden=!showApp;$('auth-page').hidden=showApp;$('password-page').hidden=true;}
async function loadState(){
  if(loading){refreshQueued=true;return;}loading=true;
  try {
    const {data:{user:found},error:authError}=await client.auth.getUser();
    if(authError||!found){user=null;profile=null;setVisibility();return}
    user=found;
    if(passwordSetupPending){showPasswordSetup();return;}
    const prof=await client.from('profiles').select('id, email, full_name, role, active').eq('id',user.id).maybeSingle();
    if(prof.error)throw prof.error;
    profile=prof.data;
    if(!profile||!profile.active){setVisibility();message('login-alert','Your account is awaiting activation by a PAL administrator.');return}
    const admin=profile.role==='super_admin';
    document.querySelectorAll('[data-admin]').forEach(e=>e.hidden=!admin);
    $('add-cohort-button').hidden=!admin;
    renderProfileShortcut();
    $('today-text').textContent=new Intl.DateTimeFormat('en-GB',{dateStyle:'medium'}).format(new Date());
    let queries=[client.from('programmes').select('id,name,active').order('name'),client.from('cohorts').select('id,name,status,programme_id,description,start_date,end_date,leader_id,programmes(name)').order('name'),client.from('session_reports').select('id,cohort_id,reporter_id,session_date,outcome,enrolled_count,attended_count,topic,progress,summary,challenges,next_steps,co_facilitators,cohorts(name,programmes(name))').order('session_date',{ascending:false}).limit(1000)];
    if(admin)queries.push(client.from('profiles').select('id,email,full_name,role,active').order('created_at',{ascending:false}),client.from('cohort_members').select('cohort_id,user_id'));
    const result=await Promise.all(queries);
    const firstError=result.find(r=>r.error)?.error;if(firstError)throw firstError;
    programmes=result[0].data||[];
    cohorts=(result[1].data||[]).map(c=>({...c,programme:c.programmes?.name||'Unknown'}));
    reports=(result[2].data||[]).map(r=>({...r,programme:r.cohorts?.programmes?.name||'Unknown',cohort:r.cohorts?.name||'Unknown',date:r.session_date,attended:r.attended_count,enrolled:r.enrolled_count,volunteers:r.co_facilitators,nextSteps:r.next_steps}));
    people=admin?result[3].data||[]:[];
    memberships=admin?result[4].data||[]:[];
    setVisibility(true);render();
  } catch(err) {console.error(err);message('login-alert',`Could not load PAL data: ${err.message||'Unexpected error'}`);setVisibility();}
  finally{loading=false;if(refreshQueued){refreshQueued=false;setTimeout(()=>loadState(),0);}}
}
function renderDashboard(){
  const activeCohorts=cohorts.filter(c=>c.status==='active').length;
  const attended=reports.reduce((v,r)=>v+Number(r.attended||0),0);
  const stats=[['Active programmes',programmes.filter(p=>p.active).length,'Current initiatives','◈',''],['Active cohorts',activeCohorts,'Learning groups','♧','orange'],['Reports submitted',reports.length,'Submitted session reports','▤','blue'],['Session attendances',attended,'Aggregate attendance','✦','violet']];
  $('stats-grid').innerHTML=stats.map(([k,v,f,icon,color])=>`<div class="stat-card"><div class="stat-top"><span>${k}</span><span class="stat-icon ${color}">${icon}</span></div><div class="stat-value">${v}</div><div class="stat-footer">${f}</div></div>`).join('');
  $('recent-reports').innerHTML=reports.length?reports.slice(0,4).map(r=>`<div class="report-line"><div class="programme-icon ${slug(r.programme)}">${emoji(r.programme)}</div><div><div class="report-name">${esc(r.topic)}</div><div class="report-meta">${esc(r.programme)} · ${esc(r.cohort)}</div></div><div class="line-end"><span class="status ${statusClass(r.outcome)}">${esc(outcomeText[r.outcome]||r.outcome)}</span><small>${fmt(r.date)}</small></div></div>`).join(''):'<div class="empty">No session reports have been submitted yet.</div>';
  const max=Math.max(1,...programmes.map(p=>reports.filter(r=>r.programme===p.name).length));
  $('programme-pulse').innerHTML=programmes.map(p=>{const n=reports.filter(r=>r.programme===p.name).length;return `<div class="pulse-item"><div class="pulse-head"><strong>${esc(p.name)}</strong><span>${n} reports</span></div><div class="pulse-track"><div class="pulse-fill ${slug(p.name)}" style="width:${n/max*100}%"></div></div></div>`}).join('');
}
function renderReports(){const search=$('report-search').value.trim().toLowerCase(),filter=$('report-filter').value;
  const selected=reports.filter(r=>(!filter||r.programme===filter)&&[r.topic,r.cohort,r.volunteers,r.programme].join(' ').toLowerCase().includes(search));
  $('reports-tbody').innerHTML=selected.map(r=>`<tr><td><strong>${esc(r.topic)}</strong><small>${esc(r.cohort)}</small></td><td>${esc(r.programme)}</td><td>${fmt(r.date)}</td><td>${r.attended} / ${r.enrolled}</td><td><span class="status ${statusClass(r.outcome)}">${esc(outcomeText[r.outcome]||r.outcome)}</span></td><td><button class="view-link" data-detail="${esc(r.id)}">View ↗</button></td></tr>`).join('');$('reports-empty').hidden=selected.length>0;
}
function personName(id){const p=people.find(x=>x.id===id);return p?.full_name||p?.email||'Unassigned';}
function renderCohorts(){
 $('cohort-grid').innerHTML=cohorts.length?cohorts.map(c=>{
 const related=reports.filter(r=>r.cohort_id===c.id),assigned=memberships.filter(m=>m.cohort_id===c.id).map(m=>personName(m.user_id));
 return '<div class="cohort-card"><div class="cohort-top"><div class="programme-icon '+slug(c.programme)+'">'+emoji(c.programme)+'</div><span class="cohort-type">'+esc(c.status)+'</span></div><h3>'+esc(c.name)+'</h3><p>'+esc(c.programme)+'</p><div class="cohort-info"><span>Schedule</span><strong>'+fmt(c.start_date)+' – '+fmt(c.end_date)+'</strong></div><div class="cohort-info"><span>Leader</span><strong>'+esc(c.leader_id?personName(c.leader_id):'Not assigned')+'</strong></div><div class="cohort-info"><span>Team</span><strong>'+esc(profile.role==='super_admin'?(assigned.join(', ')||'Not assigned'):'Assigned cohort')+'</strong></div><div class="cohort-info"><span>Reports</span><strong>'+related.length+'</strong></div></div>'
 }).join(''):'<div class="empty-wide">No cohorts available yet. Create your first cohort.</div>';
}
function renderSelectors(){
 const p=$('programme-select').value;
 const allowed=programmes.filter(x=>x.active);
 $('programme-select').innerHTML='<option value="">Select programme</option>'+allowed.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join('');
 if(allowed.some(x=>x.id===p))$('programme-select').value=p;
 updateCohortSelect();
 const pool=$('cohort-form').elements.programme;const prior=pool.value;
 pool.innerHTML='<option value="">Select a programme</option>'+allowed.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join('');
 if(allowed.some(x=>x.id===prior))pool.value=prior;
 $('invite-cohort').innerHTML='<option value="">Assign later</option>'+cohorts.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.programme)+' / '+esc(c.name)+'</option>').join('');
 const leader=$('cohort-leader'),chosen=leader.value;
 leader.innerHTML='<option value="">No leader assigned yet</option>'+people.filter(p=>p.active).map(p=>'<option value="'+esc(p.id)+'">'+esc(p.full_name||p.email)+' ('+esc(p.role.replace('_',' '))+')</option>').join('');
 if(people.some(p=>p.id===chosen&&p.active))leader.value=chosen;
 renderStaffOptions();
 const selections=[['analytics-programme',programmes.map(p=>({id:p.name,label:p.name})),'All programmes'],['analytics-cohort',cohorts.map(c=>({id:c.id,label:c.programme+' / '+c.name})),'All cohorts'],['analytics-leader',people.filter(p=>p.active).map(p=>({id:p.id,label:p.full_name||p.email})),'All leaders']];
 for(const [id,items,defaultLabel] of selections){const el=$(id),value=el.value;el.innerHTML='<option value="">'+defaultLabel+'</option>'+items.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.label)+'</option>').join('');if(items.some(x=>x.id===value))el.value=value;}
}
let selectedStaff=new Set();
function renderStaffOptions(){
 const el=$('cohort-staff-options');if(!el)return;
 const q=$('cohort-staff-search').value.trim().toLowerCase();
 const matching=people.filter(p=>p.active&&((p.full_name||'')+' '+p.email).toLowerCase().includes(q));
 el.innerHTML=matching.length?matching.map(p=>'<label class="staff-choice"><input type="checkbox" data-staff-id="'+esc(p.id)+'" '+(selectedStaff.has(p.id)?'checked':'')+' /><span>'+esc(p.full_name||p.email)+' <small>'+esc(p.role.replace('_',' '))+'</small></span></label>').join(''):'<div class="empty">No matching active members. Invite someone first.</div>';
 $('cohort-staff-count').textContent=selectedStaff.size?selectedStaff.size+' selected':'No additional team members selected';
}
function updateCohortSelect(){const programId=$('programme-select').value,prior=$('cohort-select').value;const opts=cohorts.filter(c=>c.programme_id===programId&&c.status==='active');$('cohort-select').innerHTML='<option value="">Select cohort</option>'+opts.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');if(opts.some(c=>c.id===prior))$('cohort-select').value=prior}
function filteredAnalytics(){
 const programme=$('analytics-programme').value,cohort=$('analytics-cohort').value,leader=$('analytics-leader').value,outcome=$('analytics-outcome').value,progress=$('analytics-progress').value,period=$('analytics-period').value;
 let from=null,to=null;const today=dateToday();
 if(period==='custom'){from=$('analytics-from').value||null;to=$('analytics-to').value||null;}
 else if(period!=='all'){const d=new Date(today+'T12:00:00');d.setDate(d.getDate()-Number(period)+1);from=dateTodayFrom(d);to=today;}
 return reports.filter(r=>(!programme||r.programme===programme)&&(!cohort||r.cohort_id===cohort)&&(!leader||cohorts.find(c=>c.id===r.cohort_id)?.leader_id===leader)&&(!outcome||r.outcome===outcome)&&(!progress||r.progress===progress)&&(!from||r.date>=from)&&(!to||r.date<=to));
}
function dateTodayFrom(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function metricBar(name,value,max){return '<div class="analytics-bar-row"><strong>'+esc(name)+'</strong><div class="analytics-bar-track"><div class="analytics-bar-fill" style="width:'+(max?100*value/max:0)+'%"></div></div><span>'+value+'</span></div>';}
function renderAnalytics(){
 if(profile?.role!=='super_admin')return;
 $('analytics-custom-dates').hidden=$('analytics-period').value!=='custom';
 const from=$('analytics-from').value,to=$('analytics-to').value,invalid=$('analytics-period').value==='custom'&&from&&to&&from>to;
 message('analytics-filter-error',invalid?'The start date must be on or before the end date.':'');
 const subset=invalid?[]:filteredAnalytics(),sessions=subset.length,attendance=subset.reduce((n,r)=>n+Number(r.attended||0),0),enrolled=subset.reduce((n,r)=>n+Number(r.enrolled||0),0),completed=subset.filter(r=>r.outcome==='completed').length;
 $('analytics-summary').textContent=sessions+' session reports match the selected filters. Attendance is session check-ins, not unique children.';
 const stats=[['Sessions',sessions,'Reports in the selected range'],['Session check-ins',attendance,'Not unique participants'],['Attendance rate',enrolled?Math.round(100*attendance/enrolled)+'%':'—','Check-ins / enrolled places'],['Completion rate',sessions?Math.round(100*completed/sessions)+'%':'—','Completed sessions'],['Need support',subset.filter(r=>r.progress==='needs_support').length,'Session assessments'],['Active reporting cohorts',new Set(subset.map(r=>r.cohort_id)).size,'Distinct cohorts with reports']];
 $('analytics-stats').innerHTML=stats.map(([name,val,desc])=>'<div class="stat-card"><div class="stat-top">'+esc(name)+'</div><div class="stat-value">'+val+'</div><div class="stat-footer">'+esc(desc)+'</div></div>').join('');
 const pm=programmes.map(p=>({name:p.name,n:subset.filter(r=>r.programme===p.name).length}));$('analytics-bars').innerHTML=pm.map(p=>metricBar(p.name,p.n,Math.max(1,...pm.map(x=>x.n)))).join('');
 const os=[['Completed','completed'],['Partial','partial'],['Cancelled','cancelled']].map(([name,key])=>({name,n:subset.filter(r=>r.outcome===key).length}));
 $('analytics-outcomes').innerHTML=os.map(x=>metricBar(x.name,x.n,Math.max(1,...os.map(y=>y.n)))).join('');
 const ps=[['On track','on_track'],['Needs support','needs_support'],['Not assessed','not_assessed']].map(([name,key])=>({name,n:subset.filter(r=>r.progress===key).length}));
 $('analytics-progress-bars').innerHTML=ps.map(x=>metricBar(x.name,x.n,Math.max(1,...ps.map(y=>y.n)))).join('');
 const buckets=new Map();for(const r of subset){const d=new Date(r.date+'T12:00:00');let key;
 if($('analytics-granularity').value==='month'){key=r.date.slice(0,7)}
 else{d.setDate(d.getDate()-((d.getDay()+6)%7));key=dateTodayFrom(d);}
 buckets.set(key,(buckets.get(key)||0)+1);}
 const data=[...buckets].sort((a,b)=>a[0].localeCompare(b[0])).slice(-24),peak=Math.max(1,...data.map(x=>x[1]));
 $('analytics-trend').innerHTML=data.length?data.map(([key,n])=>'<div class="trend-col"><strong>'+n+'</strong><div class="trend-stick" style="height:'+Math.max(5,n/peak*110)+'px"></div><span>'+esc(key)+'</span></div>').join(''):'<div class="empty-wide">No reports for these filters.</div>';
 const cohortRows=cohorts.filter(c=>(!$('analytics-programme').value||c.programme===$('analytics-programme').value)&&(!$('analytics-cohort').value||c.id===$('analytics-cohort').value)&&(!$('analytics-leader').value||c.leader_id===$('analytics-leader').value)).map(c=>{const data=subset.filter(r=>r.cohort_id===c.id),att=data.reduce((n,r)=>n+Number(r.attended),0),en=data.reduce((n,r)=>n+Number(r.enrolled),0);return {c,data,att,en};}).filter(x=>x.data.length);
 $('analytics-cohort-tbody').innerHTML=cohortRows.map(x=>'<tr><td><strong>'+esc(x.c.name)+'</strong><small>'+esc(x.c.programme)+'</small></td><td>'+esc(x.c.leader_id?personName(x.c.leader_id):'Unassigned')+'</td><td>'+x.data.length+'</td><td>'+x.att+'</td><td>'+(x.en?Math.round(x.att/x.en*100)+'%':'—')+'</td><td>'+x.data.filter(r=>r.outcome==='completed').length+'</td></tr>').join('');
 $('analytics-empty').hidden=cohortRows.length>0;
}
function exportAnalytics(){const data=filteredAnalytics(),fields=['programme','cohort','date','topic','outcome','progress','enrolled','attended','summary','challenges','nextSteps'];
 const csv=[fields,...data.map(r=>fields.map(k=>r[k]??''))].map(row=>row.map(v=>'"'+String(v).replace(/^[=+\-@\t\r]/,"'$&").replace(/"/g,'""')+'"').join(',')).join('\r\n');
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='pal-evaluation-analytics.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function renderPeople(){if(profile?.role!=='super_admin')return;
  $('people-list').innerHTML=people.length?people.map(p=>`<div class="person-row"><div><strong>${esc(p.full_name||p.email)}</strong><small>${esc(p.email)} · ${esc(p.role.replace('_',' '))}</small></div><select data-membership="${esc(p.id)}" aria-label="Assign cohort"><option value="">${memberships.some(m=>m.user_id===p.id)?'Add another cohort':'Assign a cohort'}</option>${cohorts.map(c=>`<option value="${esc(c.id)}">${esc(c.programme)} / ${esc(c.name)}</option>`).join('')}</select><button class="secondary-button" data-toggle="${esc(p.id)}" ${p.id===user.id?'disabled':''}>${p.active?'Deactivate':'Activate'}</button></div>`).join(''):'<div class="empty-wide">No members have been invited.</div>';
}
function render(){renderDashboard();renderReports();renderCohorts();renderSelectors();renderAnalytics();renderPeople();renderAccount()}
function showDetail(id){const r=reports.find(x=>x.id===id);if(!r)return;
  const labels=[['Session date',fmt(r.date)],['Co-facilitators',r.volunteers||'None specified'],['Attendance',r.attended+' of '+r.enrolled],['Outcome',outcomeText[r.outcome]||r.outcome],['Learning progress',progressText[r.progress]||r.progress]];
  $('dialog-content').innerHTML=`<div class="eyebrow">SESSION REPORT</div><h2 class="dialog-title">${esc(r.topic)}</h2><div class="dialog-pill">${esc(r.programme)} · ${esc(r.cohort)}</div><div class="dialog-meta">${labels.map(([k,v])=>`<div><strong>${esc(k)}:</strong> ${esc(v)}</div>`).join('')}</div><div class="dialog-label">SUMMARY</div><p class="dialog-copy">${esc(r.summary)}</p><div class="dialog-label">CHALLENGES</div><p class="dialog-copy">${esc(r.challenges||'None recorded')}</p><div class="dialog-label">NEXT STEPS</div><p class="dialog-copy">${esc(r.nextSteps||'None recorded')}</p>`;$('details-dialog').showModal();
}
async function submitReport(e){e.preventDefault();const f=new FormData(e.currentTarget),en=Number(f.get('enrolled')),at=Number(f.get('attended'));
  if(!Number.isInteger(en)||!Number.isInteger(at)||en<0||at<0||at>en){message('form-alert','Attendance must be a whole number between zero and enrolment.');return}
  const button=e.submitter;button.disabled=true;
  try{const payload={cohort_id:f.get('cohort'),reporter_id:user.id,session_date:f.get('date'),outcome:f.get('outcome'),enrolled_count:en,attended_count:at,topic:String(f.get('topic')).trim(),progress:f.get('progress'),summary:String(f.get('summary')).trim(),challenges:String(f.get('challenges')).trim(),next_steps:String(f.get('nextSteps')).trim(),co_facilitators:String(f.get('volunteers')).trim()};const {error}=await client.from('session_reports').insert(payload);if(error)throw error;e.target.reset();$('session-date').value=dateToday();message('form-alert','Session report submitted successfully.',true);await loadState();go('reports')}
  catch(err){message('form-alert',`Could not submit: ${err.message||'Unexpected error'}`)}finally{button.disabled=false}
}
async function submitCohort(e){
 e.preventDefault();if(profile?.role!=='super_admin')return;
 const form=e.currentTarget,f=new FormData(form),start=f.get('start_date'),end=f.get('end_date');
 message('cohort-form-alert','');
 if(!start||!end||end<start){message('cohort-form-alert','End date must be on or after start date.');return;}
 const button=form.querySelector('[type="submit"]');button.disabled=true;
 try{
  const {error}=await client.rpc('create_cohort_with_staff',{p_programme_id:f.get('programme'),p_name:String(f.get('name')).trim(),p_description:String(f.get('description')||''),p_start_date:start,p_end_date:end,p_leader_id:f.get('leader_id')||null,p_other_user_ids:[...selectedStaff]});
  if(error)throw error;
  selectedStaff.clear();form.reset();$('cohort-staff-search').value='';$('cohort-add-panel').hidden=true;
  await loadState();go('cohorts');
 }catch(error){message('cohort-form-alert','Could not save cohort: '+error.message);}
 finally{button.disabled=false;}
}
function downloadCSV(){const fields=['id','programme','cohort','date','outcome','enrolled','attended','topic','progress','summary','challenges','nextSteps'],rows=[fields,...reports.map(r=>fields.map(k=>r[k]??''))],csv=rows.map(row=>row.map(v=>'"'+String(v).replace(/^[=+\-@\t\r]/,"'$&").replace(/"/g,'""')+'"').join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='pal-evaluation-reports.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
async function invite(e){e.preventDefault();const f=new FormData(e.target);message('invite-alert','');
  const {data,error}=await client.functions.invoke('invite-volunteer',{body:{email:String(f.get('email')).trim().toLowerCase(),full_name:String(f.get('name')).trim(),cohort_id:f.get('cohort_id')||null}});
  if(error||data?.error){message('invite-alert',`Invitation failed: ${data?.error||error?.message||'Service not configured'}`);return}
  message('invite-alert',`Invitation sent to ${f.get('email')}.`,true);e.target.reset();await loadState();go('team');
}
async function login(e){e.preventDefault();const f=new FormData(e.target);message('login-alert','');
  const {error}=await client.auth.signInWithPassword({email:String(f.get('email')).trim(),password:String(f.get('password'))});
  if(error){message('login-alert',error.message);return}await loadState();
}
async function firstAdminLink(){
  const email=String($('login-form').elements.email.value||'').trim().toLowerCase();
  const authorizedEmails=new Set(['nanakwasiohene@playandlearnfoundation.org','akdeljoseph@outlook.com']);
  if(!authorizedEmails.has(email)){
    message('login-alert','Enter a designated PAL Super Admin email address before requesting a setup link.');
    return;
  }
  const button=$('initial-admin-link');
  button.disabled=true;
  try{
    const {error}=await client.auth.signInWithOtp({
      email,
      options:{shouldCreateUser:true,emailRedirectTo:'https://pal-evaluation.vercel.app/'}
    });
    message('login-alert',error?'Could not send sign-in link: '+error.message:'Check your email for the secure PAL Evaluation sign-in link.',!error);
  }catch(error){
    message('login-alert','Could not send sign-in link: '+(error?.message||'Unexpected error'));
  }finally{
    button.disabled=false;
  }
}
async function forgot(){const email=$('login-form').elements.email.value.trim();if(!email){message('login-alert','Enter your email address first, then select Reset password.');return}
  const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:'https://pal-evaluation.vercel.app/?setup=recovery'});message('login-alert',error?`Could not send reset email: ${error.message}`:'If this account is registered, a password reset email will arrive shortly.',!error);
}
async function savePassword(e){
  e.preventDefault();
  const form=e.currentTarget;
  const data=new FormData(form);
  const password=String(data.get('password')||'');
  const confirm=String(data.get('confirm_password')||'');
  if(password.length<12){message('password-alert','Use a password of at least 12 characters.');return;}
  if(password!==confirm){message('password-alert','Passwords do not match.');return;}
  const submit=form.querySelector('button[type="submit"]');
  submit.disabled=true;
  try{
    const {data:{user:currentUser},error:sessionError}=await client.auth.getUser();
    if(sessionError||!currentUser){message('password-alert','This setup link has expired or is invalid. Request a new invitation or reset link.');return;}
    const {error}=await client.auth.updateUser({password});
    if(error){message('password-alert','Could not update your password: '+error.message);return;}
    passwordSetupPending=false;
    form.reset();
    history.replaceState({},'',location.pathname);
    message('password-alert','Your password has been saved successfully. You can now use email and password to sign in.',true);
    await loadState();
  }finally{submit.disabled=false;}
}

function renderAccount(){
  if(!user)return;
  $('account-current-email').value=user.email||profile?.email||'';
  const pending=String(user.new_email||'').trim();
  const note=$('email-pending-note');
  note.hidden=!pending;
  note.textContent=pending
    ? 'Pending email change: '+pending+'. Follow the verification instructions sent by Supabase to complete this change.'
    : '';
}
async function requestEmailChange(event){
  event.preventDefault();
  const form=event.currentTarget;
  const next=String(form.elements.new_email.value||'').trim().toLowerCase();
  const confirm=String(form.elements.confirm_email.value||'').trim().toLowerCase();
  message('email-change-alert','');
  if(!next||!form.elements.new_email.validity.valid){
    message('email-change-alert','Enter a valid new email address.');
    return;
  }
  if(next!==confirm){
    message('email-change-alert','The two email addresses do not match.');
    return;
  }
  const button=form.querySelector('[type="submit"]');
  button.disabled=true;
  try{
    const {data:{user:currentUser},error:authError}=await client.auth.getUser();
    if(authError||!currentUser){
      message('email-change-alert','Your session has expired. Sign in again and retry.');
      return;
    }
    if(next===String(currentUser.email||'').toLowerCase()){
      message('email-change-alert','This is already your current email address.');
      return;
    }
    const {error}=await client.auth.updateUser(
      {email:next},
      {emailRedirectTo:'https://pal-evaluation.vercel.app/'}
    );
    if(error)throw error;
    message('email-change-alert','Request received. Check your current and new email inboxes for verification messages. The change takes effect only after confirmation.',true);
    form.reset();
    const {data:{user:refreshed}}=await client.auth.getUser();
    if(refreshed){user=refreshed;renderAccount();}
  }catch(error){
    message('email-change-alert','Could not request the email change: '+(error?.message||'Unexpected error'));
  }finally{button.disabled=false;}
}
async function sendMyPasswordReset(){
  const button=$('account-reset-password');
  if(!user?.email){message('account-reset-alert','Please sign in again.');return;}
  button.disabled=true;
  try{
    const {error}=await client.auth.resetPasswordForEmail(user.email,{redirectTo:'https://pal-evaluation.vercel.app/?setup=recovery'});
    message('account-reset-alert',error?'Could not send password link: '+error.message:'If email delivery is working, a secure password reset link has been sent to your registered email.',!error);
  }finally{button.disabled=false;}
}
async function updateMember(event){const target=event.target,uid=target.dataset.toggle;
  if(uid){const p=people.find(x=>x.id===uid);if(!p||uid===user.id)return;const {error}=await client.from('profiles').update({active:!p.active}).eq('id',uid);if(error){alert(error.message);return}await loadState();go('team')}
  if(target.dataset.membership&&target.value){const {error}=await client.from('cohort_members').insert({user_id:target.dataset.membership,cohort_id:target.value});if(error){alert(error.code==='23505'?'Already assigned to this cohort.':error.message);return}await loadState();go('team')}
}
document.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.go)));
document.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.page)));
$('report-form').addEventListener('submit',submitReport);
$('cohort-form').addEventListener('submit',submitCohort);
$('programme-select').addEventListener('change',updateCohortSelect);
$('report-search').addEventListener('input',renderReports);
$('report-filter').addEventListener('change',renderReports);
$('analytics-programme').addEventListener('change',renderAnalytics);
$('analytics-period').addEventListener('change',renderAnalytics);
$('export-csv').addEventListener('click',downloadCSV);
$('add-cohort-button').addEventListener('click',()=>{$('cohort-add-panel').hidden=!$('cohort-add-panel').hidden});
$('cohort-form-cancel').addEventListener('click',()=>{$('cohort-add-panel').hidden=true});
$('cohort-staff-search').addEventListener('input',renderStaffOptions);
$('cohort-staff-options').addEventListener('change',e=>{const id=e.target.dataset.staffId;if(!id)return;e.target.checked?selectedStaff.add(id):selectedStaff.delete(id);renderStaffOptions();});
for(const id of ['analytics-programme','analytics-cohort','analytics-leader','analytics-outcome','analytics-progress','analytics-period','analytics-granularity','analytics-from','analytics-to'])$(id).addEventListener('change',renderAnalytics);
$('analytics-reset').addEventListener('click',()=>{for(const id of ['analytics-programme','analytics-cohort','analytics-leader','analytics-outcome','analytics-progress','analytics-from','analytics-to'])$(id).value='';$('analytics-period').value='30';$('analytics-granularity').value='week';renderAnalytics();});
$('analytics-export').addEventListener('click',exportAnalytics);
$('reports-tbody').addEventListener('click',e=>{const b=e.target.closest('[data-detail]');if(b)showDetail(b.dataset.detail)});
$('people-list').addEventListener('click',updateMember);
$('people-list').addEventListener('change',updateMember);
$('login-form').addEventListener('submit',login);
$('password-form').addEventListener('submit',savePassword);
$('invite-form').addEventListener('submit',invite);
$('change-email-form').addEventListener('submit',requestEmailChange);
$('account-reset-password').addEventListener('click',sendMyPasswordReset);
$('forgot-button').addEventListener('click',forgot);
$('initial-admin-link').addEventListener('click',firstAdminLink);
$('dialog-close').addEventListener('click',()=>$('details-dialog').close());
$('menu-button').addEventListener('click',()=>$('sidebar').classList.toggle('mobile-open'));
$('signout-button').addEventListener('click',async()=>{await client.auth.signOut();user=null;profile=null;setVisibility()});
$('session-date').value=dateToday();
client.auth.onAuthStateChange((event)=>{if(event==='PASSWORD_RECOVERY'){passwordSetupPending=true;showPasswordSetup();}else if(event==='SIGNED_OUT'){passwordSetupPending=false;setVisibility();}else if(event==='SIGNED_IN'){setTimeout(()=>loadState(),0);}});
loadState();