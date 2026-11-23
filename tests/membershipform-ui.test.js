// Members can edit Join CSS questions after unlocking Settings. Fake browser only.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
let failures = 0;
const ok = (condition, name) => { console.log((condition ? "PASS " : "FAIL ") + name); if (!condition) failures++; };
function browser() {
  const elements = {};
  const element = (id) => elements[id] || (elements[id] = { value: "", innerHTML: "", textContent: "", hidden: false, disabled: false, open: false, style: {}, addEventListener() {}, focus() {}, showModal() { this.open = true; }, close() { this.open = false; } });
  let context;
  context = vm.createContext({ console, Set, URL, Blob, state: {role:"admin"}, rows: [], requests: [], confirmations: 0, toasts: [], errors: [], $: element, escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }, document: {querySelectorAll(selector) { return selector === "#membership-form-questions [data-mf-question]" ? context.rows : []; }}, openAdminDialog() { context.confirmations++; }, showToast(message) { context.toasts.push(message); }, handleEventError(reply) { context.errors.push(reply); }, errorText(reply) { return reply.message || reply.error; }, api: async(action,details) => { context.requests.push({action,details}); return context.nextReply; }, setTimeout() {} });
  const run = (code) => vm.runInContext(code, context);
  run(fs.readFileSync(path.join(__dirname,"../exec-portal/strings.js"),"utf8"));
  run(fs.readFileSync(path.join(__dirname,"../exec-portal/members.js"),"utf8"));
  const setRows = (questions) => { context.rows = questions.map((q) => ({ dataset:{questionId:q.id || ""}, controls:{"[data-mf-label]":{value:q.label || ""},"[data-mf-type]":{value:q.type || "text"},"[data-mf-required]":{checked:!!q.required},"[data-mf-options]":{value:(q.options || []).join("\n")}},querySelector(selector) { return this.controls[selector]; } })); };
  return {elements,context,run,setRows};
}
const existing = [{id:"MQ-FIRST",label:"Program",type:"text",required:true,options:[]},{id:"MQ-SECOND",label:"Language",type:"choice",required:false,options:["English","Chinese"]}];
async function main() {
  const locked = browser(); locked.context.state.role="exec";
  await locked.run("openMembershipFormSettings()");
  ok(locked.context.confirmations === 1 && locked.context.requests.length === 0, "a normal exec uses the existing Settings unlock before reading the form");
  locked.setRows(existing); await locked.run("saveMembershipFormSettings({preventDefault(){}})");
  ok(locked.context.confirmations === 2 && locked.context.requests.length === 0, "an exec cannot bypass the unlock by submitting the form");

  const b = browser(); b.context.nextReply={ok:true,questions:existing};
  await b.run("openMembershipFormSettings()");
  ok(b.context.requests[0].action === "getMembershipForm" && b.elements["membership-form-dialog"].open, "admin loads the existing questions into the form editor");
  const markup=b.elements["membership-form-questions"].innerHTML;
  ok(markup.includes('data-question-id="MQ-FIRST"') && markup.includes('value="choice" selected') && markup.includes('data-mf-required checked'), "question IDs, types and required choices are preserved in their rows");
  b.setRows([{...existing[0],label:"Your program"},existing[1]]);
  b.context.rows[1].controls["[data-mf-options]"].value="English, Chinese\nFrench";
  const read=b.run("readMembershipFormQuestions()");
  ok(read[0].id === "MQ-FIRST" && read[0].label === "Your program" && read[1].options.length === 3, "wording changes retain IDs and choice options accept commas or line breaks");
  b.run("addMembershipFormQuestion()");
  ok(b.run("membershipFormState.questions.length") === 3 && b.run("membershipFormState.questions[2].id") === "", "adding a question keeps existing IDs and lets the server assign a new one");
  b.setRows([...existing,{id:"",label:"Year",type:"text",required:false,options:[]}]);
  b.run('removeMembershipFormQuestion({target:{closest:()=>({dataset:{mfRemove:"1"}})}})');
  ok(b.run("membershipFormState.questions.length") === 2 && b.run("membershipFormState.questions[0].id") === "MQ-FIRST", "removing one question preserves the other IDs");

  const blank=browser(); blank.setRows([{id:"",label:"",type:"text"}]);
  await blank.run("saveMembershipFormSettings({preventDefault(){}})");
  ok(blank.context.requests.length === 0 && /wording/.test(blank.elements["membership-form-error"].textContent), "blank question wording is caught before saving");
  blank.setRows([{id:"",label:"Pick",type:"choice",options:["Only one"]}]);
  await blank.run("saveMembershipFormSettings({preventDefault(){}})");
  ok(blank.context.requests.length === 0 && /two options/.test(blank.elements["membership-form-error"].textContent), "choice questions need at least two options");

  const offline=browser(); offline.context.nextReply={ok:false,error:"NETWORK",message:"No connection"};
  await offline.run("openMembershipFormSettings()");
  ok(!offline.elements["membership-form-dialog"].open && !offline.elements["member-form-settings"].disabled && offline.context.toasts.includes("No connection"), "offline load shows the problem and enables retry without opening an empty editor");
  const failed=browser(); failed.setRows(existing); failed.elements["membership-form-dialog"].open=true; failed.context.nextReply={ok:false,error:"BAD_REQUEST",message:"Question already exists"};
  await failed.run("saveMembershipFormSettings({preventDefault(){}})");
  ok(failed.elements["membership-form-dialog"].open && failed.elements["membership-form-error"].textContent === "Question already exists" && !failed.run("membershipFormState.saving"), "failed saves preserve the open form and show the server's reason");
  const saved=failed.context.requests[0];
  ok(saved.action === "saveMembershipForm" && saved.details.questions[0].id === "MQ-FIRST", "Save sends stable IDs with the edited question definitions");
  failed.context.nextReply={ok:true,questions:existing}; await failed.run("saveMembershipFormSettings({preventDefault(){}})");
  ok(!failed.elements["membership-form-dialog"].open && failed.context.toasts.includes("Join CSS questions saved."), "successful save closes the editor after confirmation from the server");

  b.run('renderMemberSignupAnswers({signupAnswers:{"<Old wording>":"<script>hello</script>\\nSecond line"}})');
  const answers=b.elements["member-signup-answers"].innerHTML;
  ok(!b.elements["member-signup-section"].hidden && answers.includes("&lt;Old wording&gt;") && answers.includes("&lt;script&gt;hello&lt;/script&gt;<br>Second line") && !answers.includes("<script>"), "member details show escaped snapshot wording and multiline answers");
  b.run("renderMemberSignupAnswers({signupAnswers:{}})");
  ok(b.elements["member-signup-section"].hidden && b.elements["member-signup-answers"].innerHTML === "", "members without extra answers have no empty answer section");
  b.setRows(Array.from({length:20},(_,i)=>({id:"MQ"+i,label:"Question "+i,type:"text"}))); b.run("addMembershipFormQuestion()");
  ok(b.run("membershipFormState.questions.length") === 20 && /20 questions/.test(b.elements["membership-form-error"].textContent), "the editor enforces the twenty-question limit");
  console.log(failures ? failures+" FAILED" : "ALL PASSED"); process.exitCode=failures?1:0;
}
main().catch((error)=>{console.error(error);process.exitCode=1;});
