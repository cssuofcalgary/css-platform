// Edit original template wording through the rendered email; saving stays explicit.
const EM_FIELDS = ["subject", "title", "subtitle", "intro", "closing"];
let emData = null, emPreviewRequest = 0, emPreviewTimer = null, emEditingField = "", emLabels = {}, emRevision = 0;
const emDrafts = {};
function emKind() { return emData.kinds.find(k => k.key === $("em-kind").value); }
function emFieldBox(field) { return $("em-" + field); }
function emCurrentFields() {
  const defaults = emKind().defaults, out = {};
  EM_FIELDS.forEach(f => { const value = emFieldBox(f).value;
    out[f] = value === (defaults[f] || "") ? "" : (!value && defaults[f] ? "-" : value); });
  return out;
}
function emCurrentBrand() { return { signerName:$("em-signer").value, signerRole:$("em-role").value,
  buttonColor:$("em-color").value, labels:{...emLabels} }; }
function emFieldNames() { return { title:T.emHeading, subtitle:T.emSubheading, intro:T.emIntro, closing:T.emClosing,
  signer:T.emSigner, role:T.emRole, "label-amount":T.emPaymentAmount, "label-sendTo":T.emPaymentSendTo,
  "label-message":T.emPaymentMessage, "label-exactly":T.emPaymentExactly, "label-when":T.emWhenLabel, "label-where":T.emWhereLabel }; }
