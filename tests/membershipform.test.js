// Join CSS custom questions: access, saving, live validation and answer snapshots in the actual member row.
const assert = require("node:assert/strict");
const { run, sent } = require("./harness.js");
let checks = 0;
function test(message, check) { check(); checks++; console.log("PASS " + message); }
const call = (name, ...args) => run(name + "(" + args.map((v) => JSON.stringify(v)).join(",") + ")");
const bad = (fn, pattern) => assert.throws(fn, (e) => e.code === "BAD_REQUEST" && (!pattern || pattern.test(e.message)));
const admin = { name: "TEST Admin", role: "admin" };
run(`
var mfAdminToken = startSession_("TEST Admin", "admin"), mfExecToken = startSession_("TEST Exec", "exec"), mfDoorToken = startSession_("TEST Door", "door");
var memberValues, memberWrites, failAppend = false;
function resetMembersSheet_() { memberValues = [Object.keys(MEMBER_COLUMNS).map(function(k){return MEMBER_COLUMNS[k][0];})]; memberWrites=[]; failAppend=false; }
resetMembersSheet_();
var memberSheet = {
  getLastColumn: function(){ return memberValues[0].length; }, getLastRow: function(){ return memberValues.length; },
  getDataRange: function(){ return {getValues:function(){return memberValues.map(function(r){return r.slice();});}}; },
  getRange: function(row,col,height,width){return {
    getValues:function(){return Array.from({length:height || 1},function(_,r){return Array.from({length:width || 1},function(_,c){return (memberValues[row+r-1] || [])[col+c-1] || "";});});},
    setValue:function(value){memberWrites.push({row:row,col:col,value:value}); (memberValues[row-1] = memberValues[row-1] || [])[col-1]=value;},
    setValues:function(values){if(failAppend && row>1) throw new Error("TEST sheet write failed"); memberWrites.push({row:row,col:col,values:values}); values.forEach(function(v,r){v.forEach(function(value,c){(memberValues[row+r-1] = memberValues[row+r-1] || [])[col+c-1]=value;});});}
  };}
};
SpreadsheetApp.openById = function(){return {getSheetByName:function(){return memberSheet;},getSheets:function(){return [memberSheet];}};};
function memberSignupThrottle_() {}
function loadMembers_() { return rowsToMembers_(memberValues); }
`);
const form = (questions) => call("saveMembershipForm_", admin, questions);
const signup = (extra) => call("publicRegisterMember_", Object.assign({ name: "TEST New Member", ucid: "30123456", email: "member@example.com", method: "etransfer" }, extra));

