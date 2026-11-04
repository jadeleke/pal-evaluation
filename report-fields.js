// Shared by signed-in and public volunteers so report fields and validation agree.
export function readSessionReport(fields) {
 const text=key=>String(fields.get(key)||'').trim();
 const enrolled=Number(fields.get('enrolled')),attended=Number(fields.get('attended'));
 if(!text('enrolled')||!text('attended')||!Number.isInteger(enrolled)||!Number.isInteger(attended)||enrolled<0||enrolled>5000||attended<0||attended>enrolled){
  throw new Error('Attendance must be a whole number between zero and enrolment (maximum 5,000).');
 }
 return {session_date:text('date'),outcome:text('outcome'),enrolled_count:enrolled,attended_count:attended,topic:text('topic'),progress:text('progress'),summary:text('summary'),challenges:text('challenges'),next_steps:text('nextSteps'),co_facilitators:text('volunteers')};
}