function emMessage(id,text,error) { const box=$(id);box.className=(error?"error":"good-text")+" small";box.textContent=text; }
function emChanged() { emRevision++;emDrafts[emKind().key]=emCurrentFields();emMessage("em-result",T.emUnsaved,false); }
function emShowBrand() {
  $("em-signer").value=emData.brand.signerName;$("em-role").value=emData.brand.signerRole;
  $("em-color").value=emData.brand.buttonColor;emLabels={...emData.labelDefaults,...emData.brand.labels};
}
function emShowKind() {
  const kind=emKind(),fields=emDrafts[kind.key]||kind.custom;
  $("em-when").textContent=kind.when;$("em-fills").textContent=T.emFills(kind.placeholders);
  EM_FIELDS.forEach(f=>{emFieldBox(f).value=fields[f]==="-"?"":(fields[f]||kind.defaults[f]||"");});
  $("em-result").textContent=emDrafts[kind.key]?T.emUnsaved:"";
  const names=emFieldNames();
  $("em-edit-field").innerHTML=Object.keys(names).filter(f=> !["label-amount","label-sendTo","label-message","label-exactly"].includes(f)||["registration","reminder"].includes(kind.key))
    .map(f=>`<option value="${f}">${escapeHtml(names[f])}</option>`).join("");
  emPreview();
}
async function openEmailsCard() {
  const reply=await api("getEmailTemplates");if(!reply.ok)return handleEventError(reply,$("em-result"));
  const previous=$("em-kind").value,draftBrand=emData?emCurrentBrand():null;emData=reply;
  if(draftBrand)emData.brand=draftBrand;
  $("em-kind").innerHTML=reply.kinds.map(k=>`<option value="${escapeHtml(k.key)}">${escapeHtml(k.label)}</option>`).join("");
  if(reply.kinds.some(k=>k.key===previous))$("em-kind").value=previous;
  $("em-preview").textContent=T.emRefresh;emShowBrand();emShowKind();
}
async function emPreview() {
  clearTimeout(emPreviewTimer);const request=++emPreviewRequest,key=emKind().key,frame=$("em-frame");
  $("em-preview").disabled=true;frame.style.opacity=".5";frame.style.pointerEvents="none";
  const reply=await api("previewEmail",{key,fields:emCurrentFields(),brand:emCurrentBrand(),editable:true});
  if(request!==emPreviewRequest||emKind().key!==key)return;
  $("em-preview").disabled=false;frame.style.opacity="1";frame.style.pointerEvents="";
  if(!reply.ok){frame.srcdoc="";return emMessage("em-result",errorText(reply),true);}
  frame.srcdoc=reply.html;
}
$("em-frame").addEventListener("load",()=>{
  const doc=$("em-frame").contentDocument;if(!doc)return;
  const style=doc.createElement("style");style.textContent='[data-email-edit]{cursor:pointer;outline:1px dashed #a8822e;outline-offset:3px;border-radius:3px}[data-email-edit]:hover,[data-email-edit]:focus{outline:2px solid #b42324;background:#fff5d8}div[data-email-edit]:empty{min-height:22px}a{cursor:default}';doc.head.appendChild(style);
  doc.querySelectorAll("[data-email-edit]").forEach(el=>{el.tabIndex=0;el.setAttribute("role","button");el.title=emFieldNames()[el.dataset.emailEdit]||T.emEdit;el.setAttribute("aria-label",el.title);});
  doc.addEventListener("click",event=>{event.preventDefault();const el=event.target.closest("[data-email-edit]");if(el)emOpenField(el.dataset.emailEdit);});
  doc.addEventListener("keydown",event=>{if(["Enter"," "].includes(event.key)&&event.target.dataset.emailEdit){event.preventDefault();emOpenField(event.target.dataset.emailEdit);}});
});
function emOpenField(field) {
  if(!emFieldNames()[field])return;emEditingField=field;$("em-edit-title").textContent=emFieldNames()[field];
  const label=field.startsWith("label-");$("em-edit-text").value=label?emLabels[field.slice(6)]:emFieldBox(field).value;
  $("em-edit-text").maxLength=label?60:({title:100,subtitle:200,intro:1500,closing:1500,signer:80,role:120}[field]);
  $("em-edit-tokens").innerHTML=EM_FIELDS.includes(field)?emKind().placeholders.map(key=>`<button type="button" class="secondary small-button" data-em-token="${key}">{${key}}</button>`).join(""):"";
  $("em-edit-dialog").showModal();$("em-edit-text").focus();
}
$("em-edit-open").addEventListener("click",()=>emOpenField($("em-edit-field").value));
$("em-edit-cancel").addEventListener("click",()=>$("em-edit-dialog").close());
$("em-edit-tokens").addEventListener("click",event=>{const b=event.target.closest("[data-em-token]");if(!b)return;const box=$("em-edit-text");box.setRangeText("{"+b.dataset.emToken+"}",box.selectionStart,box.selectionEnd,"end");box.focus();});
$("em-edit-form").addEventListener("submit",event=>{
  event.preventDefault();const value=$("em-edit-text").value;
  if(emEditingField.startsWith("label-"))emLabels[emEditingField.slice(6)]=value||emData.labelDefaults[emEditingField.slice(6)];
  else emFieldBox(emEditingField).value=value;
  $("em-edit-dialog").close();emChanged();emPreview();
});
$("em-kind").addEventListener("change",()=>{if(emData)emShowKind();});
$("em-subject").addEventListener("input",emChanged);
["em-signer","em-role","em-color"].forEach(id=>$(id).addEventListener("input",()=>{emChanged();clearTimeout(emPreviewTimer);emPreviewTimer=setTimeout(emPreview,400);}));
$("em-preview").addEventListener("click",emPreview);
$("em-save").addEventListener("click",async()=>{
  const kind=emKind(),fields=emCurrentFields(),brand=emCurrentBrand(),revision=emRevision;$("em-save").disabled=true;
  const reply=await api("saveEmailTemplate",{key:kind.key,fields});
  if(!reply.ok){$("em-save").disabled=false;return emMessage("em-result",errorText(reply),true);}
  kind.custom=fields;if(revision===emRevision&&JSON.stringify(emDrafts[kind.key])===JSON.stringify(fields))delete emDrafts[kind.key];
  const brandReply=await api("saveEmailBrand",{brand});$("em-save").disabled=false;
  if(!brandReply.ok)return emMessage("em-result",T.emPartialSave+" "+errorText(brandReply),true);
  emData.brand=brandReply.brand;if(emKind().key===kind.key)emMessage("em-result",emDrafts[kind.key]?T.emUnsaved:T.emSaved,false);
});
$("em-reset").addEventListener("click",async()=>{if(!(await askConfirm(T.emResetConfirm,T.emReset)))return;EM_FIELDS.forEach(f=>{emFieldBox(f).value=emKind().defaults[f]||"";});emChanged();emPreview();});
$("em-test").addEventListener("click",async()=>{const to=$("em-test-to").value.trim();$("em-test").disabled=true;
  const reply=await api("sendTestEmail",{key:emKind().key,to,fields:emCurrentFields(),brand:emCurrentBrand()});$("em-test").disabled=false;
  emMessage("em-result",reply.ok?T.emSent(to):errorText(reply),!reply.ok);});
async function emSaveBrand(reset) {
  const brand=reset?{signerName:"",signerRole:"",buttonColor:"",labels:emData.labelDefaults}:emCurrentBrand();
  const reply=await api("saveEmailBrand",{brand});if(!reply.ok)return emMessage("em-brand-result",errorText(reply),true);
  emData.brand=reply.brand;emShowBrand();emPreview();emMessage("em-brand-result",T.emSaved,false);
}
$("em-brand-save").addEventListener("click",()=>emSaveBrand(false));
$("em-brand-reset").addEventListener("click",async()=>{if(await askConfirm(T.emBrandResetConfirm,T.emBrandReset))emSaveBrand(true);});
