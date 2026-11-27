// The actual tracker views, with small library doubles and an offline DOM.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict");
class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attributes = {};
    this.listeners = {}; this.className = ""; this.value = ""; this.checked = false; this.disabled = false;
    this._html = ""; this.textContent = ""; this.classList = {add: (name) => {this.className += " " + name;}};
  }
  appendChild(child) {
    if (child.parentNode) child.parentNode.children.splice(child.parentNode.children.indexOf(child), 1);
    child.parentNode = this; this.children.push(child); return child;
  }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; return child; }
  insertBefore(child, before) {
    if (child.parentNode) child.parentNode.children.splice(child.parentNode.children.indexOf(child), 1);
    child.parentNode = this;
    const i = this.children.indexOf(before); if (i < 0) this.children.push(child); else this.children.splice(i, 0, child);
    return child;
  }
  set innerHTML(value) { this._html = value; this.children.forEach((c) => c.parentNode = null); this.children = []; }
  get innerHTML() { return this._html; }
  setAttribute(key, value) { this.attributes[key] = value; }
  getAttribute(key) { return this.attributes[key]; }
  addEventListener(key, callback) { (this.listeners[key] ||= []).push(callback); }
  fire(key, event = {}) { (this.listeners[key] || []).forEach((callback) => callback(event)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    let result = [];
    for (const child of this.children) {
      if (selector[0] === "." ? child.className.split(/\s+/).includes(selector.slice(1)) : child.tagName.toLowerCase() === selector) result.push(child);
      result = result.concat(child.querySelectorAll(selector));
    }
    return result;
  }
  setCustomValidity(value) { this.validationMessage = value; }
  checkValidity() { return !this.validationMessage; }
  reportValidity() { this.reported = true; }
  focus() { this.focused = true; }
}
const context = vm.createContext({console, Intl, Promise, document: {createElement: (tag) => new Element(tag)},
  matchMedia: () => ({matches: false})});
function run(code) { return vm.runInContext(code, context); }
run(fs.readFileSync(path.join(__dirname, "../exec-portal/strings.js"), "utf8"));
run(fs.readFileSync(path.join(__dirname, "../exec-portal/teams-views.js"), "utf8"));
const plain = (value) => JSON.parse(JSON.stringify(value));
let passed = 0;
function check(message, callback) { callback(); passed++; console.log("PASS " + message); }
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
function deferred() { let resolve, reject; const promise = new Promise((yes,no)=>{resolve=yes;reject=no;}); return {promise,resolve,reject}; }
const fields = [
  {id:"Ftitle", name:"Name <script>", type:"text"},
  {id:"Flong", name:"Notes", type:"longtext"},
  {id:"Fnum", name:"Number", type:"number"},
  {id:"Fmoney", name:"Amount", type:"money"},
  {id:"Fdate", name:"Date", type:"date"},
  {id:"Fstatus", name:"Status", type:"choice", options:[{id:"Otodo", label:"To do", color:"blue"},{id:"Odone",label:"Done",color:"green"}]},
  {id:"Fperson", name:"Owner", type:"person"},
  {id:"Flink", name:"Link", type:"link"},
  {id:"Fcheck", name:"Approved", type:"checkbox"}
];
const calls = [];
const ctx = {
  tracker:{id:"TTone", fields, views:{boardField:"Fstatus",dateField:"Fdate"}},
  rows:[{id:"TRone", values:{Ftitle:"<img src=x onerror=alert(1)>",Fdate:"2026-11-20",Fstatus:"Otodo",Fperson:"Old person",Fmoney:0},sort:1},
    {id:"TRtwo", values:{Ftitle:"Second",Fstatus:""},sort:2}],
  team:[{name:"Kevin",active:true},{name:"Marcus",active:true},{name:"Inactive",active:false}],
  onEdit(...args) { calls.push(["edit",...args]); return Promise.resolve(); },
  onMove(...args) { calls.push(["move",...args]); return Promise.resolve(); },
  onOpen(...args) { calls.push(["open",...args]); }, onAdd(...args) { calls.push(["add",...args]); }
};
context.ctx = ctx;
const root = new Element("div"); context.root = root;

