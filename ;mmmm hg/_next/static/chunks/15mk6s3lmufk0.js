(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,713770,e=>{"use strict";var t=e.i(950309);let n=new Map,r=new Map,i=new Set;function a(e){return i.add(e),()=>{i.delete(e)}}e.s(["useCachedLogo",0,function(e){let o=(0,t.useSyncExternalStore)(a,()=>(function(e){if(e)return n.get(e)??e})(e),()=>e??void 0);return(0,t.useEffect)(()=>{e&&!n.has(e)&&function(e){if(!e)return Promise.resolve(void 0);let t=n.get(e);if(t)return Promise.resolve(t);if(r.get(e))return;let a=(async()=>{let t=e;try{let n=await fetch(e,{mode:"cors",credentials:"omit"});if(n.ok){var a;let e=await n.blob();e.size>0&&e.size<=15e5&&e.type.startsWith("image/")&&(t=await (a=e,new Promise((e,t)=>{let n=new FileReader;n.onload=()=>e(String(n.result)),n.onerror=()=>t(n.error??Error("read failed")),n.readAsDataURL(a)})))}}catch{}for(let a of(n.set(e,t),r.delete(e),i))a();return t})();r.set(e,a)}(e)},[e]),o}])},12294,e=>{"use strict";let t=(0,e.i(818909).default)("Printer",[["path",{d:"M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2",key:"143wyd"}],["path",{d:"M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6",key:"1itne7"}],["rect",{x:"6",y:"14",width:"12",height:"8",rx:"1",key:"1ue0tg"}]]);e.s(["Printer",0,t],12294)},454375,e=>{"use strict";var t=e.i(145694);e.s(["printDocument",0,function(){let{onAfterPrint:e}=arguments.length>0&&void 0!==arguments[0]?arguments[0]:{};window.addEventListener("afterprint",function n(){window.removeEventListener("afterprint",n),(0,t.printTrace)("afterprint handled"),e?.()}),(0,t.printTrace)("window.print() called"),window.print(),(0,t.printTrace)("window.print() returned")},"whenPrintAreaReady",0,function(){let e=arguments.length>0&&void 0!==arguments[0]?arguments[0]:1500;return new Promise(n=>{let r=!1,i=()=>{r||(r=!0,n())},a=window.setTimeout(i,e);requestAnimationFrame(()=>{requestAnimationFrame(()=>{let e=Array.from(document.querySelectorAll(".print-area img"));(0,t.printTrace)("print DOM laid out",{images:e.length,pending:e.filter(e=>!e.complete).length}),Promise.all(e.filter(e=>!e.complete).map(e=>"function"==typeof e.decode?e.decode().catch(()=>void 0):Promise.resolve())).then(()=>{window.clearTimeout(a),i()})})})})}])},612710,771982,e=>{"use strict";var t=e.i(558221),n=e.i(519455),r=e.i(755146),i=e.i(12294),a=e.i(436022),o=e.i(239050),s=e.i(950309);let l="mb.printMode",d="mb:print-mode",c=null;function m(){return null===c&&(c=function(){if("function"!=typeof window.print)return"save";let e=navigator;if("boolean"==typeof e.userAgentData?.mobile)return e.userAgentData.mobile?"save":"print";let t=navigator.userAgent,n=/Macintosh/i.test(t)&&navigator.maxTouchPoints>1;return/Android|iPhone|iPod|iPad|Mobile/i.test(t)||n?"save":"print"}()),c}function u(){try{let e=localStorage.getItem(l);return"print"===e||"save"===e?e:"auto"}catch{return"auto"}}function p(e){return window.addEventListener("storage",e),window.addEventListener(d,e),()=>{window.removeEventListener("storage",e),window.removeEventListener(d,e)}}function h(){let e=(0,s.useSyncExternalStore)(p,u,()=>"auto"),t=(0,s.useSyncExternalStore)(p,m,()=>"print"),n=(0,s.useCallback)(e=>{try{"auto"===e?localStorage.removeItem(l):localStorage.setItem(l,e)}catch{}window.dispatchEvent(new Event(d))},[]),r="auto"===e?t:e;return{mode:r,canPrint:"print"===r,preference:e,detected:t,setPreference:n}}e.s(["usePrintCapability",0,h],771982);var f=e.i(454375),g=e.i(975157);let w=[{value:"auto",label:"Detect automatically",hint:"Guess from the device"},{value:"print",label:"This device has a printer",hint:"Always offer Print"},{value:"save",label:"No printer on this device",hint:"Always offer Save as PDF"}];e.s(["PrintButton",0,function(e){let{onPrint:s,printLabel:l="Print",saveLabel:d="Save as PDF",showMenu:c=!0,disabled:m,variant:u="default",size:p="default",className:v,buttonClassName:y}=e,{mode:b,preference:$,setPreference:x}=h(),T="save"===b;return(0,t.jsxs)("div",{className:(0,g.cn)("no-print inline-flex items-stretch",v),children:[(0,t.jsxs)(n.Button,{variant:u,size:p,disabled:m,onClick:function(){s?s():(0,f.printDocument)()},className:(0,g.cn)("flex-1",c&&"rounded-r-none",y),title:T?"Save this document as a PDF":"Send this document to a printer",children:[T?(0,t.jsx)(a.Download,{className:"mr-1.5 h-4 w-4"}):(0,t.jsx)(i.Printer,{className:"mr-1.5 h-4 w-4"}),T?d:l]}),c&&(0,t.jsxs)(r.DropdownMenu,{children:[(0,t.jsx)(r.DropdownMenuTrigger,{disabled:m,"aria-label":"Printer availability",title:"Printer availability",className:(0,g.cn)((0,n.buttonVariants)({variant:u,size:p}),"rounded-l-none border-l-black/10 px-1.5 dark:border-l-white/15",y),children:(0,t.jsx)(o.ChevronDown,{className:"h-3.5 w-3.5"})}),(0,t.jsxs)(r.DropdownMenuContent,{align:"end",className:"w-64",children:[(0,t.jsx)(r.DropdownMenuLabel,{children:"Printer on this device"}),(0,t.jsx)(r.DropdownMenuSeparator,{}),(0,t.jsx)(r.DropdownMenuRadioGroup,{value:$,onValueChange:e=>x(e),children:w.map(e=>(0,t.jsx)(r.DropdownMenuRadioItem,{value:e.value,className:"py-1.5",children:(0,t.jsxs)("span",{className:"flex flex-col",children:[(0,t.jsx)("span",{children:e.label}),(0,t.jsx)("span",{className:"text-xs text-muted-foreground",children:e.hint})]})},e.value))})]})]})]})}],612710)},260591,e=>{"use strict";var t=e.i(558221),n=e.i(950309),r=e.i(906093);let i=()=>()=>{};e.s(["PrintPortal",0,function(e){let{children:a,active:o=!0}=e;return(0,n.useSyncExternalStore)(i,()=>!0,()=>!1)&&o?(0,r.createPortal)((0,t.jsx)("div",{className:"print-area print-only",children:a}),document.body):null}])},813304,e=>{"use strict";var t=e.i(950309),n=e.i(454375),r=e.i(145694);e.s(["useDocumentPrint",0,function(){let[e,i]=(0,t.useState)(!1),a=(0,t.useRef)(null),o=(0,t.useCallback)(function(){let e=arguments.length>0&&void 0!==arguments[0]?arguments[0]:{};(0,r.beginPrintTrace)("document-print"),(0,r.printTrace)("print requested"),a.current=e,i(!0)},[]);return(0,t.useEffect)(()=>{if(!e)return;let t=!1,o=!1,s=a.current??{};a.current=null;let l=()=>{o||(o=!0,window.clearTimeout(d),t||i(!1),(0,r.printTrace)("print DOM released"),s.onAfterPrint?.())},d=window.setTimeout(l,12e4);return(0,r.printTrace)("print DOM mounted"),(0,n.whenPrintAreaReady)().then(()=>{t||((0,r.printTrace)("print area ready"),(0,n.printDocument)({...s,onAfterPrint:l}))}),()=>{t=!0,window.clearTimeout(d)}},[e]),{printing:e,print:o}}])},530917,740358,41447,828844,e=>{"use strict";var t=e.i(558221),n=e.i(950309),r=e.i(519455),i=e.i(755146);class a extends Error{code;detail;constructor(e,t,n){super(t),this.name="PosPrintError",this.code=e,this.detail=n??null}}function o(e){return"invalid-document"!==e&&"not-supported"!==e}function s(e){let t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:"print-failed";if(e instanceof a)return e;let n=e instanceof Error?`${e.name}: ${e.message}`:String(e);return new a(t,function(e){switch(e){case"not-supported":return"This browser cannot print. Open Mountain Bakes in Chrome or Edge on the till.";case"invalid-document":return"Print document is empty. Nothing was sent to the printer.";case"timeout":return"The receipt could not be prepared for the printer in time. Try again.";case"cancelled":return"Printing was cancelled.";case"print-failed":return"Printing failed. Check the printer is switched on and set as the default printer on this computer."}}(t),n)}e.s(["PosPrintError",0,a,"asPrintError",0,s,"isRetryable",0,o],740358);let l='Arial, Helvetica, "Liberation Sans", "DejaVu Sans", sans-serif',d=16,c=12,m=11,u=9.5,p=13,h=9,f=1.3,g={"80mm":{id:"80mm",paperWidthMm:80,printableWidthMm:72,scale:1},"58mm":{id:"58mm",paperWidthMm:58,printableWidthMm:48,scale:.86}},w="80mm";function v(e){return g[e??w]??g[w]}let y="mb-page",b="mb.receiptPaper",$="mb:receipt-paper",x=[{value:"80mm",label:"80mm roll",hint:"Standard receipt printer"},{value:"58mm",label:"58mm roll",hint:"Narrow receipt printer"}];function T(){try{let e=localStorage.getItem(b);return"58mm"===e||"80mm"===e?e:w}catch{return w}}function P(e){return window.addEventListener("storage",e),window.addEventListener($,e),()=>{window.removeEventListener("storage",e),window.removeEventListener($,e)}}function D(){return{paper:(0,n.useSyncExternalStore)(P,T,()=>w),setPaper:(0,n.useCallback)(e=>(function(e){try{localStorage.setItem(b,e)}catch{}window.dispatchEvent(new Event($))})(e),[])}}e.s(["PAPER_OPTIONS",0,x,"useReceiptPaper",0,D],41447);var M=e.i(145694),N=e.i(975157),k=e.i(998354),S=e.i(394396),C=e.i(239050),j=e.i(562749),A=e.i(160231),E=e.i(12294),I=e.i(730687),R=e.i(108059);e.s(["PopPrintButton",0,function(e){let{print:s,label:l="POP Print",onPrinted:d,autoPrint:c=!1,showPaperMenu:m=!0,disabled:u,variant:p="default",size:h="default",className:f}=e,{paper:g,setPaper:w}=D(),[v,y]=(0,n.useState)("idle"),[b,$]=(0,n.useState)(0),[T,P]=(0,n.useState)(null),B=(0,n.useRef)(null),q=(0,n.useRef)(!0);(0,n.useEffect)(()=>(q.current=!0,()=>{q.current=!1,B.current&&clearTimeout(B.current)}),[]);let L=(0,n.useRef)(s),O=(0,n.useRef)(d),U=(0,n.useRef)(g);(0,n.useEffect)(()=>{L.current=s,O.current=d,U.current=g},[s,d,g]);let Q="printing"===v||"queued"===v,z=(0,n.useRef)(!1),W=e=>{B.current&&clearTimeout(B.current),B.current=setTimeout(()=>{q.current&&(y("idle"),P(null))},e)},K=(0,n.useCallback)(async()=>{if(z.current)return;z.current=!0,(0,M.beginPrintTrace)("pop-print"),(0,M.printTrace)("button pressed",{label:l}),y("printing"),$(0),P(null);let e={paper:U.current,onJobUpdate:e=>{q.current&&("queued"===e.state?(y("queued"),$(e.position)):"printing"===e.state&&(y("printing"),$(0)))}};try{let t=await L.current(e);if((0,M.printTrace)("print promise resolved",{ms:t.durationMs}),!q.current)return;y("printed"),(0,R.isIOS)()?I.toast.info("Sent to the print sheet",{duration:1200}):I.toast.success("Printed successfully",{duration:1200}),O.current?.(t),W(1200)}catch(t){if(!q.current)return;let e=t instanceof a?t:new a("print-failed","Printing failed. Check the printer is switched on and set as the default printer on this computer.");(0,M.printTrace)("print promise rejected",{code:e.code,detail:e.detail}),y("failed"),P({code:e.code,message:e.message}),I.toast.error("invalid-document"===e.code?"Print document is empty":"Printing failed",{description:e.message,duration:3500}),W(3500)}finally{z.current=!1}},[l]),V=(0,n.useRef)(!1);(0,n.useEffect)(()=>{!c||V.current||u||(V.current=!0,K())},[c,u,K]);let F="queued"===v?b>0?`Queued (${b} ahead)`:"Queued…":"printing"===v?"Printing…":"printed"===v?"Printed":"failed"===v?"Print Failed":l,G="failed"===v&&T?`${T.message}${o(T.code)?" Press to try again.":""}`:`Print this receipt on the ${g} roll of this computer's default printer`;return(0,t.jsxs)("div",{className:(0,N.cn)("no-print inline-flex items-stretch",f),children:[(0,t.jsxs)(r.Button,{variant:"failed"===v?"destructive":p,size:h,disabled:u||Q,onClick:K,className:(0,N.cn)("flex-1",m&&"rounded-r-none"),title:G,"aria-busy":Q||void 0,children:["printing"===v&&(0,t.jsx)(A.Loader2,{className:"mr-1.5 h-4 w-4 animate-spin"}),"queued"===v&&(0,t.jsx)(j.Clock,{className:"mr-1.5 h-4 w-4"}),"printed"===v&&(0,t.jsx)(S.Check,{className:"mr-1.5 h-4 w-4"}),"failed"===v&&(0,t.jsx)(k.AlertTriangle,{className:"mr-1.5 h-4 w-4"}),"idle"===v&&(0,t.jsx)(E.Printer,{className:"mr-1.5 h-4 w-4"}),F]}),m&&(0,t.jsxs)(i.DropdownMenu,{children:[(0,t.jsx)(i.DropdownMenuTrigger,{disabled:u||Q,"aria-label":"Receipt paper width",title:`Receipt paper: ${g}`,className:(0,N.cn)((0,r.buttonVariants)({variant:"failed"===v?"destructive":p,size:h}),"rounded-l-none border-l-black/10 px-1.5 dark:border-l-white/15"),children:(0,t.jsx)(C.ChevronDown,{className:"h-3.5 w-3.5"})}),(0,t.jsxs)(i.DropdownMenuContent,{align:"end",className:"w-60",children:[(0,t.jsx)(i.DropdownMenuLabel,{children:"Receipt paper on this printer"}),(0,t.jsx)(i.DropdownMenuSeparator,{}),(0,t.jsx)(i.DropdownMenuRadioGroup,{value:g,onValueChange:e=>w(e),children:x.map(e=>(0,t.jsx)(i.DropdownMenuRadioItem,{value:e.value,className:"py-1.5",children:(0,t.jsxs)("span",{className:"flex flex-col",children:[(0,t.jsx)("span",{children:e.label}),(0,t.jsx)("span",{className:"text-xs text-muted-foreground",children:e.hint})]})},e.value))}),(0,t.jsx)(i.DropdownMenuSeparator,{}),(0,t.jsx)("p",{className:"px-2 py-1.5 text-xs text-muted-foreground",children:"Receipts go to the printer set as default on this computer. Change the printer in Windows Printers & scanners."})]})]})]})}],530917);let B=new Map,q=new Map,L=new Map,O=new Set,U=new Map,Q=new Set;async function z(e){if(!O.has(e)){O.add(e);try{for(;;){let t=L.get(e),n=t?.shift();if(!n)break;if(U.set(e,n),K(e),await function(){let e=globalThis.scheduler;return e&&"function"==typeof e.yield?e.yield():new Promise(e=>setTimeout(e,0))}(),n.cancelled){U.delete(e),K(e);continue}let r=Date.now();V(n,{state:"printing",position:0,timings:{...n.snapshot.timings,startedAt:r,queueWaitMs:r-n.snapshot.timings.createdAt}});let i={jobId:n.snapshot.jobId,timings:()=>n.snapshot.timings,composed:e=>V(n,{timings:{...n.snapshot.timings,composeMs:H(e)}}),connected:e=>V(n,{timings:{...n.snapshot.timings,connectMs:H(e)}}),sent:e=>V(n,{timings:{...n.snapshot.timings,sendMs:H(e)}}),attempt:e=>V(n,{attempt:e,timings:{...n.snapshot.timings,attempts:e}}),get cancelled(){return n.cancelled}};try{let e=await n.run(i);W(n,"printed",{result:e})}catch(t){let e=s(t,"print-failed");W(n,"failed",{error:{code:e.code,message:e.message}},e)}finally{U.get(e)===n&&U.delete(e),K(e)}}}finally{O.delete(e),(L.get(e)?.length??0)>0&&z(e)}}}function W(e,t,n,r){let i=Date.now();V(e,{state:t,position:0,...n,timings:{...e.snapshot.timings,finishedAt:i,totalMs:i-e.snapshot.timings.createdAt}}),q.delete(e.snapshot.key),"printed"===t?e.resolve(n.result):e.reject(r??new a(n.error?.code??"print-failed",n.error?.message??"Unable to print.")),function(e){if(!(0,M.printDebugEnabled)())return;let t=e.timings,n=`queue ${G(t.queueWaitMs)} \xb7 compose ${G(t.composeMs)} \xb7 connect ${G(t.connectMs)} \xb7 send ${G(t.sendMs)} \xb7 total ${G(t.totalMs)} \xb7 attempts ${t.attempts}`,r=`[print] ${e.documentType}${e.documentId?` ${e.documentId}`:""} → ${e.state}`;if("failed"===e.state?console.warn(`${r} (${e.error?.code}): ${n}`):console.debug(`${r}: ${n}`),"u">typeof performance&&"function"==typeof performance.measure&&t.finishedAt)try{performance.measure(`print:${e.documentType}`,{start:t.createdAt,end:t.finishedAt})}catch{}}(e.snapshot),setTimeout(()=>{B.get(e.snapshot.jobId)===e&&B.delete(e.snapshot.jobId)},3e4)}function K(e){let t=L.get(e);if(!t)return;let n=+!!U.has(e);t.forEach((e,t)=>{let r=t+n;e.snapshot.position!==r&&V(e,{position:r})})}function V(e,t){let n=e.snapshot.state;e.snapshot={...e.snapshot,...t},t.state&&t.state!==n&&(0,M.printTrace)(`job ${t.state}`,{jobId:e.snapshot.jobId,attempt:e.snapshot.attempt}),F(e)}function F(e){for(let t of e.listeners)try{t(e.snapshot)}catch{}for(let e of Q)try{e()}catch{}}function G(e){return void 0===e?"—":`${Math.round(e)}ms`}function H(e){return Math.round(10*e)/10}function J(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function _(e){return Math.round(e).toLocaleString("en-US")}function X(e,t){return`${t.trim()} ${_(e)}`}function Y(e,t){let n=arguments.length>2&&void 0!==arguments[2]?arguments[2]:"";return`<div class="kv ${n}"><span class="k">${J(e)}</span><span class="v">${J(t)}</span></div>`}function Z(){let e=arguments.length>0&&void 0!==arguments[0]&&arguments[0];return`<hr class="rule${e?" dashed":""}">`}function ee(e){return e&&e.startsWith("data:image/")?`<img class="logo" src="${e}" alt="">`:""}function et(e,t,n){let r;return`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light only">
<title>${J(e)}</title>
<style>${r=e=>`${(e*t.scale).toFixed(2)}px`,`
  @page { size: ${t.paperWidthMm}mm 297mm; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body {
    font-family: ${l};
    font-size: ${r(m)};
    line-height: ${f};
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    -webkit-font-smoothing: antialiased;
  }
  .receipt {
    box-sizing: border-box;
    width: ${t.printableWidthMm}mm;
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
  .company { font-size: ${r(d)}; font-weight: 700; line-height: 1.15; text-transform: uppercase; letter-spacing: 0.02em; }
  .dept { font-size: ${r(c)}; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
  .doc-title { font-size: ${r(m)}; text-transform: uppercase; letter-spacing: 0.04em; }
  .sub { font-size: ${r(m)}; }
  .small { font-size: ${r(u)}; }
  .section { font-size: ${r(c)}; font-weight: 700; text-transform: uppercase; margin-top: 0.8mm; }
  .rule { border: 0; border-top: 1px solid #000; margin: 1.4mm 0; height: 0; }
  .rule.dashed { border-top-style: dashed; }
  .kv { display: flex; justify-content: space-between; align-items: baseline; gap: 2mm; }
  .kv .k { flex: 0 0 auto; white-space: nowrap; }
  .kv .v { flex: 1 1 auto; min-width: 0; text-align: right; font-variant-numeric: tabular-nums; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; column-gap: 3mm; row-gap: 0.2mm; }
  .meta .full { grid-column: 1 / -1; }
  table.items { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.items th {
    font-size: ${r(u)}; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;
    text-align: left; padding: 0.5mm 0 0.6mm; border-bottom: 1px solid #000;
  }
  table.items td { padding: 0.6mm 0; vertical-align: top; border-bottom: 1px dotted #777; }
  table.items tr:last-child td { border-bottom: 0; }
  table.items .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  table.items .qty { width: 11%; }
  table.items .rate { width: 20%; }
  table.items .amt { width: 24%; }
  table.items td.name { padding-right: 1.5mm; }
  .total { font-size: ${r(p)}; font-weight: 700; }
  .total .v { font-variant-numeric: tabular-nums; }
  .note { font-size: ${r(m)}; }
  .sign { display: flex; gap: 4mm; margin-top: 5mm; }
  .sign > div { flex: 1 1 0; border-top: 1px solid #000; padding-top: 0.6mm; font-size: ${r(u)}; text-transform: uppercase; }
  .footer { font-size: ${r(h)}; text-align: center; margin-top: 2mm; }
  img.logo { display: block; margin: 0 auto 1mm; height: 12mm; width: auto; max-width: 28mm; }
  #mb-gauge { position: absolute; top: 0; left: 0; width: ${t.paperWidthMm}mm; height: 0; visibility: hidden; }
  @media print { #mb-gauge { display: none; } }
  `}</style>
<style id="${y}"></style>
</head>
<body><div id="mb-gauge"></div><div class="receipt" id="mb-receipt">${n}</div></body>
</html>`}class en extends Error{constructor(e){super(e),this.name="InvalidDocumentError"}}function er(e,t){if(0===e.items.length&&0===e.packingItems.length)throw new en("There are no waiting demands to print.");if(null!==e.totals.grandAmount){let t=e.branchItems.filter(e=>null!==e.amount);if(t.length!==e.branchItems.length)throw new en("The grand amount is stated but a branch amount is unavailable.");let n=t.reduce((e,t)=>e+(t.amount??0),0);if(Math.abs(n-e.totals.grandAmount)>1)throw new en(`The branch amounts do not add up to the grand total (${n} ≠ ${e.totals.grandAmount}).`)}let n=v(t),r=e.currencySymbol?.trim()||"Rs.",i=(e.companyName?.trim()||"MOUNTAIN BAKES").toUpperCase(),a=e.items.map(e=>`<tr><td class="name">${J(e.productName)}</td><td class="num amt">${_(e.qty)}</td></tr>`).join(""),o=e.packingItems.map(e=>`<tr><td class="name">${J(e.materialName)}</td><td class="num amt">${_(e.qty)}</td></tr>`).join(""),s=e.branchItems.map(e=>`<tr>
  <td class="name">${J(e.branchName)}</td>
  <td class="num qty">${_(e.qty)}</td>
  <td class="num amt">${null===e.amount?"N/A":X(e.amount,r)}</td>
</tr>`).join(""),l=`
<div class="c">
  ${ee(e.logo)}
  <div class="company">${J(i)}</div>
  <div class="dept">Production Department</div>
  <div class="doc-title">Production Demand Summary</div>
</div>
${Z()}
<div class="meta">
  ${Y("Business Date",e.businessDateText,"full")}
  ${Y("Printed",`${e.printDateText} ${e.printTimeText}`,"full")}
  ${e.statusText?Y("Status",e.statusText,"full"):""}
</div>
${Z()}
<div class="section">Product Demand</div>
<table class="items">
  <thead><tr><th class="name">Product</th><th class="num amt">Qty</th></tr></thead>
  <tbody>${a||'<tr><td colspan="2" class="note">No waiting demand.</td></tr>'}</tbody>
</table>
${Y("Total Qty",_(e.totals.totalProductQty))}
${Z()}
${e.packingItems.length>0?`<div class="section">Packing Material Requirements</div>
<table class="items">
  <thead><tr><th class="name">Packing Material</th><th class="num amt">Qty</th></tr></thead>
  <tbody>${o}</tbody>
</table>
${Y("Packing Qty",_(e.totals.totalPackingQty))}
${Z()}`:""}
<div class="section">Demand Totals</div>
${Y("Distinct Products",_(e.totals.distinctProducts))}
${Y("Total Product Qty",_(e.totals.totalProductQty))}
${e.totals.distinctPacking>0?Y("Distinct Packing Items",_(e.totals.distinctPacking)):""}
${e.totals.distinctPacking>0?Y("Total Packing Qty",_(e.totals.totalPackingQty)):""}
${Z()}
<div class="section">Branch-wise Summary</div>
<table class="items">
  <thead><tr><th class="name">Branch</th><th class="num qty">Qty</th><th class="num amt">Amount</th></tr></thead>
  <tbody>${s}</tbody>
</table>
${Y("Grand Qty",_(e.totals.totalProductQty))}
${Y("Grand Amount",null===e.totals.grandAmount?"Amount unavailable":X(e.totals.grandAmount,r),"total")}
${Z()}
<div class="footer">* Design &amp; developed by arifsiksavi@gmail.com | 0322-2050545 *</div>
`;return{kind:"demand-summary",id:e.businessDateText,title:"Production Demand Summary",paper:n,html:et("Production Demand Summary",n,l),mustContain:["Production Demand Summary",i]}}function ei(e,t,n,r){if(!("function"==typeof window.print&&"u">typeof document))return Promise.reject(new a("not-supported","This browser cannot open a print dialog, so the printer installed on this computer cannot be reached from here."));let{promise:i}=function(e){let t,n,r=q.get(e.key);if(r)return e.onUpdate&&(r.listeners.add(e.onUpdate),e.onUpdate(r.snapshot)),{jobId:r.snapshot.jobId,promise:r.promise,deduplicated:!0};let i="u">typeof crypto&&"function"==typeof crypto.randomUUID?crypto.randomUUID():`job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`,a=new Promise((e,r)=>{t=e,n=r});a.catch(()=>{});let o={snapshot:{jobId:i,key:e.key,printerKey:e.printerKey,documentType:e.documentType,documentId:e.documentId,state:"queued",position:0,attempt:0,timings:{createdAt:Date.now(),attempts:0}},run:e.run,listeners:new Set(e.onUpdate?[e.onUpdate]:[]),resolve:t,reject:n,promise:a,cancelled:!1};B.set(i,o),q.set(e.key,o);let s=L.get(e.printerKey)??[];return s.push(o),L.set(e.printerKey,s),K(e.printerKey),F(o),z(e.printerKey),{jobId:i,promise:a,deduplicated:!1}}({key:`${t}:${e||"none"}${r.requestId?`:${r.requestId}`:""}`,printerKey:"system-default",documentType:t,documentId:e||null,onUpdate:r.onJobUpdate,run:e=>ea(n,e)});return i}async function ea(e,t){let n,r=Date.now(),i=ec();try{n=e()}catch(e){if(e instanceof en)throw new a("invalid-document",e.message);throw e}return t.composed(ec()-i),(0,M.printTrace)("document composed",{ms:Math.round(ec()-i),bytes:n.html.length,kind:n.kind}),await eo(n,t),{printJobId:t.jobId,durationMs:Date.now()-r}}async function eo(e,t){let n=window.document,r=n.createElement("iframe");r.setAttribute("aria-hidden","true"),r.setAttribute("tabindex","-1"),r.title=e.title,r.style.cssText=`position:absolute;top:-10000px;left:-10000px;width:${e.paper.paperWidthMm+20}mm;height:400mm;border:0;background:#fff`;let i=()=>{window.setTimeout(()=>r.remove(),1e3)};n.body.appendChild(r);try{let n=ec();await new Promise((t,n)=>{let i=window.setTimeout(()=>n(new a("timeout","The receipt could not be prepared for the printer. Try again.")),1e4);r.addEventListener("load",()=>{window.clearTimeout(i),t()},{once:!0}),r.srcdoc=e.html});let i=r.contentWindow,o=r.contentDocument;if(!i||!o)throw new a("print-failed","The receipt could not be prepared for the printer. Try again.");(0,M.printTrace)("receipt frame loaded"),await el(o),function(e,t){try{let n=e.getElementById("mb-gauge"),r=e.getElementById("mb-receipt"),i=e.getElementById(y);if(!n||!r||!i)return;let a=n.getBoundingClientRect().width/t;if(!(a>0))return;let o=r.getBoundingClientRect().height/a;if(!(o>0))return;let s=Math.ceil(o)+2;i.textContent=`@page { size: ${t}mm ${s}mm; margin: 0; }`}catch{}}(o,e.paper.paperWidthMm),function(e,t){let n=e.getElementById("mb-receipt"),r=n?.getBoundingClientRect();if(!n||!r||!(r.height>0)||!(r.width>0))throw new a("invalid-document","Print document is empty. Nothing was sent to the printer.");let i=ed(n.innerText||n.textContent||"");if(0===i.length)throw new a("invalid-document","Print document is empty. Nothing was sent to the printer.");let o=t.mustContain.filter(e=>!i.includes(ed(e)));if(o.length>0)throw new a("invalid-document","Print document is incomplete. Nothing was sent to the printer.",`missing: ${o.join(", ")}`)}(o,e),t.connected(ec()-n),(0,M.printTrace)("receipt fitted and verified",{ms:Math.round(ec()-n)});let l=ec();await new Promise((e,t)=>{let n=!1,r=0,a=0,l=()=>{window.clearTimeout(r),window.clearTimeout(a),i.removeEventListener("afterprint",d),window.removeEventListener("afterprint",d)};function d(){n||(n=!0,l(),(0,M.printTrace)("print dialog finished"),e())}i.addEventListener("afterprint",d),window.addEventListener("afterprint",d),r=window.setTimeout(d,3e4);try{if((0,R.isIOS)()){let e=function(e){let t=window.document;t.getElementById(es)?.remove();let n=t.createElement("div");n.id=es;let r=n.attachShadow({mode:"open"});for(let n of Array.from(e.querySelectorAll("style"))){if(n.id===y)continue;let e=t.createElement("style");e.textContent=(n.textContent??"").replace(/@page\s*\{[^}]*\}/g,"").replace(/\bhtml\s*,\s*body\b/g,":host").replace(/(^|[}\s])body(\s*\{)/g,"$1:host$2"),r.appendChild(e)}let i=e.getElementById("mb-receipt");i&&r.appendChild(t.importNode(i,!0));let a=e.getElementById(y)?.textContent??"",o=t.createElement("style");return o.textContent=`
    #${es} { display: none; }
    @media print {
      html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
      body > *:not(#${es}) { display: none !important; }
      #${es} { display: block !important; }
    }
    ${a}
  `,t.head.appendChild(o),t.body.appendChild(n),()=>{o.remove(),n.remove()}}(o),t=()=>window.setTimeout(e,1e3);window.addEventListener("afterprint",t,{once:!0}),window.setTimeout(t,3e4),(0,M.printTrace)("top-document print() called (iOS)"),window.print();return}i.focus(),(0,M.printTrace)("frame print() called"),i.print(),(0,M.printTrace)("frame print() returned")}catch(e){n=!0,l(),t(s(e,"print-failed"));return}a=window.setTimeout(d,1500)}),t.sent(ec()-l)}catch(e){throw i(),s(e,"print-failed")}i()}let es="mb-ios-print";async function el(e){let t=e.fonts?.ready,n=Array.from(e.images).filter(e=>!e.complete).map(e=>"function"==typeof e.decode?e.decode().catch(()=>void 0):Promise.resolve()),r=Promise.all([t??Promise.resolve(),...n]);await Promise.race([r,new Promise(e=>setTimeout(e,1500))]),await new Promise(t=>{let n=(e.defaultView??window).requestAnimationFrame;"function"==typeof n?n(()=>t()):t()})}function ed(e){return e.replace(/\s+/g," ").trim().toLowerCase()}function ec(){return"u">typeof performance?performance.now():Date.now()}e.s(["demandSummaryDocument",0,function(e){let t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:"80mm";return er(e,t)},"printBranchClosing",0,function(e){let t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:{};return ei(`${e.branchName}-${e.businessDateText}`,"branch-closing",()=>(function(e,t){if(!e.branchName?.trim())throw new en("This closing sheet has no branch to print.");if(!e.businessDateText?.trim())throw new en("This closing sheet has no business date to print.");let n=e.paymentLines.reduce((e,t)=>e+t.amount,0);if(Math.abs(n-e.totalSales)>1)throw new en(`The payment method totals do not add up to total sales (${n} ≠ ${e.totalSales}).`);let r=v(t),i=e.currencySymbol?.trim()||"Rs.",a=(e.companyName?.trim()||"MOUNTAIN BAKES").toUpperCase(),o=e.branchName.trim(),s=e.stockLines.map(e=>`<tr><td class="name">${J(e.productName)}</td><td class="num amt">${_(e.balance)}</td></tr>`).join(""),l=e.paymentLines.map(e=>Y(e.label,X(e.amount,i))).join(""),d=`
<div class="c">
  ${ee(e.logo)}
  <div class="company">${J(a)}</div>
  <div class="dept">Branch Closing</div>
  <div class="sub">${J(o)}</div>
</div>
${Z()}
<div class="meta">
  ${Y("Business Date",e.businessDateText,"full")}
  ${Y("Printed",`${e.printDateText} ${e.printTimeText}`,"full")}
</div>
${Z()}
<div class="section">Balance Stock</div>
<table class="items">
  <thead><tr><th class="name">Product</th><th class="num amt">Balance</th></tr></thead>
  <tbody>${s||'<tr><td colspan="2" class="note">No balance stock.</td></tr>'}</tbody>
</table>
${Z()}
<div class="section">Payment Details</div>
${l||'<div class="note">No sales recorded for this date.</div>'}
${Z()}
${Y("Total Sales",X(e.totalSales,i))}
${e.discounts>0?Y("Discounts",X(e.discounts,i)):""}
${Y("Expenses",X(e.totalExpenses,i))}
${Y("Closing Cash",X(e.cashInHand,i),"total")}
${Y("Orders / Cancelled",`${_(e.orderCount)} / ${_(e.cancelled)}`)}
${Z()}
<div class="footer">End of Closing Report</div>
`;return{kind:"branch-closing",id:`${o}-${e.businessDateText}`,title:`Branch Closing — ${o}`,paper:r,html:et(`Branch Closing — ${o}`,r,d),mustContain:["Branch Closing",a,o]}})(e,t.paper??"80mm"),t)},"printDemandSummary",0,function(e){let t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:{};return ei(e.businessDateText,"demand-summary",()=>er(e,t.paper??"80mm"),t)},"printProductionOrder",0,function(e){let t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:{};return ei(e.orderNumber,"production-order",()=>{var n,r,i,a;let o,s,l,d,c,m,u,p,h,f,g;return n=t.paper??"80mm",!function(e){if(!e.orderNumber?.trim())throw new en("This order has no reference number to print.");let t=e.items.filter(e=>e.qty>0),n=e.packingItems??[];if(0===t.length&&0===n.length)throw new en("This order has no approved items or packing materials to print.");let r=t.reduce((e,t)=>e+t.amount,0);if(Math.abs(r-e.grandTotal)>1)throw new en(`The order lines do not add up to the total (${r} ≠ ${e.grandTotal}).`);let i=new Set;for(let e of n){let t=e.materialName?.trim();if(!t)throw new en("A packing material on this order has no name.");if(!(e.qty>0))throw new en(`"${t}" has no quantity and should not be on the print.`);let n=t.toLowerCase();if(i.has(n))throw new en(`"${t}" appears twice on this order.`);i.add(n)}}(e),o=v(n),s=e.currencySymbol?.trim()||"Rs.",l=(e.companyName?.trim()||"MOUNTAIN BAKES").toUpperCase(),d=e.items.filter(e=>e.qty>0),c=e.packingItems??[],m=d.reduce((e,t)=>e+t.qty,0),u=X(e.grandTotal,s),p=d.map(e=>`<tr>
  <td class="name">${J(e.productName)}</td>
  <td class="num qty">${_(e.qty)}</td>
  <td class="num rate">${_(e.unitPrice)}</td>
  <td class="num amt">${_(e.amount)}</td>
</tr>`).join(""),h=`
<div class="c">
  ${ee(e.logo)}
  <div class="company">${J(l)}</div>
  <div class="dept">Production Department</div>
  <div class="doc-title">Production Order</div>
</div>
${Z()}
<div class="meta">
  ${Y("Order No",e.orderNumber,"full")}
  ${Y("Branch",e.branchName||"—","full")}
  ${Y("Date",e.dateText)}
  ${Y("Time",e.timeText||"—")}
  ${Y("Required Date",e.requiredDateText||"—","full")}
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
${c.length>0?(f=(r=c).map(e=>`<tr>
  <td class="name">${J(e.materialName)}</td>
  <td class="num amt">${_(e.qty)}</td>
</tr>`).join(""),g=r.reduce((e,t)=>e+t.qty,0),`<div class="section">Packing Materials</div>
<table class="items">
  <thead><tr><th class="name">Packing Material</th><th class="num amt">Qty</th></tr></thead>
  <tbody>${f}</tbody>
</table>
${Y("Packing Qty",_(g))}
${Z()}`):""}
${void 0===e.previousCollection?"":(i=e.previousCollection,a=s,i?`<div class="section">Previous Order Balance</div>
<div class="small">${Y("Order No",i.reference)}${Y("Order Date",i.dateText)}</div>
${Y("Previous Order",X(i.orderedValue,a))}
${Y("Delivered Value",X(i.deliveredValue,a))}
${Y("Company Share",X(i.companyShare,a))}
${Y("Less Returns",X(i.returnsAmount,a))}
${Y("Less Discount",X(i.discountsAmount,a))}
${Z(!0)}
${Y("AMOUNT TO COLLECT",X(i.amountToCollect,a),"total")}
${void 0===i.paymentsReceived?"":`${Y("Payment Received",X(i.paymentsReceived,a))}
${Y("Remaining Balance",X(i.remainingBalance??Math.max(0,i.amountToCollect-i.paymentsReceived),a))}
`}${Z()}`:`<div class="section">Previous Order Balance</div>
<div class="note">No previous delivery — nothing to collect.</div>
${Z()}`)}
<div class="sign"><div>Collected By</div><div>Received By</div></div>
<div class="footer">* Design &amp; developed by arifsiksavi@gmail.com | 0322-2050545 *</div>
`,{kind:"production-order",id:e.orderNumber,title:`Production order ${e.orderNumber}`,paper:o,html:et(`Production order ${e.orderNumber}`,o,h),mustContain:[e.orderNumber,u,l,...c.map(e=>e.materialName)]}},t)},"printSaleReceipt",0,function(e){let t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:{};return ei(e.saleId,"sale",()=>(function(e,t){if(!e.items||0===e.items.length)throw new en("This sale has no items to print.");if(!e.saleId?.trim())throw new en("This sale has no reference number yet.");if(!e.paymentMethodLabel?.trim())throw new en("This sale has no payment method recorded.");if(Math.abs(e.grossTotal-e.discountTotal+e.taxAmount-e.grandTotal)>1)throw new en(`The sale totals do not reconcile (gross ${e.grossTotal} - discount ${e.discountTotal} + tax ${e.taxAmount} ≠ total ${e.grandTotal}).`);let n=v(t),r=e.currencySymbol?.trim()||"Rs.",i=(e.companyName?.trim()||"MOUNTAIN BAKES").toUpperCase(),a=X(e.grandTotal,r),o=e.items.map(e=>`<tr>
  <td class="name">${J(e.productName)}</td>
  <td class="num qty">${_(e.qty)}</td>
  <td class="num rate">${_(e.unitPrice)}</td>
  <td class="num amt">${_(e.lineTotal)}</td>
</tr>`).join(""),s=`
<div class="c">
  ${ee(e.logo)}
  <div class="company">${J(i)}</div>
  <div class="dept">Sale Receipt</div>
  ${e.branchName?.trim()?`<div class="sub">${J(e.branchName.trim())}</div>`:""}
</div>
${Z()}
<div class="meta">
  ${Y("Sale ID",e.saleId,"full")}
  ${Y("Date",e.dateText)}
  ${Y("Time",e.timeText)}
  ${e.customerName?.trim()?Y("Customer",e.customerName.trim(),"full"):""}
  ${e.customerPhone?.trim()?Y("Mobile",e.customerPhone.trim(),"full"):""}
</div>
${Z()}
<table class="items">
  <thead><tr><th class="name">Product</th><th class="num qty">Qty</th><th class="num rate">Rate</th><th class="num amt">Amount</th></tr></thead>
  <tbody>${o}</tbody>
</table>
${Z()}
${Y("Gross Total",X(e.grossTotal,r))}
${Y("Discount",X(e.discountTotal,r))}
${e.taxAmount>0?Y("Government Tax",X(e.taxAmount,r)):""}
${Y("TOTAL",a,"total")}
${null!=e.receivedCash?Y("Cash Received",X(e.receivedCash,r))+Y("Cash Returned",X(e.cashReturned??0,r)):""}
${Z()}
<div class="b up">Payment Method: ${J(e.paymentMethodLabel)}</div>
<div class="footer">
  <div>************************</div>
  <div>Phone: +92 347 9782409</div>
  <div>Thank you for choosing Mountain Bakes! We truly appreciate your support. Best wishes!</div>
  <div>************************</div>
</div>
`;return{kind:"sale",id:e.saleId,title:`Receipt ${e.saleId}`,paper:n,html:et(`Receipt ${e.saleId}`,n,s),mustContain:[e.saleId,a,i]}})(e,t.paper??"80mm"),t)}],828844)}]);