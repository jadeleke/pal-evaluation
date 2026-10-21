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
let user=null, profile=null, programmes=[], cohorts=[], reports=[], people=[],memberships=[];
let activePage='dashboard', loading=false;
function message(id,value,success=false){const el=$(id);el.hidden=!value;if(!value)return;el.textContent=value;el.classList.toggle('success',success)}
function go(page){if(['analytics','team'].includes(page)&&profile?.role!=='super_admin')return;activePage=page;document.querySelectorAll('.page').forEach(el=>el.classList.toggle('active',el.id==='page-'+page));document.querySelectorAll('.nav-link').forEach(el=>el.classList.toggle('active',el.dataset.page===page));$('page-breadcrumb').textContent=({dashboard:'Overview','new-report':'Submit report',reports:'Report history',cohorts:'Programmes & cohorts',analytics:'Evaluation & analytics',team:'Manage volunteers'})[page]||page;$('sidebar').classList.remove('mobile-open');render();window.scrollTo({top:0,behavior:'smooth'});}
function setVisibility(showApp=false){$('app').hidden=!showApp;$('auth-page').hidden=showApp;$('password-page').hidden=true;}
async function loadState(){
  if(loading)return;loading=true;
  try {
    const {data:{user:found},error:authError}=await client.auth.getUser();
    if(authError||!found){user=null;profile=null;setVisibility();return}
    user=found;
    const prof=await client.from('profiles').select('id, email, full_name, role, active').eq('id',user.id).maybeSingle();
    if(prof.error)throw prof.error;
    profile=prof.data;
    if(!profile||!profile.active){setVisibility();message('login-alert','Your account is awaiting activation by a PAL administrator.');return}
    const admin=profile.role==='super_admin';
    document.querySelectorAll('[data-admin]').forEach(e=>e.hidden=!admin);
    $('add-cohort-button').hidden=!admin;
    $('signed-in-name').textContent=profile.full_name||profile.email;
    $('signed-in-role').textContent=admin?'Super administrator':profile.role==='programme_admin'?'Programme administrator':'Volunteer';
    $('today-text').textContent=new Intl.DateTimeFormat('en-GB',{dateStyle:'medium'}).format(new Date());
    let queries=[client.from('programmes').select('id,name,active').order('name'),client.from('cohorts').select('id,name,status,programme_id,programmes(name)').order('name'),client.from('session_reports').select('id,cohort_id,reporter_id,session_date,outcome,enrolled_count,attended_count,topic,progress,summary,challenges,next_steps,co_facilitators,cohorts(name,programmes(name))').order('session_date',{ascending:false}).limit(1000)];
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
  finally{loading=false}
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
function renderCohorts(){
  $('cohort-grid').innerHTML=cohorts.length?cohorts.map(c=>{const related=reports.filter(r=>r.cohort_id===c.id),assigned=memberships.filter(m=>m.cohort_id===c.id).map(m=>people.find(p=>p.id===m.user_id)?.full_name||people.find(p=>p.id===m.user_id)?.email).filter(Boolean);return `<div class="cohort-card"><div class="cohort-top"><div class="programme-icon ${slug(c.programme)}">${emoji(c.programme)}</div><span class="cohort-type">${esc(c.status)}</span></div><h3>${esc(c.name)}</h3><p>${esc(c.programme)}</p><div class="cohort-info"><span>Assigned volunteers</span><strong>${esc(profile.role==='super_admin'?assigned.join(', ')||'Not assigned':'Assigned cohort')}</strong></div><div class="cohort-info"><span>Reports received</span><strong>${related.length}</strong></div></div>`}).join(''):'<div class="empty-wide">No cohorts are available yet. A super administrator can create and assign them.</div>';
}
function renderSelectors(){
  const p=$('programme-select').value;
  const allowed=programmes.filter(x=>x.active);
  const base=`<option value="">Select programme</option>`+allowed.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
  $('programme-select').innerHTML=base;if(allowed.some(x=>x.id===p))$('programme-select').value=p;
  updateCohortSelect();
  const pool=$('cohort-form').elements.programme;
  if(pool){pool.innerHTML=allowed.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');}
  const select=$('invite-cohort');
  if(select)select.innerHTML='<option value="">Assign later</option>'+cohorts.map(c=>`<option value="${esc(c.id)}">${esc(c.programme)} / ${esc(c.name)}</option>`).join('');
  const chosen=$('analytics-programme').value;
  $('analytics-programme').innerHTML='<option value="">All programmes</option>'+programmes.map(p=>`<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');
  $('analytics-programme').value=chosen;
}
function updateCohortSelect(){const programId=$('programme-select').value,prior=$('cohort-select').value;const opts=cohorts.filter(c=>c.programme_id===programId&&c.status==='active');$('cohort-select').innerHTML='<option value="">Select cohort</option>'+opts.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');if(opts.some(c=>c.id===prior))$('cohort-select').value=prior}
function renderAnalytics(){if(profile?.role!=='super_admin')return;
  const program=$('analytics-programme').value,period=$('analytics-period').value,now=Date.now();
  const subset=reports.filter(r=>(!program||r.programme===program)&&(period==='all'||new Date(r.date+'T12:00:00').getTime()>=now-Number(period)*86400000));
  const sessions=subset.length,attendance=subset.reduce((n,r)=>n+r.attended,0),enrolled=subset.reduce((n,r)=>n+r.enrolled,0);
  const stats=[['Sessions',sessions,'In selected period'],['Attendance',attendance,'Total check-ins'],['Attendance rate',enrolled?Math.round(100*attendance/enrolled)+'%':'—','Of enrolled places'],['Completed',sessions?Math.round(100*subset.filter(r=>r.outcome==='completed').length/sessions)+'%':'—','Of session reports']];
  $('analytics-stats').innerHTML=stats.map(([name,val,desc])=>`<div class="stat-card"><div class="stat-top">${name}</div><div class="stat-value">${val}</div><div class="stat-footer">${desc}</div></div>`).join('');
  const counts=programmes.map(p=>({name:p.name,count:subset.filter(r=>r.programme===p.name).length})),max=Math.max(1,...counts.map(x=>x.count));
  $('analytics-bars').innerHTML=counts.map(c=>`<div class="analytics-bar-row"><strong>${esc(c.name)}</strong><div class="analytics-bar-track"><div class="analytics-bar-fill" style="width:${100*c.count/max}%"></div></div><span>${c.count}</span></div>`).join('');
  const weeks=new Map();for(const r of subset){const d=new Date(r.date+'T12:00:00');const day=d.getDay();d.setDate(d.getDate()-((day+6)%7));const week=d.toISOString().slice(0,10);weeks.set(week,(weeks.get(week)||0)+1)};
  const ordered=[...weeks.entries()].sort((a,b)=>a[0].localeCompare(b[0])).slice(-12),peak=Math.max(1,...ordered.map(x=>x[1]));
  $('analytics-trend').innerHTML=ordered.length?ordered.map(([week,count])=>`<div class="trend-col"><strong>${count}</strong><div class="trend-stick" style="height:${Math.max(5,count/peak*110)}px"></div><span>${fmt(week).replace(/\s\d{4}$/, '')}</span></div>`).join(''):'<div class="empty-wide">No reports in this period.</div>';
}
function renderPeople(){if(profile?.role!=='super_admin')return;
  $('people-list').innerHTML=people.length?people.map(p=>`<div class="person-row"><div><strong>${esc(p.full_name||p.email)}</strong><small>${esc(p.email)} · ${esc(p.role.replace('_',' '))}</small></div><select data-membership="${esc(p.id)}" aria-label="Assign cohort"><option value="">${memberships.some(m=>m.user_id===p.id)?'Add another cohort':'Assign a cohort'}</option>${cohorts.map(c=>`<option value="${esc(c.id)}">${esc(c.programme)} / ${esc(c.name)}</option>`).join('')}</select><button class="secondary-button" data-toggle="${esc(p.id)}" ${p.id===user.id?'disabled':''}>${p.active?'Deactivate':'Activate'}</button></div>`).join(''):'<div class="empty-wide">No members have been invited.</div>';
}
function render(){renderDashboard();renderReports();renderCohorts();renderSelectors();renderAnalytics();renderPeople()}
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
async function submitCohort(e){e.preventDefault();if(profile?.role!=='super_admin')return;const f=new FormData(e.target);
  const {error}=await client.from('cohorts').insert({programme_id:f.get('programme'),name:String(f.get('name')).trim()});
  if(error){alert(`Could not create cohort: ${error.message}`);return}e.target.reset();$('cohort-add-panel').hidden=true;await loadState();go('cohorts');
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
      options:{shouldCreateUser:true,emailRedirectTo:'https://pal-evaluation-gh.vercel.app/'}
    });
    message('login-alert',error?'Could not send sign-in link: '+error.message:'Check your email for the secure PAL Evaluation sign-in link.',!error);
  }catch(error){
    message('login-alert','Could not send sign-in link: '+(error?.message||'Unexpected error'));
  }finally{
    button.disabled=false;
  }
}
async function forgot(){const email=$('login-form').elements.email.value.trim();if(!email){message('login-alert','Enter your email address first, then select Reset password.');return}
  const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin});message('login-alert',error?`Could not send reset email: ${error.message}`:'If this account is registered, a password reset email will arrive shortly.',!error);
}
async function savePassword(e){e.preventDefault();const val=new FormData(e.target).get('password');const {error}=await client.auth.updateUser({password:String(val)});if(error){message('password-alert',error.message);return}message('password-alert','Password saved successfully.',true);await loadState()}
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
$('reports-tbody').addEventListener('click',e=>{const b=e.target.closest('[data-detail]');if(b)showDetail(b.dataset.detail)});
$('people-list').addEventListener('click',updateMember);
$('people-list').addEventListener('change',updateMember);
$('login-form').addEventListener('submit',login);
$('password-form').addEventListener('submit',savePassword);
$('invite-form').addEventListener('submit',invite);
$('forgot-button').addEventListener('click',forgot);
$('initial-admin-link').addEventListener('click',firstAdminLink);
$('dialog-close').addEventListener('click',()=>$('details-dialog').close());
$('menu-button').addEventListener('click',()=>$('sidebar').classList.toggle('mobile-open'));
$('signout-button').addEventListener('click',async()=>{await client.auth.signOut();user=null;profile=null;setVisibility()});
$('session-date').value=dateToday();
client.auth.onAuthStateChange((event)=>{if(event==='PASSWORD_RECOVERY'){$('app').hidden=true;$('auth-page').hidden=true;$('password-page').hidden=false}else if(event==='SIGNED_OUT'){setVisibility()}});
loadState();