async function main() {
  check("views are enabled only when the needed field exists and saved fields have the correct type", () => {
    assert.deepEqual(plain(run("tvAvailableViews(ctx.tracker)")), ["table","board","calendar"]);
    assert.deepEqual(plain(run("tvAvailableViews({fields:[{id:'F',type:'text'}]})")), ["table"]);
    assert.equal(run("tvViewField({fields:ctx.tracker.fields,views:{boardField:'Ftitle'}},'board').id"), "Fstatus");
  });
  check("choice pills and links escape text, reject unsafe links and restrict colour classes", () => {
    assert.equal(run("tvCellText({type:'money'},0)"), "$0.00");
    assert.equal(run("tvCellText({type:'money'},'')"), "");
    assert.equal(run("tvCellText({type:'checkbox'},true)"), "Yes");
    assert.equal(run("tvCellText(ctx.tracker.fields[5],'Otodo')"), "To do");
    assert.equal(run("tvCellHtml({type:'text'},'<img onerror=x>')"), "&lt;img onerror=x&gt;");
    assert.ok(!run("tvCellHtml({type:'link'},'javascript:alert(1)')").includes("<a"));
    assert.ok(run("tvCellHtml({type:'link'},'https://example.org/?x=\" onclick=\"oops')").includes("&quot;"));
    assert.ok(run("tvCellHtml({type:'choice',options:[{id:'x',label:'<x>',color:'red onclick=x'}]},'x')").includes('tv-choice-grey'));
    assert.ok(!run("tvCellHtml({type:'choice',options:[]},'gone')"));
  });
  check("a missing table library leaves every type editable, with an accessible record button", () => {
    run("tvRender(root,'table',ctx)");
    assert.equal(root.querySelectorAll("tbody")[0].children.length, 2);
    assert.equal(root.querySelectorAll("thead")[0].children[0].children[1].textContent, "Name <script>");
    const first = root.querySelectorAll("tbody")[0].children[0];
    assert.equal(first.children.length, 10);
    assert.equal(first.children[2].children[0].tagName, "TEXTAREA");
    assert.equal(first.children[3].children[0].type, "number");
    assert.equal(first.children[5].children[0].type, "date");
    assert.equal(first.children[9].children[0].type, "checkbox");
    first.children[0].children[0].fire("click");
    assert.deepEqual(calls.pop(), ["open","TRone"]);
    const people = first.children[7].children[0].children.map((option) => option.value);
    assert.deepEqual(people, ["","Kevin","Marcus","Old person"]);
  });
  let input = root.querySelectorAll("tbody")[0].children[0].children[3].children[0];
  input.value = "12.5"; input.fire("change"); await flush();
  check("an inline edit sends one cell with a numeric value, without overwriting other fields", () => {
    assert.deepEqual(calls.pop(), ["edit","TRone","Fnum",12.5]);
  });
  ctx.onEdit = (...args) => {calls.push(["failed",...args]); return Promise.reject(new Error("offline"));};
  input.value = "40"; input.fire("change"); await flush();
  check("a failed inline save restores the previous value", () => {assert.equal(input.value, 12.5); calls.pop();});
  let older=deferred(), newer=deferred(), editNumber=0;
  ctx.onEdit = ()=> (++editNumber===1 ? older.promise : newer.promise);
  input.value="50";input.fire("change");input.value="60";input.fire("change");await flush();
  older.reject(new Error("offline"));await flush();
  check("an older failed fallback edit never replaces newer in-flight typing", () => {assert.equal(input.value,"60");});
  newer.reject(new Error("offline"));await flush();
  check("if both rapid fallback edits fail, the last saved value is restored", () => {assert.equal(input.value,12.5);});
  ctx.onEdit = (...args) => {calls.push(["edit",...args]); return Promise.resolve();};

  run(`var tables=[]; function Tabulator(el, options){this.options=options;this.handlers={};this.destroyed=false;tables.push(this);}
    Tabulator.prototype.on=function(name,fn){this.handlers[name]=fn;};
    Tabulator.prototype.destroy=function(){this.destroyed=true;};`);
  run("tvRender(root,'table',ctx)");
  const table = run("tables[0]");
  check("Tabulator gets typed editors, safe headers and original IDs", () => {
    assert.equal(table.options.columns.length, 10);
    assert.equal(table.options.columns[1].title, "Name &lt;script&gt;");
    assert.equal(table.options.data[0].id, "TRone");
    assert.ok(table.options.columns.slice(1).every((column) => typeof column.editor === "function"));
    const cell = {getValue:()=>false}; let value, saves = 0;
    const checkbox = table.options.columns[9].editor(cell, (fn)=>fn(), (next)=>{value=next;saves++;}, ()=>{});
    checkbox.checked=true; checkbox.fire("change"); checkbox.fire("blur");
    assert.equal(value,true); assert.equal(saves,1);
  });
  let currentValue = 8, reverted = false;
  const cell = {getRow:()=>({getData:()=>({id:"TRone"})}), getField:()=>"Fnum", getValue:()=>currentValue,
    getOldValue:()=>3, setValue(value) {currentValue=value;reverted=true;table.handlers.cellEdited(cell);}};
  table.handlers.cellEdited(cell); await flush();
  check("library edits use the same one-cell callback", () => {assert.deepEqual(calls.pop(), ["edit","TRone","Fnum",8]);});
  ctx.onEdit = ()=>Promise.reject(new Error("offline")); currentValue = 9; table.handlers.cellEdited(cell); await flush();
  check("failed library edits restore the last saved value without another save", () => {assert.equal(currentValue,8);assert.equal(reverted,true);});
  older=deferred();newer=deferred();editNumber=0;
  ctx.onEdit=()=> (++editNumber===1 ? older.promise : newer.promise);
  currentValue=20;table.handlers.cellEdited(cell);currentValue=30;table.handlers.cellEdited(cell);await flush();
  older.reject(new Error("offline"));await flush();
  check("rapid library edits capture each intended value and preserve the newer edit on old failure", () => {assert.equal(currentValue,30);});
  newer.reject(new Error("offline"));await flush();
  check("the final failed library edit returns to the confirmed saved value", () => {assert.equal(currentValue,8);});
  ctx.onEdit = (...args)=>{calls.push(["edit",...args]);return Promise.resolve();};

  run("Tabulator=undefined; tvRender(root,'board',ctx)");
  check("switching views destroys the previous table; boards show each choice and No status", () => {
    assert.equal(table.destroyed,true);
    assert.equal(root.querySelectorAll(".tv-board-column").length,3);
    assert.equal(root.querySelectorAll(".tv-board-list")[0].children[0].children[0].textContent,ctx.rows[0].values.Ftitle);
    root.querySelectorAll(".tv-board-add")[1].fire("click");
    assert.deepEqual(plain(calls.pop()),["add",{Fstatus:"Odone"}]);
  });
  let card = root.querySelectorAll(".tv-board-list")[0].children[0];
  let move = card.querySelector("select"); move.value="Odone"; move.fire("change"); await flush();
  check("the keyboard-accessible move selector works without a drag library", () => {
    assert.deepEqual(calls.pop(),["move","TRone","Fstatus","Odone"]);
    assert.equal(card.parentNode.dataset.value,"Odone");
  });
  ctx.onMove=()=>Promise.reject(new Error("offline")); move.value=""; move.fire("change"); await flush();
  check("a failed board move returns the card and selector to their previous column", () => {
    assert.equal(card.parentNode.dataset.value,"Odone"); assert.equal(move.value,"Odone");
  });
  older=deferred();newer=deferred();editNumber=0;
  ctx.onMove=()=> (++editNumber===1 ? older.promise : newer.promise);
  move.value="";move.fire("change");move.value="Otodo";move.fire("change");await flush();
  older.reject(new Error("offline"));await flush();
  check("an old failed board move leaves the newer column and selector intact", () => {
    assert.equal(card.parentNode.dataset.value,"Otodo");assert.equal(move.value,"Otodo");
  });
  newer.reject(new Error("offline"));await flush();
  check("when both board moves fail the card returns to its confirmed column", () => {assert.equal(card.parentNode.dataset.value,"Odone");});
  ctx.onMove=(...args)=>{calls.push(["move",...args]);return Promise.resolve();};
  run(`var sortables=[];function Sortable(el,options){this.el=el;this.options=options;sortables.push(this);}
    Sortable.prototype.destroy=function(){this.destroyed=true;};tvRender(root,'board',ctx);`);
  const sortable = run("sortables[1]"); const lists=root.querySelectorAll(".tv-board-list"); card=lists[0].children[0];
  lists[1].appendChild(card); sortable.options.onAdd({item:card,from:lists[0],to:lists[1],oldIndex:0}); await flush();
  check("dragging a board card saves its choice, with touch-friendly configuration", () => {
    assert.deepEqual(calls.pop(),["move","TRone","Fstatus","Odone"]);
    assert.equal(sortable.options.delayOnTouchOnly,true);
    assert.equal(card.querySelector("select").value,"Odone");
  });

  run(`var calendars=[];var FullCalendar={Calendar:function(el,options){this.options=options;calendars.push(this);this.render=function(){};this.destroy=function(){this.destroyed=true;};}};
    tvRender(root,'calendar',ctx);`);
  const calendar=run("calendars[0]");
  check("calendar uses dated rows, opens records, and pre-fills the date when adding", () => {
    assert.ok(run("sortables.every(s=>s.destroyed)"));
    assert.equal(calendar.options.initialView,"dayGridMonth");
    assert.equal(calendar.options.events.length,1);
    assert.equal(calendar.options.events[0].title,ctx.rows[0].values.Ftitle);
    calendar.options.dateClick({dateStr:"2026-12-08"});
    assert.deepEqual(plain(calls.pop()),["add",{Fdate:"2026-12-08"}]);
    calendar.options.eventClick({event:{id:"TRone"}}); assert.deepEqual(calls.pop(),["open","TRone"]);
    assert.equal(root.querySelectorAll(".tv-undated").length,1);
  });
  let wasReverted=false;
  calendar.options.eventDrop({event:{id:"TRone",startStr:"2026-12-10"},revert:()=>{wasReverted=true;}}); await flush();
  check("calendar drops send only the date", () => {assert.deepEqual(calls.pop(),["move","TRone","Fdate","2026-12-10"]);});
  ctx.onMove=()=>Promise.reject(new Error("offline"));
  calendar.options.eventDrop({event:{id:"TRone",start:new Date("2026-12-11T00:00:00Z")},revert:()=>{wasReverted=true;}}); await flush();
  check("a failed calendar drop calls its revert function", () => {assert.equal(wasReverted,true);});
  run("matchMedia=()=>({matches:true});tvRender(root,'calendar',ctx)");
  check("phones begin with a calendar list, and old calendars are destroyed", () => {
    assert.equal(calendar.destroyed,true);assert.equal(run("calendars[1].options.initialView"),"listMonth");
  });
  ctx.onMove=(...args)=>{calls.push(["move",...args]);return Promise.resolve();};
  run("FullCalendar=undefined;tvRender(root,'calendar',ctx)");
  check("missing calendar libraries leave usable date editing and dated additions", () => {
    const addControls=root.querySelector(".tv-calendar-add"), date=addControls.children[0];
    date.value="2026-12-12";date.fire("change");assert.equal(addControls.children[1].disabled,false);
    addControls.children[1].fire("click");assert.deepEqual(plain(calls.pop()),["add",{Fdate:"2026-12-12"}]);
    assert.equal(root.querySelectorAll(".tv-calendar-day").length,1);
    assert.equal(root.querySelectorAll(".tv-undated").length,1);
  });
  input=root.querySelector(".tv-calendar-line").children[1];input.value="2026-12-13";input.fire("change");await flush();
  check("calendar fallback date changes use the same merge callback", () => {assert.deepEqual(calls.pop(),["move","TRone","Fdate","2026-12-13"]);});
  check("a successful fallback date edit moves the record to its new date heading", () => {
    assert.equal(input.parentNode.parentNode.children[0].textContent,"2026-12-13");
    assert.ok(!root.querySelectorAll(".tv-calendar-day").some(section=>section.children[0].textContent==="2026-11-20"));
  });
  older=deferred();newer=deferred();editNumber=0;
  ctx.onMove=()=> (++editNumber===1 ? older.promise : newer.promise);
  input.value="2026-12-20";input.fire("change");input.value="2026-12-21";input.fire("change");await flush();
  older.reject(new Error("offline"));await flush();
  check("an old failed fallback date edit leaves a newer date visible", () => {assert.equal(input.value,"2026-12-21");});
  newer.resolve();await flush();
  check("the latest successful fallback date determines the record's group", () => {
    assert.equal(input.parentNode.parentNode.children[0].textContent,"2026-12-21");
  });
  ctx.onMove=(...args)=>{calls.push(["move",...args]);return Promise.resolve();};
  input.value="";input.fire("change");await flush();calls.pop();
  check("clearing a fallback date moves the editable record under No date", () => {
    assert.equal(input.parentNode.parentNode.className,"tv-undated");
    assert.equal(root.querySelectorAll(".tv-undated").length,1);
  });
  run(`Tabulator=function(el, options){this.options=options;this.handlers={};tables.push(this);};
    Tabulator.prototype.on=function(name,fn){this.handlers[name]=fn;};Tabulator.prototype.destroy=function(){};
    tvRender(root,'table',ctx);`);
  check("Choice columns sort in the order their choices are listed, with blanks last", () => {
    const options = run("tables[tables.length-1].options"), sorter = options.columns[6].sorter;
    assert.equal(typeof sorter, "function");
    assert.ok(sorter("Odone", "Otodo") > 0); assert.ok(sorter("Otodo", "Odone") < 0);
    assert.ok(sorter("", "Odone") > 0); assert.ok(sorter("Ogone", "Otodo") > 0); assert.equal(sorter("Otodo", "Otodo"), 0);
    assert.equal(options.columns[3].sorter, "number"); assert.equal(options.columns[1].sorter, "string");
    assert.equal(options.placeholder, "No records yet.");
  });
  run("tvRender(root,'table',Object.assign({},ctx,{rows:[],emptyText:T.tmNoMatches}))");
  check("when a search hides every record the table says No records match", () => {
    assert.equal(run("tables[tables.length-1].options.placeholder"), "No records match.");
  });
  run("Tabulator=undefined;tvRender(root,'table',Object.assign({},ctx,{rows:[],emptyText:T.tmNoMatches}))");
  check("the plain table says No records match too", () => {assert.equal(root.querySelector(".tv-empty").textContent, "No records match.");});
  run("tvRender(root,'table',Object.assign({},ctx,{rows:[]}))");
  check("an empty tracker still says No records yet", () => {assert.equal(root.querySelector(".tv-empty").textContent, "No records yet.");});
  run(`FullCalendar={Calendar:function(el,options){this.options=options;calendars.push(this);this.render=function(){};this.destroy=function(){};}};
    tvRender(root,'calendar',Object.assign({},ctx,{rows:[],emptyText:T.tmNoMatches}))`);
  check("the calendar list says No records match when a search hides everything", () => {
    assert.equal(run("calendars[calendars.length-1].options.noEventsText"), "No records match.");
  });
  run("FullCalendar=undefined;tvRender(root,'calendar',Object.assign({},ctx,{rows:[],emptyText:T.tmNoMatches}))");
  check("the plain calendar says No records match too", () => {assert.equal(root.querySelector(".tv-empty").textContent, "No records match.");});
  check("view colours use the portal's theme tokens, including over the table library's light-grey hover", () => {
    const css = fs.readFileSync(path.join(__dirname, "../exec-portal/teams-views.css"), "utf8");
    assert.ok(css.split(/\r?\n/).filter((line) => /#[0-9a-fA-F]{3,8}\b/.test(line)).every((line) => /--tv-purple/.test(line)));
    assert.match(css, /\.tv-view\.tabulator \.tabulator-header \.tabulator-col\.tabulator-sortable\.tabulator-col-sorter-element:hover[^{]*\{[^}]*var\(--sunken/);
    assert.match(css, /\.tv-view\.tabulator \.tabulator-header \.tabulator-col\.tabulator-sortable\[aria-sort\] \.tabulator-col-content \.tabulator-col-sorter \.tabulator-arrow/);
  });
  run("tvDestroy(root)");
  check("destroy clears rendered records and instance references", () => {assert.equal(root.children.length,0);assert.equal(run("tvInstances.has(root)"),false);});
  console.log("\n"+passed+" PASSED");
}
main().catch((error)=>{console.error(error);process.exitCode=1;});
