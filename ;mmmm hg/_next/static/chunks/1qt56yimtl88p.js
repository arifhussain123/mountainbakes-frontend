(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,12294,t=>{"use strict";let e=(0,t.i(818909).default)("Printer",[["path",{d:"M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2",key:"143wyd"}],["path",{d:"M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6",key:"1itne7"}],["rect",{x:"6",y:"14",width:"12",height:"8",rx:"1",key:"1ue0tg"}]]);t.s(["Printer",0,e],12294)},713770,t=>{"use strict";var e=t.i(950309);let n=new Map,a=new Map,i=new Set;function r(t){return i.add(t),()=>{i.delete(t)}}t.s(["useCachedLogo",0,function(t){let o=(0,e.useSyncExternalStore)(r,()=>(function(t){if(t)return n.get(t)??t})(t),()=>t??void 0);return(0,e.useEffect)(()=>{t&&!n.has(t)&&function(t){if(!t)return Promise.resolve(void 0);let e=n.get(t);if(e)return Promise.resolve(e);if(a.get(t))return;let r=(async()=>{let e=t;try{let n=await fetch(t,{mode:"cors",credentials:"omit"});if(n.ok){var r;let t=await n.blob();t.size>0&&t.size<=15e5&&t.type.startsWith("image/")&&(e=await (r=t,new Promise((t,e)=>{let n=new FileReader;n.onload=()=>t(String(n.result)),n.onerror=()=>e(n.error??Error("read failed")),n.readAsDataURL(r)})))}}catch{}for(let r of(n.set(t,e),a.delete(t),i))r();return e})();a.set(t,r)}(t)},[t]),o}])},530917,740358,41447,828844,t=>{"use strict";var e=t.i(558221),n=t.i(950309),a=t.i(519455),i=t.i(755146);class r extends Error{code;detail;constructor(t,e,n){super(e),this.name="PosPrintError",this.code=t,this.detail=n??null}}function o(t){return"invalid-document"!==t&&"not-supported"!==t}function s(t){let e=arguments.length>1&&void 0!==arguments[1]?arguments[1]:"print-failed";if(t instanceof r)return t;let n=t instanceof Error?`${t.name}: ${t.message}`:String(t);return new r(e,function(t){switch(t){case"not-supported":return"This browser cannot print. Open Mountain Bakes in Chrome or Edge on the till.";case"invalid-document":return"Print document is empty. Nothing was sent to the printer.";case"timeout":return"The receipt could not be prepared for the printer in time. Try again.";case"cancelled":return"Printing was cancelled.";case"print-failed":return"Printing failed. Check the printer is switched on and set as the default printer on this computer."}}(e),n)}t.s(["PosPrintError",0,r,"asPrintError",0,s,"isRetryable",0,o],740358);let d='Arial, Helvetica, "Liberation Sans", "DejaVu Sans", sans-serif',l=16,c=12,m=11,u=9.5,p=13,h=9,f=1.3,g={"80mm":{id:"80mm",paperWidthMm:80,printableWidthMm:72,scale:1},"58mm":{id:"58mm",paperWidthMm:58,printableWidthMm:48,scale:.86}},y="80mm";function b(t){return g[t??y]??g[y]}let $="mb-page",v="mb.receiptPaper",w="mb:receipt-paper",T=[{value:"80mm",label:"80mm roll",hint:"Standard receipt printer"},{value:"58mm",label:"58mm roll",hint:"Narrow receipt printer"}];function x(){try{let t=localStorage.getItem(v);return"58mm"===t||"80mm"===t?t:y}catch{return y}}function P(t){return window.addEventListener("storage",t),window.addEventListener(w,t),()=>{window.removeEventListener("storage",t),window.removeEventListener(w,t)}}function k(){return{paper:(0,n.useSyncExternalStore)(P,x,()=>y),setPaper:(0,n.useCallback)(t=>(function(t){try{localStorage.setItem(v,t)}catch{}window.dispatchEvent(new Event(w))})(t),[])}}t.s(["PAPER_OPTIONS",0,T,"useReceiptPaper",0,k],41447);var N=t.i(145694),M=t.i(975157),C=t.i(998354),D=t.i(394396),S=t.i(239050),I=t.i(562749),E=t.i(160231),j=t.i(12294),A=t.i(730687),R=t.i(108059);t.s(["PopPrintButton",0,function(t){let{print:s,label:d="POP Print",onPrinted:l,autoPrint:c=!1,showPaperMenu:m=!0,disabled:u,variant:p="default",size:h="default",className:f}=t,{paper:g,setPaper:y}=k(),[b,$]=(0,n.useState)("idle"),[v,w]=(0,n.useState)(0),[x,P]=(0,n.useState)(null),B=(0,n.useRef)(null),q=(0,n.useRef)(!0);(0,n.useEffect)(()=>(q.current=!0,()=>{q.current=!1,B.current&&clearTimeout(B.current)}),[]);let L=(0,n.useRef)(s),O=(0,n.useRef)(l),U=(0,n.useRef)(g);(0,n.useEffect)(()=>{L.current=s,O.current=l,U.current=g},[s,l,g]);let Q="printing"===b||"queued"===b,z=(0,n.useRef)(!1),W=t=>{B.current&&clearTimeout(B.current),B.current=setTimeout(()=>{q.current&&($("idle"),P(null))},t)},K=(0,n.useCallback)(async()=>{if(z.current)return;z.current=!0,(0,N.beginPrintTrace)("pop-print"),(0,N.printTrace)("button pressed",{label:d}),$("printing"),w(0),P(null);let t={paper:U.current,onJobUpdate:t=>{q.current&&("queued"===t.state?($("queued"),w(t.position)):"printing"===t.state&&($("printing"),w(0)))}};try{let e=await L.current(t);if((0,N.printTrace)("print promise resolved",{ms:e.durationMs}),!q.current)return;$("printed"),(0,R.isIOS)()?A.toast.info("Sent to the print sheet",{duration:1200}):A.toast.success("Printed successfully",{duration:1200}),O.current?.(e),W(1200)}catch(e){if(!q.current)return;let t=e instanceof r?e:new r("print-failed","Printing failed. Check the printer is switched on and set as the default printer on this computer.");(0,N.printTrace)("print promise rejected",{code:t.code,detail:t.detail}),$("failed"),P({code:t.code,message:t.message}),A.toast.error("invalid-document"===t.code?"Print document is empty":"Printing failed",{description:t.message,duration:3500}),W(3500)}finally{z.current=!1}},[d]),V=(0,n.useRef)(!1);(0,n.useEffect)(()=>{!c||V.current||u||(V.current=!0,K())},[c,u,K]);let G="queued"===b?v>0?`Queued (${v} ahead)`:"Queued…":"printing"===b?"Printing…":"printed"===b?"Printed":"failed"===b?"Print Failed":d,F="failed"===b&&x?`${x.message}${o(x.code)?" Press to try again.":""}`:`Print this receipt on the ${g} roll of this computer's default printer`;return(0,e.jsxs)("div",{className:(0,M.cn)("no-print inline-flex items-stretch",f),children:[(0,e.jsxs)(a.Button,{variant:"failed"===b?"destructive":p,size:h,disabled:u||Q,onClick:K,className:(0,M.cn)("flex-1",m&&"rounded-r-none"),title:F,"aria-busy":Q||void 0,children:["printing"===b&&(0,e.jsx)(E.Loader2,{className:"mr-1.5 h-4 w-4 animate-spin"}),"queued"===b&&(0,e.jsx)(I.Clock,{className:"mr-1.5 h-4 w-4"}),"printed"===b&&(0,e.jsx)(D.Check,{className:"mr-1.5 h-4 w-4"}),"failed"===b&&(0,e.jsx)(C.AlertTriangle,{className:"mr-1.5 h-4 w-4"}),"idle"===b&&(0,e.jsx)(j.Printer,{className:"mr-1.5 h-4 w-4"}),G]}),m&&(0,e.jsxs)(i.DropdownMenu,{children:[(0,e.jsx)(i.DropdownMenuTrigger,{disabled:u||Q,"aria-label":"Receipt paper width",title:`Receipt paper: ${g}`,className:(0,M.cn)((0,a.buttonVariants)({variant:"failed"===b?"destructive":p,size:h}),"rounded-l-none border-l-black/10 px-1.5 dark:border-l-white/15"),children:(0,e.jsx)(S.ChevronDown,{className:"h-3.5 w-3.5"})}),(0,e.jsxs)(i.DropdownMenuContent,{align:"end",className:"w-60",children:[(0,e.jsx)(i.DropdownMenuLabel,{children:"Receipt paper on this printer"}),(0,e.jsx)(i.DropdownMenuSeparator,{}),(0,e.jsx)(i.DropdownMenuRadioGroup,{value:g,onValueChange:t=>y(t),children:T.map(t=>(0,e.jsx)(i.DropdownMenuRadioItem,{value:t.value,className:"py-1.5",children:(0,e.jsxs)("span",{className:"flex flex-col",children:[(0,e.jsx)("span",{children:t.label}),(0,e.jsx)("span",{className:"text-xs text-muted-foreground",children:t.hint})]})},t.value))}),(0,e.jsx)(i.DropdownMenuSeparator,{}),(0,e.jsx)("p",{className:"px-2 py-1.5 text-xs text-muted-foreground",children:"Receipts go to the printer set as default on this computer. Change the printer in Windows Printers & scanners."})]})]})]})}],530917);let B=new Map,q=new Map,L=new Map,O=new Set,U=new Map,Q=new Set;async function z(t){if(!O.has(t)){O.add(t);try{for(;;){let e=L.get(t),n=e?.shift();if(!n)break;if(U.set(t,n),K(t),await function(){let t=globalThis.scheduler;return t&&"function"==typeof t.yield?t.yield():new Promise(t=>setTimeout(t,0))}(),n.cancelled){U.delete(t),K(t);continue}let a=Date.now();V(n,{state:"printing",position:0,timings:{...n.snapshot.timings,startedAt:a,queueWaitMs:a-n.snapshot.timings.createdAt}});let i={jobId:n.snapshot.jobId,timings:()=>n.snapshot.timings,composed:t=>V(n,{timings:{...n.snapshot.timings,composeMs:H(t)}}),connected:t=>V(n,{timings:{...n.snapshot.timings,connectMs:H(t)}}),sent:t=>V(n,{timings:{...n.snapshot.timings,sendMs:H(t)}}),attempt:t=>V(n,{attempt:t,timings:{...n.snapshot.timings,attempts:t}}),get cancelled(){return n.cancelled}};try{let t=await n.run(i);W(n,"printed",{result:t})}catch(e){let t=s(e,"print-failed");W(n,"failed",{error:{code:t.code,message:t.message}},t)}finally{U.get(t)===n&&U.delete(t),K(t)}}}finally{O.delete(t),(L.get(t)?.length??0)>0&&z(t)}}}function W(t,e,n,a){let i=Date.now();V(t,{state:e,position:0,...n,timings:{...t.snapshot.timings,finishedAt:i,totalMs:i-t.snapshot.timings.createdAt}}),q.delete(t.snapshot.key),"printed"===e?t.resolve(n.result):t.reject(a??new r(n.error?.code??"print-failed",n.error?.message??"Unable to print.")),function(t){if(!(0,N.printDebugEnabled)())return;let e=t.timings,n=`queue ${F(e.queueWaitMs)} \xb7 compose ${F(e.composeMs)} \xb7 connect ${F(e.connectMs)} \xb7 send ${F(e.sendMs)} \xb7 total ${F(e.totalMs)} \xb7 attempts ${e.attempts}`,a=`[print] ${t.documentType}${t.documentId?` ${t.documentId}`:""} → ${t.state}`;if("failed"===t.state?console.warn(`${a} (${t.error?.code}): ${n}`):console.debug(`${a}: ${n}`),"u">typeof performance&&"function"==typeof performance.measure&&e.finishedAt)try{performance.measure(`print:${t.documentType}`,{start:e.createdAt,end:e.finishedAt})}catch{}}(t.snapshot),setTimeout(()=>{B.get(t.snapshot.jobId)===t&&B.delete(t.snapshot.jobId)},3e4)}function K(t){let e=L.get(t);if(!e)return;let n=+!!U.has(t);e.forEach((t,e)=>{let a=e+n;t.snapshot.position!==a&&V(t,{position:a})})}function V(t,e){let n=t.snapshot.state;t.snapshot={...t.snapshot,...e},e.state&&e.state!==n&&(0,N.printTrace)(`job ${e.state}`,{jobId:t.snapshot.jobId,attempt:t.snapshot.attempt}),G(t)}function G(t){for(let e of t.listeners)try{e(t.snapshot)}catch{}for(let t of Q)try{t()}catch{}}function F(t){return void 0===t?"—":`${Math.round(t)}ms`}function H(t){return Math.round(10*t)/10}function J(t){return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function _(t){return Math.round(t).toLocaleString("en-US")}function X(t,e){return`${e.trim()} ${_(t)}`}function Y(t,e){let n=arguments.length>2&&void 0!==arguments[2]?arguments[2]:"";return`<div class="kv ${n}"><span class="k">${J(t)}</span><span class="v">${J(e)}</span></div>`}function Z(){let t=arguments.length>0&&void 0!==arguments[0]&&arguments[0];return`<hr class="rule${t?" dashed":""}">`}function tt(t){return t&&t.startsWith("data:image/")?`<img class="logo" src="${t}" alt="">`:""}function te(t,e,n){let a;return`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light only">
<title>${J(t)}</title>
<style>${a=t=>`${(t*e.scale).toFixed(2)}px`,`
  @page { size: ${e.paperWidthMm}mm 297mm; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body {
    font-family: ${d};
    font-size: ${a(m)};
    line-height: ${f};
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    -webkit-font-smoothing: antialiased;
  }
  .receipt {
    box-sizing: border-box;
    width: ${e.printableWidthMm}mm;
    margin: 0;
    padding: 1mm 0 0.5mm;
    color: #000;
    background: #fff;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .c { text-align: center; }
  .r { text-align: right; }
  .b { font-weight: 700; }
  .up { text-transform: uppercase; }
  .company { font-size: ${a(l)}; font-weight: 700; line-height: 1.15; text-transform: uppercase; letter-spacing: 0.02em; }
  .dept { font-size: ${a(c)}; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
  .doc-title { font-size: ${a(m)}; text-transform: uppercase; letter-spacing: 0.04em; }
  .sub { font-size: ${a(m)}; }
  .small { font-size: ${a(u)}; }
  .section { font-size: ${a(c)}; font-weight: 700; text-transform: uppercase; margin-top: 0.8mm; }
  .rule { border: 0; border-top: 1px solid #000; margin: 1.4mm 0; height: 0; }
  .rule.dashed { border-top-style: dashed; }
  .kv { display: flex; justify-content: space-between; align-items: baseline; gap: 2mm; }
  .kv .k { flex: 0 0 auto; white-space: nowrap; }
  .kv .v { flex: 1 1 auto; min-width: 0; text-align: right; font-variant-numeric: tabular-nums; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; column-gap: 3mm; row-gap: 0.2mm; }
  .meta .full { grid-column: 1 / -1; }
  table.items { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.items th {
    font-size: ${a(u)}; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;
    text-align: left; padding: 0.5mm 0 0.6mm; border-bottom: 1px solid #000;
  }
  table.items td { padding: 0.6mm 0; vertical-align: top; border-bottom: 1px dotted #777; }
  table.items tr:last-child td { border-bottom: 0; }
  table.items .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  table.items .qty { width: 11%; }
  table.items .rate { width: 20%; }
  table.items .amt { width: 24%; }
  table.items td.name { padding-right: 1.5mm; }
  .total { font-size: ${a(p)}; font-weight: 700; }
  .total .v { font-variant-numeric: tabular-nums; }
  .note { font-size: ${a(m)}; }
  .sign { display: flex; gap: 4mm; margin-top: 5mm; }
  .sign > div { flex: 1 1 0; border-top: 1px solid #000; padding-top: 0.6mm; font-size: ${a(u)}; text-transform: uppercase; }
  .footer { font-size: ${a(h)}; text-align: center; margin-top: 2mm; }
  img.logo { display: block; margin: 0 auto 1mm; height: 12mm; width: auto; max-width: 28mm; }
  #mb-gauge { position: absolute; top: 0; left: 0; width: ${e.paperWidthMm}mm; height: 0; visibility: hidden; }
  @media print { #mb-gauge { display: none; } }
  `}</style>
<style id="${$}"></style>
</head>
<body><div id="mb-gauge"></div><div class="receipt" id="mb-receipt">${n}</div></body>
</html>`}class tn extends Error{constructor(t){super(t),this.name="InvalidDocumentError"}}function ta(t,e){if(0===t.items.length&&0===t.packingItems.length)throw new tn("There are no waiting demands to print.");if(null!==t.totals.grandAmount){let e=t.branchItems.filter(t=>null!==t.amount);if(e.length!==t.branchItems.length)throw new tn("The grand amount is stated but a branch amount is unavailable.");let n=e.reduce((t,e)=>t+(e.amount??0),0);if(Math.abs(n-t.totals.grandAmount)>1)throw new tn(`The branch amounts do not add up to the grand total (${n} ≠ ${t.totals.grandAmount}).`)}let n=b(e),a=t.currencySymbol?.trim()||"Rs.",i=(t.companyName?.trim()||"MOUNTAIN BAKES").toUpperCase(),r=t.items.map(t=>`<tr><td class="name">${J(t.productName)}</td><td class="num amt">${_(t.qty)}</td></tr>`).join(""),o=t.packingItems.map(t=>`<tr><td class="name">${J(t.materialName)}</td><td class="num amt">${_(t.qty)}</td></tr>`).join(""),s=t.branchItems.map(t=>`<tr>
  <td class="name">${J(t.branchName)}</td>
  <td class="num qty">${_(t.qty)}</td>
  <td class="num amt">${null===t.amount?"N/A":X(t.amount,a)}</td>
</tr>`).join(""),d=`
<div class="c">
  ${tt(t.logo)}
  <div class="company">${J(i)}</div>
  <div class="dept">Production Department</div>
  <div class="doc-title">Production Demand Summary</div>
</div>
${Z()}
<div class="meta">
  ${Y("Business Date",t.businessDateText,"full")}
  ${Y("Printed",`${t.printDateText} ${t.printTimeText}`,"full")}
  ${t.statusText?Y("Status",t.statusText,"full"):""}
</div>
${Z()}
<div class="section">Product Demand</div>
<table class="items">
  <thead><tr><th class="name">Product</th><th class="num amt">Qty</th></tr></thead>
  <tbody>${r||'<tr><td colspan="2" class="note">No waiting demand.</td></tr>'}</tbody>
</table>
${Y("Total Qty",_(t.totals.totalProductQty))}
${Z()}
${t.packingItems.length>0?`<div class="section">Packing Material Requirements</div>
<table class="items">
  <thead><tr><th class="name">Packing Material</th><th class="num amt">Qty</th></tr></thead>
  <tbody>${o}</tbody>
</table>
${Y("Packing Qty",_(t.totals.totalPackingQty))}
${Z()}`:""}
<div class="section">Demand Totals</div>
${Y("Distinct Products",_(t.totals.distinctProducts))}
${Y("Total Product Qty",_(t.totals.totalProductQty))}
${t.totals.distinctPacking>0?Y("Distinct Packing Items",_(t.totals.distinctPacking)):""}
${t.totals.distinctPacking>0?Y("Total Packing Qty",_(t.totals.totalPackingQty)):""}
${Z()}
<div class="section">Branch-wise Summary</div>
<table class="items">
  <thead><tr><th class="name">Branch</th><th class="num qty">Qty</th><th class="num amt">Amount</th></tr></thead>
  <tbody>${s}</tbody>
</table>
${Y("Grand Qty",_(t.totals.totalProductQty))}
${Y("Grand Amount",null===t.totals.grandAmount?"Amount unavailable":X(t.totals.grandAmount,a),"total")}
${Z()}
<div class="footer">* Design &amp; developed by arifsiksavi@gmail.com | 0322-2050545 *</div>
`;return{kind:"demand-summary",id:t.businessDateText,title:"Production Demand Summary",paper:n,html:te("Production Demand Summary",n,d),mustContain:["Production Demand Summary",i]}}function ti(t,e,n,a){if(!("function"==typeof window.print&&"u">typeof document))return Promise.reject(new r("not-supported","This browser cannot open a print dialog, so the printer installed on this computer cannot be reached from here."));let{promise:i}=function(t){let e,n,a=q.get(t.key);if(a)return t.onUpdate&&(a.listeners.add(t.onUpdate),t.onUpdate(a.snapshot)),{jobId:a.snapshot.jobId,promise:a.promise,deduplicated:!0};let i="u">typeof crypto&&"function"==typeof crypto.randomUUID?crypto.randomUUID():`job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`,r=new Promise((t,a)=>{e=t,n=a});r.catch(()=>{});let o={snapshot:{jobId:i,key:t.key,printerKey:t.printerKey,documentType:t.documentType,documentId:t.documentId,state:"queued",position:0,attempt:0,timings:{createdAt:Date.now(),attempts:0}},run:t.run,listeners:new Set(t.onUpdate?[t.onUpdate]:[]),resolve:e,reject:n,promise:r,cancelled:!1};B.set(i,o),q.set(t.key,o);let s=L.get(t.printerKey)??[];return s.push(o),L.set(t.printerKey,s),K(t.printerKey),G(o),z(t.printerKey),{jobId:i,promise:r,deduplicated:!1}}({key:`${e}:${t||"none"}${a.requestId?`:${a.requestId}`:""}`,printerKey:"system-default",documentType:e,documentId:t||null,onUpdate:a.onJobUpdate,run:t=>tr(n,t)});return i}async function tr(t,e){let n,a=Date.now(),i=tc();try{n=t()}catch(t){if(t instanceof tn)throw new r("invalid-document",t.message);throw t}return e.composed(tc()-i),(0,N.printTrace)("document composed",{ms:Math.round(tc()-i),bytes:n.html.length,kind:n.kind}),await to(n,e),{printJobId:e.jobId,durationMs:Date.now()-a}}async function to(t,e){let n=window.document,a=n.createElement("iframe");a.setAttribute("aria-hidden","true"),a.setAttribute("tabindex","-1"),a.title=t.title,a.style.cssText=`position:absolute;top:-10000px;left:-10000px;width:${t.paper.paperWidthMm+20}mm;height:400mm;border:0;background:#fff`;let i=()=>{window.setTimeout(()=>a.remove(),1e3)};n.body.appendChild(a);try{let n=tc();await new Promise((e,n)=>{let i=window.setTimeout(()=>n(new r("timeout","The receipt could not be prepared for the printer. Try again.")),1e4);a.addEventListener("load",()=>{window.clearTimeout(i),e()},{once:!0}),a.srcdoc=t.html});let i=a.contentWindow,o=a.contentDocument;if(!i||!o)throw new r("print-failed","The receipt could not be prepared for the printer. Try again.");(0,N.printTrace)("receipt frame loaded"),await td(o),function(t,e){try{let n=t.getElementById("mb-gauge"),a=t.getElementById("mb-receipt"),i=t.getElementById($);if(!n||!a||!i)return;let r=n.getBoundingClientRect().width/e;if(!(r>0))return;let o=a.getBoundingClientRect().height/r;if(!(o>0))return;let s=Math.ceil(o)+2;i.textContent=`@page { size: ${e}mm ${s}mm; margin: 0; }`}catch{}}(o,t.paper.paperWidthMm),function(t,e){let n=t.getElementById("mb-receipt"),a=n?.getBoundingClientRect();if(!n||!a||!(a.height>0)||!(a.width>0))throw new r("invalid-document","Print document is empty. Nothing was sent to the printer.");let i=tl(n.innerText||n.textContent||"");if(0===i.length)throw new r("invalid-document","Print document is empty. Nothing was sent to the printer.");let o=e.mustContain.filter(t=>!i.includes(tl(t)));if(o.length>0)throw new r("invalid-document","Print document is incomplete. Nothing was sent to the printer.",`missing: ${o.join(", ")}`)}(o,t),e.connected(tc()-n),(0,N.printTrace)("receipt fitted and verified",{ms:Math.round(tc()-n)});let d=tc();await new Promise((t,e)=>{let n=!1,a=0,r=0,d=()=>{window.clearTimeout(a),window.clearTimeout(r),i.removeEventListener("afterprint",l),window.removeEventListener("afterprint",l)};function l(){n||(n=!0,d(),(0,N.printTrace)("print dialog finished"),t())}i.addEventListener("afterprint",l),window.addEventListener("afterprint",l),a=window.setTimeout(l,3e4);try{if((0,R.isIOS)()){let t=function(t){let e=window.document;e.getElementById(ts)?.remove();let n=e.createElement("div");n.id=ts;let a=n.attachShadow({mode:"open"});for(let n of Array.from(t.querySelectorAll("style"))){if(n.id===$)continue;let t=e.createElement("style");t.textContent=(n.textContent??"").replace(/@page\s*\{[^}]*\}/g,"").replace(/\bhtml\s*,\s*body\b/g,":host").replace(/(^|[}\s])body(\s*\{)/g,"$1:host$2"),a.appendChild(t)}let i=t.getElementById("mb-receipt");i&&a.appendChild(e.importNode(i,!0));let r=t.getElementById($)?.textContent??"",o=e.createElement("style");return o.textContent=`
    #${ts} { display: none; }
    @media print {
      html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
      body > *:not(#${ts}) { display: none !important; }
      #${ts} { display: block !important; }
    }
    ${r}
  `,e.head.appendChild(o),e.body.appendChild(n),()=>{o.remove(),n.remove()}}(o),e=()=>window.setTimeout(t,1e3);window.addEventListener("afterprint",e,{once:!0}),window.setTimeout(e,3e4),(0,N.printTrace)("top-document print() called (iOS)"),window.print();return}i.focus(),(0,N.printTrace)("frame print() called"),i.print(),(0,N.printTrace)("frame print() returned")}catch(t){n=!0,d(),e(s(t,"print-failed"));return}r=window.setTimeout(l,1500)}),e.sent(tc()-d)}catch(t){throw i(),s(t,"print-failed")}i()}let ts="mb-ios-print";async function td(t){let e=t.fonts?.ready,n=Array.from(t.images).filter(t=>!t.complete).map(t=>"function"==typeof t.decode?t.decode().catch(()=>void 0):Promise.resolve()),a=Promise.all([e??Promise.resolve(),...n]);await Promise.race([a,new Promise(t=>setTimeout(t,1500))]),await new Promise(e=>{let n=(t.defaultView??window).requestAnimationFrame;"function"==typeof n?n(()=>e()):e()})}function tl(t){return t.replace(/\s+/g," ").trim().toLowerCase()}function tc(){return"u">typeof performance?performance.now():Date.now()}t.s(["demandSummaryDocument",0,function(t){let e=arguments.length>1&&void 0!==arguments[1]?arguments[1]:"80mm";return ta(t,e)},"printBranchClosing",0,function(t){let e=arguments.length>1&&void 0!==arguments[1]?arguments[1]:{};return ti(`${t.branchName}-${t.businessDateText}`,"branch-closing",()=>(function(t,e){if(!t.branchName?.trim())throw new tn("This closing sheet has no branch to print.");if(!t.businessDateText?.trim())throw new tn("This closing sheet has no business date to print.");let n=t.paymentLines.reduce((t,e)=>t+e.amount,0);if(Math.abs(n-t.totalSales)>1)throw new tn(`The payment method totals do not add up to total sales (${n} ≠ ${t.totalSales}).`);let a=b(e),i=t.currencySymbol?.trim()||"Rs.",r=(t.companyName?.trim()||"MOUNTAIN BAKES").toUpperCase(),o=t.branchName.trim(),s=t.stockLines.map(t=>`<tr><td class="name">${J(t.productName)}</td><td class="num amt">${_(t.balance)}</td></tr>`).join(""),d=t.paymentLines.map(t=>Y(t.label,X(t.amount,i))).join(""),l=`
<div class="c">
  ${tt(t.logo)}
  <div class="company">${J(r)}</div>
  <div class="dept">Branch Closing</div>
  <div class="sub">${J(o)}</div>
</div>
${Z()}
<div class="meta">
  ${Y("Business Date",t.businessDateText,"full")}
  ${Y("Printed",`${t.printDateText} ${t.printTimeText}`,"full")}
</div>
${Z()}
<div class="section">Balance Stock</div>
<table class="items">
  <thead><tr><th class="name">Product</th><th class="num amt">Balance</th></tr></thead>
  <tbody>${s||'<tr><td colspan="2" class="note">No balance stock.</td></tr>'}</tbody>
</table>
${Z()}
<div class="section">Payment Details</div>
${d||'<div class="note">No sales recorded for this date.</div>'}
${Z()}
${Y("Total Sales",X(t.totalSales,i))}
${t.discounts>0?Y("Discounts",X(t.discounts,i)):""}
${Y("Expenses",X(t.totalExpenses,i))}
${Y("Closing Cash",X(t.cashInHand,i),"total")}
${Y("Orders / Cancelled",`${_(t.orderCount)} / ${_(t.cancelled)}`)}
${Z()}
<div class="footer">End of Closing Report</div>
`;return{kind:"branch-closing",id:`${o}-${t.businessDateText}`,title:`Branch Closing — ${o}`,paper:a,html:te(`Branch Closing — ${o}`,a,l),mustContain:["Branch Closing",r,o]}})(t,e.paper??"80mm"),e)},"printDemandSummary",0,function(t){let e=arguments.length>1&&void 0!==arguments[1]?arguments[1]:{};return ti(t.businessDateText,"demand-summary",()=>ta(t,e.paper??"80mm"),e)},"printProductionOrder",0,function(t){let e=arguments.length>1&&void 0!==arguments[1]?arguments[1]:{};return ti(t.orderNumber,"production-order",()=>{var n,a,i,r;let o,s,d,l,c,m,u,p,h,f,g;return n=e.paper??"80mm",!function(t){if(!t.orderNumber?.trim())throw new tn("This order has no reference number to print.");let e=t.items.filter(t=>t.qty>0),n=t.packingItems??[];if(0===e.length&&0===n.length)throw new tn("This order has no approved items or packing materials to print.");let a=e.reduce((t,e)=>t+e.amount,0);if(Math.abs(a-t.grandTotal)>1)throw new tn(`The order lines do not add up to the total (${a} ≠ ${t.grandTotal}).`);let i=new Set;for(let t of n){let e=t.materialName?.trim();if(!e)throw new tn("A packing material on this order has no name.");if(!(t.qty>0))throw new tn(`"${e}" has no quantity and should not be on the print.`);let n=e.toLowerCase();if(i.has(n))throw new tn(`"${e}" appears twice on this order.`);i.add(n)}}(t),o=b(n),s=t.currencySymbol?.trim()||"Rs.",d=(t.companyName?.trim()||"MOUNTAIN BAKES").toUpperCase(),l=t.items.filter(t=>t.qty>0),c=t.packingItems??[],m=l.reduce((t,e)=>t+e.qty,0),u=X(t.grandTotal,s),p=l.map(t=>`<tr>
  <td class="name">${J(t.productName)}</td>
  <td class="num qty">${_(t.qty)}</td>
  <td class="num rate">${_(t.unitPrice)}</td>
  <td class="num amt">${_(t.amount)}</td>
</tr>`).join(""),h=`
<div class="c">
  ${tt(t.logo)}
  <div class="company">${J(d)}</div>
  <div class="dept">Production Department</div>
  <div class="doc-title">Production Order</div>
</div>
${Z()}
<div class="meta">
  ${Y("Order No",t.orderNumber,"full")}
  ${Y("Branch",t.branchName||"—","full")}
  ${Y("Date",t.dateText)}
  ${Y("Time",t.timeText||"—")}
  ${Y("Required Date",t.requiredDateText||"—","full")}
</div>
${Z()}
<table class="items">
  <thead><tr><th class="name">Product</th><th class="num qty">Qty</th><th class="num rate">Rate</th><th class="num amt">Amount</th></tr></thead>
  <tbody>${p}</tbody>
</table>
${Z()}
${Y("Total Qty",_(m))}
${Y("TOTAL",u,"total")}
${Z()}
${c.length>0?(f=(a=c).map(t=>`<tr>
  <td class="name">${J(t.materialName)}</td>
  <td class="num amt">${_(t.qty)}</td>
</tr>`).join(""),g=a.reduce((t,e)=>t+e.qty,0),`<div class="section">Packing Materials</div>
<table class="items">
  <thead><tr><th class="name">Packing Material</th><th class="num amt">Qty</th></tr></thead>
  <tbody>${f}</tbody>
</table>
${Y("Packing Qty",_(g))}
${Z()}`):""}
${void 0===t.previousCollection?"":(i=t.previousCollection,r=s,i?`<div class="section">Previous Order Balance</div>
<div class="small">${Y("Order No",i.reference)}${Y("Order Date",i.dateText)}</div>
${Y("Previous Order",X(i.orderedValue,r))}
${Y("Delivered Value",X(i.deliveredValue,r))}
${Y("Company Share",X(i.companyShare,r))}
${Y("Less Returns",X(i.returnsAmount,r))}
${Y("Less Discount",X(i.discountsAmount,r))}
${Z(!0)}
${Y("AMOUNT TO COLLECT",X(i.amountToCollect,r),"total")}
${void 0===i.paymentsReceived?"":`${Y("Payment Received",X(i.paymentsReceived,r))}
${Y("Remaining Balance",X(i.remainingBalance??Math.max(0,i.amountToCollect-i.paymentsReceived),r))}
`}${Z()}`:`<div class="section">Previous Order Balance</div>
<div class="note">No previous delivery — nothing to collect.</div>
${Z()}`)}
<div class="sign"><div>Collected By</div><div>Received By</div></div>
<div class="footer">* Design &amp; developed by arifsiksavi@gmail.com | 0322-2050545 *</div>
`,{kind:"production-order",id:t.orderNumber,title:`Production order ${t.orderNumber}`,paper:o,html:te(`Production order ${t.orderNumber}`,o,h),mustContain:[t.orderNumber,u,d,...c.map(t=>t.materialName)]}},e)},"printSaleReceipt",0,function(t){let e=arguments.length>1&&void 0!==arguments[1]?arguments[1]:{};return ti(t.saleId,"sale",()=>(function(t,e){if(!t.items||0===t.items.length)throw new tn("This sale has no items to print.");if(!t.saleId?.trim())throw new tn("This sale has no reference number yet.");if(!t.paymentMethodLabel?.trim())throw new tn("This sale has no payment method recorded.");if(Math.abs(t.grossTotal-t.discountTotal+t.taxAmount-t.grandTotal)>1)throw new tn(`The sale totals do not reconcile (gross ${t.grossTotal} - discount ${t.discountTotal} + tax ${t.taxAmount} ≠ total ${t.grandTotal}).`);let n=b(e),a=t.currencySymbol?.trim()||"Rs.",i=(t.companyName?.trim()||"MOUNTAIN BAKES").toUpperCase(),r=X(t.grandTotal,a),o=t.items.map(t=>`<tr>
  <td class="name">${J(t.productName)}</td>
  <td class="num qty">${_(t.qty)}</td>
  <td class="num rate">${_(t.unitPrice)}</td>
  <td class="num amt">${_(t.lineTotal)}</td>
</tr>`).join(""),s=`
<div class="c">
  ${tt(t.logo)}
  <div class="company">${J(i)}</div>
  <div class="dept">Sale Receipt</div>
  ${t.branchName?.trim()?`<div class="sub">${J(t.branchName.trim())}</div>`:""}
</div>
${Z()}
<div class="meta">
  ${Y("Sale ID",t.saleId,"full")}
  ${Y("Date",t.dateText)}
  ${Y("Time",t.timeText)}
  ${t.customerName?.trim()?Y("Customer",t.customerName.trim(),"full"):""}
  ${t.customerPhone?.trim()?Y("Mobile",t.customerPhone.trim(),"full"):""}
</div>
${Z()}
<table class="items">
  <thead><tr><th class="name">Product</th><th class="num qty">Qty</th><th class="num rate">Rate</th><th class="num amt">Amount</th></tr></thead>
  <tbody>${o}</tbody>
</table>
${Z()}
${Y("Gross Total",X(t.grossTotal,a))}
${Y("Discount",X(t.discountTotal,a))}
${t.taxAmount>0?Y("Government Tax",X(t.taxAmount,a)):""}
${Y("TOTAL",r,"total")}
${null!=t.receivedCash?Y("Cash Received",X(t.receivedCash,a))+Y("Cash Returned",X(t.cashReturned??0,a)):""}
${Z()}
<div class="b up">Payment Method: ${J(t.paymentMethodLabel)}</div>
<div class="footer">
  <div>************************</div>
  <div>Phone: +92 347 9782409</div>
  <div>Thank you for choosing Mountain Bakes! We truly appreciate your support. Best wishes!</div>
  <div>************************</div>
</div>
`;return{kind:"sale",id:t.saleId,title:`Receipt ${t.saleId}`,paper:n,html:te(`Receipt ${t.saleId}`,n,s),mustContain:[t.saleId,r,i]}})(t,e.paper??"80mm"),e)}],828844)}]);