test("the existing Join CSS form starts with no extra questions", () => assert.equal(call("membershipInfo_").questions.length, 0));
test("anonymous, ordinary exec and door sessions cannot change Join CSS questions", () => {
  assert.throws(() => call("route_", {action:"getMembershipForm"}), (e) => e.code === "NOT_LOGGED_IN");
  for (const action of ["getMembershipForm", "saveMembershipForm"]) {
    assert.throws(() => call("route_", {action,token:run("mfExecToken"),questions:[]}), (e) => e.code === "ADMIN_ONLY");
    assert.throws(() => call("route_", {action,token:run("mfDoorToken"),questions:[]}), (e) => e.code === "DOOR_ONLY");
  }
});
let questions;
test("admin can add required choice and optional text questions with generated stable IDs", () => {
  const reply = call("route_", {action:"saveMembershipForm",token:run("mfAdminToken"),questions:[
    {label:"How did you hear about CSS?",type:"choice",required:true,options:["Friend","Instagram"]},
    {label:"Anything else?",type:"text",required:false}
  ]});
  questions = reply.questions;
  assert.ok(questions.every((q) => /^MQ[A-F0-9]{10}$/.test(q.id)));
  assert.notEqual(questions[0].id, questions[1].id);
  assert.equal(call("route_", {action:"getMembershipForm",token:run("mfAdminToken")}).questions[0].id, questions[0].id);
  assert.equal(call("membershipInfo_").questions[0].label, questions[0].label);
  assert.equal(run("memberValues.length"), 1);
});
test("missing required custom answer creates no member or partial answer row", () => {
  bad(() => signup(), /How did you hear/);
  assert.equal(run("memberValues.length"), 1); assert.equal(run("memberWrites.length"), 0);
});
test("an invalid choice and overlong answer create no member", () => {
  bad(() => signup({answers:{[questions[0].id]:"Made up"}}), /Choose one/);
  bad(() => signup({answers:{[questions[0].id]:"Friend",[questions[1].id]:"x".repeat(1001)}}), /too long/);
  assert.equal(run("memberValues.length"), 1); assert.equal(run("memberWrites.length"), 0);
});
let memberId;
test("a successful signup saves question labels and multiline answers together in its membership row", () => {
  const reply = signup({answers:{[questions[0].id]:"Friend",[questions[1].id]:"Hello\r\nExcited to join!", ignored:"not a configured question"}});
  memberId = reply.memberId;
  const member = call("rowsToMembers_", run("memberValues"))[0];
  assert.equal(member.signupAnswers[questions[0].label], "Friend");
  assert.equal(member.signupAnswers[questions[1].label], "Hello\nExcited to join!");
  assert.equal(Object.keys(member.signupAnswers).length, 2);
  const index = run("memberValues[0].indexOf('Signup answers')");
  assert.equal(typeof run("memberValues[1][" + index + "]"), "string");
  assert.equal(run("memberWrites.length"), 1); assert.equal(sent.length, 0);
});
test("staff member details expose the saved answer snapshots", () => {
  const reply = call("route_", {action:"getMember",token:run("mfExecToken"),memberId});
  assert.equal(reply.member.signupAnswers[questions[0].label], "Friend");
});
test("editing questions preserves their IDs and never rewrites existing answers", () => {
  const updated = form([{...questions[0],label:"Where did you find us?",options:["Campus","Friend"]},{...questions[1],label:"New wording",required:true}]).questions;
  assert.equal(updated[0].id, questions[0].id); assert.equal(updated[1].id, questions[1].id);
  const member = call("rowsToMembers_", run("memberValues"))[0];
  assert.equal(member.signupAnswers[questions[0].label], "Friend");
  assert.equal(member.signupAnswers[questions[1].label], "Hello\nExcited to join!");
  assert.equal(member.signupAnswers[updated[0].label], undefined);
});
test("retrying an existing pending signup preserves original answers even after requirements change", () => {
  const before = JSON.stringify(run("memberValues[1]"));
  const reply = signup({answers:{[questions[0].id]:"Campus"}});
  assert.equal(reply.existing, true); assert.equal(JSON.stringify(run("memberValues[1]")), before); assert.equal(run("memberValues.length"), 2);
});
test("an existing paid member cannot overwrite their saved answers through public signup", () => {
  run("memberValues[1][memberValues[0].indexOf('Paid Status')]='PAID'");
  const before = JSON.stringify(run("memberValues[1]"));
  assert.throws(() => signup({answers:{[questions[0].id]:"Campus"}}), (e) => e.code === "ALREADY_MEMBER");
  assert.equal(JSON.stringify(run("memberValues[1]")), before);
});
test("staff can add a member without answers to new required custom questions", () => {
  const reply = call("addMember_", {name:"TEST Exec",role:"exec"}, {name:"TEST Desk Member",ucid:"30123457",email:"desk@example.com",method:"cash"}, false);
  assert.ok(reply.memberId); assert.equal(run("memberValues.length"), 3);
  assert.equal(Object.keys(call("rowsToMembers_", run("memberValues"))[1].signupAnswers).length, 0);
});
test("blank, missing or malformed old answer cells do not break old members", () => {
  for (const cell of ["", "not JSON", "null", "[]", "3"]) assert.equal(Object.keys(call("memberSignupAnswers_", cell)).length, 0);
  assert.equal(Object.keys(call("rowsToMembers_", [["Full Name"],["TEST Older Member"]])[0].signupAnswers).length, 0);
  const safe = call("memberSignupAnswers_", '{"__proto__":"a harmless answer","Label":"kept","nested":{"a":1}}');
  assert.equal(safe["__proto__"], "a harmless answer"); assert.equal(safe.Label, "kept"); assert.equal(safe.nested, undefined);
});
test("question count, unique wording, valid types and choices are checked before saving", () => {
  const prior = run("PropertiesService.getScriptProperties().getProperty('MEMBERSHIP_QUESTIONS')");
  for (const input of [null, Array.from({length:21},(_,i)=>({label:"Q"+i})), [{label:"Same"},{label:"same "}], [{label:""}], [{label:"Bad",type:"number"}], [{label:"Pick",type:"choice",options:["One"]}], [{label:"Pick",type:"choice",options:["Same","same"]}]]) bad(() => form(input));
  assert.equal(run("PropertiesService.getScriptProperties().getProperty('MEMBERSHIP_QUESTIONS')"), prior);
});
test("a large form is refused before changing the saved questions", () => {
  bad(() => form(Array.from({length:20},(_,i)=>({label:"Question"+i,type:"choice",options:Array.from({length:10},(_,n)=>"Option"+n+" "+"x".repeat(110))}))), /too long to save together/);
});
test("failed row saving leaves no member or separate answer record behind", () => {
  form([{label:"Short question",type:"text",required:true}]);
  const q = call("membershipInfo_").questions[0];
  run("resetMembersSheet_(); failAppend=true");
  assert.throws(() => signup({answers:{[q.id]:"Answer"}}), /TEST sheet write failed/);
  assert.equal(run("memberValues.length"), 1); assert.equal(sent.length, 0);
});
test("the admin can clear questions or repair an unreadable setting", () => {
  assert.equal(form([]).questions.length, 0); assert.equal(call("membershipInfo_").questions.length, 0);
  run("PropertiesService.getScriptProperties().setProperty('MEMBERSHIP_QUESTIONS','broken')");
  assert.throws(() => call("membershipInfo_"), (e) => e.code === "SETUP_NEEDED");
  assert.equal(form([]).questions.length, 0);
});
test("an older membership sheet gains the answers column when a new signup is saved", () => {
  const q = form([{label:"Program",type:"text",required:true}]).questions[0];
  run("resetMembersSheet_(); memberValues[0].splice(memberValues[0].indexOf('Signup answers'),1)");
  const reply = signup({answers:{[q.id]:"Nursing"}});
  assert.ok(reply.memberId); assert.equal(run("memberValues[0].filter(function(h){return h==='Signup answers';}).length"), 1);
  assert.equal(call("rowsToMembers_", run("memberValues"))[0].signupAnswers.Program, "Nursing");
});
console.log(checks + " membership form checks passed");
