(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,129338,410725,e=>{"use strict";var t=e.i(558221),n=e.i(950309),r=e.i(730687),i=e.i(519455),a=e.i(624687),s=e.i(975157),o=e.i(549005),l=e.i(254157),d=e.i(206272),c=e.i(261238);e.i(355515);var u=e.i(471880);e.i(397013);var m=e.i(725885),p=e.i(392231);function h(e){let t=(0,d.useQueryClient)();return(0,o.useMutation)({mutationFn:t=>(0,c.apiCall)("/api/restrictions/requests",{method:"POST",body:JSON.stringify(t)},e),onSuccess:()=>{t.invalidateQueries({queryKey:["restrictionCheck"]}),t.invalidateQueries({queryKey:["restrictions"]})}})}e.s(["restrictionFromError",0,function(e){if(!(e instanceof c.ApiError)||409!==e.status)return null;let t=e.details;return t?.code==="restriction"&&t.restriction?t.restriction:null},"useDecideRestrictionRequest",0,function(e){let t=(0,d.useQueryClient)();return(0,o.useMutation)({mutationFn:t=>{let{id:n,decision:r,reason:i}=t;return(0,c.apiCall)(`/api/restrictions/requests/${n}/decide`,{method:"POST",body:JSON.stringify({decision:r,reason:i})},e)},onSettled:()=>t.invalidateQueries({queryKey:["restrictions"]})})},"useRequestRestrictionApproval",0,h,"useRestrictionCheck",0,function(e,t,n,r){let i={};for(let[e,t]of Object.entries(n))null!=t&&""!==t&&(i[e]=String(t));let a=new URLSearchParams(i).toString(),s=(0,l.useQuery)({queryKey:u.qk.restrictionCheck(t,i),queryFn:()=>(0,c.apiCall)(`/api/restrictions/check/${t}${a?`?${a}`:""}`,{},e),enabled:!!e&&r,staleTime:0,gcTime:0,retry:!1,refetchOnMount:"always"}),o=s.isError?null:s.data??null;return{check:o,restriction:o?.restriction??null,allowed:o?.allowed===!0,unverified:r&&s.isError,isLoading:r&&s.isLoading,refetch:()=>void s.refetch()}},"useRestrictionEvents",0,function(e,t,n){return(0,l.useQuery)({queryKey:u.qk.restrictionEvents(t),queryFn:()=>(0,c.apiCall)(`/api/restrictions/events${t?`?ruleCode=${encodeURIComponent(t)}`:""}`,{},e),enabled:!!e&&n,staleTime:15e3})},"useRestrictionMonitor",0,function(e,t){return(0,l.useQuery)({queryKey:u.qk.restrictionMonitor(),queryFn:()=>(0,c.apiCall)("/api/restrictions/monitor",{},e),enabled:!!e&&t,staleTime:15e3})},"useRestrictionRequests",0,function(e,t){let n={type:t.type??null};return(0,l.useQuery)({queryKey:u.qk.restrictionRequests(n),queryFn:()=>{let t=new URLSearchParams;return n.type&&t.set("type",n.type),(0,c.apiCall)(`/api/restrictions/requests?${t.toString()}`,{},e)},enabled:!!e,staleTime:15e3})},"useRestrictionRules",0,function(e){return(0,l.useQuery)({queryKey:u.qk.restrictionRules(),queryFn:()=>(0,c.apiCall)("/api/restrictions/rules",{},e),select:e=>({...e,rules:(0,m.mergeRules)(e.rules??{}),saved:{...Object.fromEntries(p.RESTRICTION_GROUPS.map(e=>[e,{updatedAt:null,updatedByName:null}])),...e.saved}}),enabled:!!e})},"useSaveRestrictionGroup",0,function(e){let t=(0,d.useQueryClient)();return(0,o.useMutation)({mutationFn:t=>{let{group:n,config:r}=t;return(0,c.apiCall)(`/api/restrictions/rules/${n}`,{method:"PUT",body:JSON.stringify(r)},e)},onSuccess:()=>t.invalidateQueries({queryKey:["restrictions"]})})}],410725);let f={warning:{box:"border-amber-300 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/30",accent:"text-amber-800 dark:text-amber-300",dot:"bg-amber-700 dark:bg-amber-600",chip:"border-amber-300 dark:border-amber-900/60",level:"WARNING",glyph:"!"},blocking:{box:"border-red-300 bg-red-50 dark:border-red-900/60 dark:bg-red-950/30",accent:"text-red-700 dark:text-red-300",dot:"bg-red-700 dark:bg-red-600",chip:"border-red-300 dark:border-red-900/60",level:"BLOCKING",glyph:"!"},admin_approval_required:{box:"border-blue-300 bg-blue-50 dark:border-blue-900/60 dark:bg-blue-950/30",accent:"text-blue-800 dark:text-blue-300",dot:"bg-blue-800 dark:bg-blue-600",chip:"border-blue-300 dark:border-blue-900/60",level:"ADMIN APPROVAL REQUIRED",glyph:"?"},approved:{box:"border-emerald-300 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/30",accent:"text-emerald-800 dark:text-emerald-300",dot:"bg-emerald-700 dark:bg-emerald-600",chip:"border-emerald-300 dark:border-emerald-900/60",level:"APPROVED",glyph:"✓"},info:{box:"border-border bg-muted",accent:"text-muted-foreground",dot:"bg-muted-foreground",chip:"border-border",level:"INFO",glyph:"i"}};function g(e){let{restriction:n,note:r,children:i,className:a}=e,o=f[n.severity];return(0,t.jsxs)("div",{role:"blocking"===n.severity||"admin_approval_required"===n.severity?"alert":"status",className:(0,s.cn)("flex gap-3 rounded-lg border p-3.5 text-sm",o.box,a),children:[(0,t.jsx)("div",{"aria-hidden":!0,className:(0,s.cn)("flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white",o.dot),children:o.glyph}),(0,t.jsxs)("div",{className:"flex min-w-0 flex-1 flex-col gap-2",children:[(0,t.jsxs)("div",{className:"flex flex-col gap-0.5",children:[(0,t.jsx)("span",{className:(0,s.cn)("text-[10px] font-bold tracking-wider",o.accent),children:o.level}),(0,t.jsx)("span",{className:"text-[14.5px] font-bold text-foreground",children:n.title})]}),n.messages.map(e=>(0,t.jsx)("p",{className:"leading-normal text-foreground/90",children:e},e)),n.list&&n.list.length>0&&(0,t.jsx)("div",{className:"flex flex-wrap gap-1.5",children:n.list.map(e=>(0,t.jsx)("span",{className:(0,s.cn)("rounded-md border bg-background px-2 py-0.5 font-mono text-xs font-medium",o.chip),children:e},e))}),n.shortages&&n.shortages.length>0&&(0,t.jsx)("div",{className:"overflow-x-auto rounded-md bg-background",children:(0,t.jsxs)("table",{className:"w-full border-collapse text-xs",children:[(0,t.jsx)("thead",{children:(0,t.jsxs)("tr",{className:"text-muted-foreground",children:[(0,t.jsx)("th",{className:"px-3 py-2 text-left font-medium",children:"Product"}),(0,t.jsx)("th",{className:"px-3 py-2 text-center font-medium",children:"Required Qty"}),(0,t.jsx)("th",{className:"px-3 py-2 text-center font-medium",children:"Available Qty"}),(0,t.jsx)("th",{className:"px-3 py-2 text-center font-medium",children:"Less Qty"})]})}),(0,t.jsx)("tbody",{children:n.shortages.map(e=>(0,t.jsxs)("tr",{className:"border-t",children:[(0,t.jsx)("td",{className:"px-3 py-2 font-semibold",children:e.productName}),(0,t.jsx)("td",{className:"px-3 py-2 text-center tabular-nums",children:e.required}),(0,t.jsx)("td",{className:"px-3 py-2 text-center tabular-nums",children:e.available}),(0,t.jsx)("td",{className:(0,s.cn)("px-3 py-2 text-center font-bold tabular-nums",o.accent),children:e.short})]},e.productName))})]})}),n.after?.map(e=>(0,t.jsx)("p",{className:"leading-normal text-foreground/90",children:e},e)),n.meter&&(0,t.jsxs)("div",{role:"img","aria-label":`${n.meter.value}% sold, ${n.meter.required}% required`,className:(0,s.cn)("relative h-2 rounded-full border bg-background",o.chip),children:[(0,t.jsx)("div",{className:(0,s.cn)("absolute inset-y-0 left-0 rounded-full",o.dot),style:{width:`${Math.min(n.meter.value,100)}%`}}),(0,t.jsx)("div",{className:"absolute -inset-y-1 w-0.5 bg-foreground",style:{left:`${Math.min(n.meter.required,100)}%`}})]}),n.stats&&n.stats.length>0&&(0,t.jsx)("dl",{className:"grid grid-cols-1 gap-x-3 gap-y-1.5 rounded-md bg-background px-3 py-2.5 text-xs sm:grid-cols-2",children:n.stats.map(e=>(0,t.jsxs)("div",{className:"flex justify-between gap-2",children:[(0,t.jsx)("dt",{className:"text-muted-foreground",children:e.label}),(0,t.jsx)("dd",{className:"font-bold tabular-nums",children:e.value})]},e.label))}),n.reason&&(0,t.jsxs)("div",{className:"flex flex-col gap-0.5 rounded-md bg-background px-3 py-2.5",children:[(0,t.jsx)("span",{className:"text-[11px] text-muted-foreground",children:"Reason"}),(0,t.jsx)("span",{className:"leading-normal",children:n.reason})]}),r&&(0,t.jsx)("p",{className:"text-[11.5px] text-muted-foreground",children:r}),i]})]})}function b(e){let{onRetry:n,className:r}=e;return(0,t.jsx)(g,{className:r,restriction:{code:"DEMAND_PENDING_LIMIT",severity:"info",title:"Verification Required",messages:["This action requires an online server verification before it can be submitted.","Please reconnect to the internet and try again."],requiresAdminApproval:!1},children:n&&(0,t.jsx)("div",{children:(0,t.jsx)(i.Button,{type:"button",size:"sm",variant:"outline",onClick:n,children:"Try Again"})})})}function y(e){let{token:s,request:o,again:l}=e,[d,c]=(0,n.useState)(""),[u,m]=(0,n.useState)(null),p=h(s);async function f(){let e=d.trim();if(e.length<5)return void m("Tell Admin why this is needed (at least 5 characters).");m(null);try{let{request:t}=await p.mutateAsync({...o,reason:e});c(""),r.toast.success(`Request ${t.requestNo} sent to Admin`)}catch(e){m(e instanceof Error?e.message:"Could not send the request.")}}return(0,t.jsxs)("div",{className:"flex flex-col gap-2 pt-1",children:[(0,t.jsxs)("label",{className:"flex flex-col gap-1.5",children:[(0,t.jsx)("span",{className:"text-xs font-semibold",children:"Reason for Admin"}),(0,t.jsx)(a.Textarea,{value:d,onChange:e=>{c(e.target.value),m(null)},rows:2,maxLength:500,placeholder:"Why is this needed?",className:"bg-background","aria-invalid":!!u})]}),u&&(0,t.jsx)("p",{role:"alert",className:"text-xs font-medium text-destructive",children:u}),(0,t.jsx)("div",{children:(0,t.jsx)(i.Button,{type:"button",size:"sm",onClick:f,disabled:p.isPending,children:p.isPending?"Sending…":l?"Request Admin Approval Again":"Request Admin Approval"})})]})}e.s(["ConnectionRequiredNotice",0,b,"RestrictionNotice",0,g,"RestrictionPanel",0,function(e){let{preflight:n,token:r,request:i,note:a,className:s}=e;if(n.unverified)return(0,t.jsx)(b,{onRetry:n.refetch,className:s});let o=n.restriction;return o?(0,t.jsx)(g,{restriction:o,note:a,className:s,children:o.canRequestApproval&&i&&(0,t.jsx)(y,{token:r,request:i,again:"rejected"===o.requestStatus})}):null}],129338)},713770,e=>{"use strict";var t=e.i(950309);let n=new Map,r=new Map,i=new Set;function a(e){return i.add(e),()=>{i.delete(e)}}e.s(["useCachedLogo",0,function(e){let s=(0,t.useSyncExternalStore)(a,()=>(function(e){if(e)return n.get(e)??e})(e),()=>e??void 0);return(0,t.useEffect)(()=>{e&&!n.has(e)&&function(e){if(!e)return Promise.resolve(void 0);let t=n.get(e);if(t)return Promise.resolve(t);if(r.get(e))return;let a=(async()=>{let t=e;try{let n=await fetch(e,{mode:"cors",credentials:"omit"});if(n.ok){var a;let e=await n.blob();e.size>0&&e.size<=15e5&&e.type.startsWith("image/")&&(t=await (a=e,new Promise((e,t)=>{let n=new FileReader;n.onload=()=>e(String(n.result)),n.onerror=()=>t(n.error??Error("read failed")),n.readAsDataURL(a)})))}}catch{}for(let a of(n.set(e,t),r.delete(e),i))a();return t})();r.set(e,a)}(e)},[e]),s}])},12294,e=>{"use strict";let t=(0,e.i(818909).default)("Printer",[["path",{d:"M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2",key:"143wyd"}],["path",{d:"M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6",key:"1itne7"}],["rect",{x:"6",y:"14",width:"12",height:"8",rx:"1",key:"1ue0tg"}]]);e.s(["Printer",0,t],12294)},454375,e=>{"use strict";var t=e.i(145694);e.s(["printDocument",0,function(){let{onAfterPrint:e}=arguments.length>0&&void 0!==arguments[0]?arguments[0]:{};window.addEventListener("afterprint",function n(){window.removeEventListener("afterprint",n),(0,t.printTrace)("afterprint handled"),e?.()}),(0,t.printTrace)("window.print() called"),window.print(),(0,t.printTrace)("window.print() returned")},"whenPrintAreaReady",0,function(){let e=arguments.length>0&&void 0!==arguments[0]?arguments[0]:1500;return new Promise(n=>{let r=!1,i=()=>{r||(r=!0,n())},a=window.setTimeout(i,e);requestAnimationFrame(()=>{requestAnimationFrame(()=>{let e=Array.from(document.querySelectorAll(".print-area img"));(0,t.printTrace)("print DOM laid out",{images:e.length,pending:e.filter(e=>!e.complete).length}),Promise.all(e.filter(e=>!e.complete).map(e=>"function"==typeof e.decode?e.decode().catch(()=>void 0):Promise.resolve())).then(()=>{window.clearTimeout(a),i()})})})})}])},612710,771982,e=>{"use strict";var t=e.i(558221),n=e.i(519455),r=e.i(755146),i=e.i(12294),a=e.i(436022),s=e.i(239050),o=e.i(950309);let l="mb.printMode",d="mb:print-mode",c=null;function u(){return null===c&&(c=function(){if("function"!=typeof window.print)return"save";let e=navigator;if("boolean"==typeof e.userAgentData?.mobile)return e.userAgentData.mobile?"save":"print";let t=navigator.userAgent,n=/Macintosh/i.test(t)&&navigator.maxTouchPoints>1;return/Android|iPhone|iPod|iPad|Mobile/i.test(t)||n?"save":"print"}()),c}function m(){try{let e=localStorage.getItem(l);return"print"===e||"save"===e?e:"auto"}catch{return"auto"}}function p(e){return window.addEventListener("storage",e),window.addEventListener(d,e),()=>{window.removeEventListener("storage",e),window.removeEventListener(d,e)}}function h(){let e=(0,o.useSyncExternalStore)(p,m,()=>"auto"),t=(0,o.useSyncExternalStore)(p,u,()=>"print"),n=(0,o.useCallback)(e=>{try{"auto"===e?localStorage.removeItem(l):localStorage.setItem(l,e)}catch{}window.dispatchEvent(new Event(d))},[]),r="auto"===e?t:e;return{mode:r,canPrint:"print"===r,preference:e,detected:t,setPreference:n}}e.s(["usePrintCapability",0,h],771982);var f=e.i(454375),g=e.i(975157);let b=[{value:"auto",label:"Detect automatically",hint:"Guess from the device"},{value:"print",label:"This device has a printer",hint:"Always offer Print"},{value:"save",label:"No printer on this device",hint:"Always offer Save as PDF"}];e.s(["PrintButton",0,function(e){let{onPrint:o,printLabel:l="Print",saveLabel:d="Save as PDF",showMenu:c=!0,disabled:u,variant:m="default",size:p="default",className:y,buttonClassName:v}=e,{mode:w,preference:x,setPreference:$}=h(),T="save"===w;return(0,t.jsxs)("div",{className:(0,g.cn)("no-print inline-flex items-stretch",y),children:[(0,t.jsxs)(n.Button,{variant:m,size:p,disabled:u,onClick:function(){o?o():(0,f.printDocument)()},className:(0,g.cn)("flex-1",c&&"rounded-r-none",v),title:T?"Save this document as a PDF":"Send this document to a printer",children:[T?(0,t.jsx)(a.Download,{className:"mr-1.5 h-4 w-4"}):(0,t.jsx)(i.Printer,{className:"mr-1.5 h-4 w-4"}),T?d:l]}),c&&(0,t.jsxs)(r.DropdownMenu,{children:[(0,t.jsx)(r.DropdownMenuTrigger,{disabled:u,"aria-label":"Printer availability",title:"Printer availability",className:(0,g.cn)((0,n.buttonVariants)({variant:m,size:p}),"rounded-l-none border-l-black/10 px-1.5 dark:border-l-white/15",v),children:(0,t.jsx)(s.ChevronDown,{className:"h-3.5 w-3.5"})}),(0,t.jsxs)(r.DropdownMenuContent,{align:"end",className:"w-64",children:[(0,t.jsx)(r.DropdownMenuLabel,{children:"Printer on this device"}),(0,t.jsx)(r.DropdownMenuSeparator,{}),(0,t.jsx)(r.DropdownMenuRadioGroup,{value:x,onValueChange:e=>$(e),children:b.map(e=>(0,t.jsx)(r.DropdownMenuRadioItem,{value:e.value,className:"py-1.5",children:(0,t.jsxs)("span",{className:"flex flex-col",children:[(0,t.jsx)("span",{children:e.label}),(0,t.jsx)("span",{className:"text-xs text-muted-foreground",children:e.hint})]})},e.value))})]})]})]})}],612710)},813304,e=>{"use strict";var t=e.i(950309),n=e.i(454375),r=e.i(145694);e.s(["useDocumentPrint",0,function(){let[e,i]=(0,t.useState)(!1),a=(0,t.useRef)(null),s=(0,t.useCallback)(function(){let e=arguments.length>0&&void 0!==arguments[0]?arguments[0]:{};(0,r.beginPrintTrace)("document-print"),(0,r.printTrace)("print requested"),a.current=e,i(!0)},[]);return(0,t.useEffect)(()=>{if(!e)return;let t=!1,s=!1,o=a.current??{};a.current=null;let l=()=>{s||(s=!0,window.clearTimeout(d),t||i(!1),(0,r.printTrace)("print DOM released"),o.onAfterPrint?.())},d=window.setTimeout(l,12e4);return(0,r.printTrace)("print DOM mounted"),(0,n.whenPrintAreaReady)().then(()=>{t||((0,r.printTrace)("print area ready"),(0,n.printDocument)({...o,onAfterPrint:l}))}),()=>{t=!0,window.clearTimeout(d)}},[e]),{printing:e,print:s}}])},260591,e=>{"use strict";var t=e.i(558221),n=e.i(950309),r=e.i(906093);let i=()=>()=>{};e.s(["PrintPortal",0,function(e){let{children:a,active:s=!0}=e;return(0,n.useSyncExternalStore)(i,()=>!0,()=>!1)&&s?(0,r.createPortal)((0,t.jsx)("div",{className:"print-area print-only",children:a}),document.body):null}])},530917,740358,41447,828844,e=>{"use strict";var t=e.i(558221),n=e.i(950309),r=e.i(519455),i=e.i(755146);class a extends Error{code;detail;constructor(e,t,n){super(t),this.name="PosPrintError",this.code=e,this.detail=n??null}}function s(e){return"invalid-document"!==e&&"not-supported"!==e}function o(e){let t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:"print-failed";if(e instanceof a)return e;let n=e instanceof Error?`${e.name}: ${e.message}`:String(e);return new a(t,function(e){switch(e){case"not-supported":return"This browser cannot print. Open Mountain Bakes in Chrome or Edge on the till.";case"invalid-document":return"Print document is empty. Nothing was sent to the printer.";case"timeout":return"The receipt could not be prepared for the printer in time. Try again.";case"cancelled":return"Printing was cancelled.";case"print-failed":return"Printing failed. Check the printer is switched on and set as the default printer on this computer."}}(t),n)}e.s(["PosPrintError",0,a,"asPrintError",0,o,"isRetryable",0,s],740358);let l='Arial, Helvetica, "Liberation Sans", "DejaVu Sans", sans-serif',d=16,c=12,u=11,m=9.5,p=13,h=9,f=1.3,g={"80mm":{id:"80mm",paperWidthMm:80,printableWidthMm:72,scale:1},"58mm":{id:"58mm",paperWidthMm:58,printableWidthMm:48,scale:.86}},b="80mm";function y(e){return g[e??b]??g[b]}let v="mb-page",w="mb.receiptPaper",x="mb:receipt-paper",$=[{value:"80mm",label:"80mm roll",hint:"Standard receipt printer"},{value:"58mm",label:"58mm roll",hint:"Narrow receipt printer"}];function T(){try{let e=localStorage.getItem(w);return"58mm"===e||"80mm"===e?e:b}catch{return b}}function P(e){return window.addEventListener("storage",e),window.addEventListener(x,e),()=>{window.removeEventListener("storage",e),window.removeEventListener(x,e)}}function N(){return{paper:(0,n.useSyncExternalStore)(P,T,()=>b),setPaper:(0,n.useCallback)(e=>(function(e){try{localStorage.setItem(w,e)}catch{}window.dispatchEvent(new Event(x))})(e),[])}}e.s(["PAPER_OPTIONS",0,$,"useReceiptPaper",0,N],41447);var j=e.i(145694),k=e.i(975157),S=e.i(998354),C=e.i(394396),R=e.i(239050),D=e.i(562749),M=e.i(160231),q=e.i(12294),A=e.i(730687),E=e.i(108059);e.s(["PopPrintButton",0,function(e){let{print:o,label:l="POP Print",onPrinted:d,autoPrint:c=!1,showPaperMenu:u=!0,disabled:m,variant:p="default",size:h="default",className:f}=e,{paper:g,setPaper:b}=N(),[y,v]=(0,n.useState)("idle"),[w,x]=(0,n.useState)(0),[T,P]=(0,n.useState)(null),I=(0,n.useRef)(null),B=(0,n.useRef)(!0);(0,n.useEffect)(()=>(B.current=!0,()=>{B.current=!1,I.current&&clearTimeout(I.current)}),[]);let L=(0,n.useRef)(o),O=(0,n.useRef)(d),Q=(0,n.useRef)(g);(0,n.useEffect)(()=>{L.current=o,O.current=d,Q.current=g},[o,d,g]);let U="printing"===y||"queued"===y,K=(0,n.useRef)(!1),z=e=>{I.current&&clearTimeout(I.current),I.current=setTimeout(()=>{B.current&&(v("idle"),P(null))},e)},F=(0,n.useCallback)(async()=>{if(K.current)return;K.current=!0,(0,j.beginPrintTrace)("pop-print"),(0,j.printTrace)("button pressed",{label:l}),v("printing"),x(0),P(null);let e={paper:Q.current,onJobUpdate:e=>{B.current&&("queued"===e.state?(v("queued"),x(e.position)):"printing"===e.state&&(v("printing"),x(0)))}};try{let t=await L.current(e);if((0,j.printTrace)("print promise resolved",{ms:t.durationMs}),!B.current)return;v("printed"),(0,E.isIOS)()?A.toast.info("Sent to the print sheet",{duration:1200}):A.toast.success("Printed successfully",{duration:1200}),O.current?.(t),z(1200)}catch(t){if(!B.current)return;let e=t instanceof a?t:new a("print-failed","Printing failed. Check the printer is switched on and set as the default printer on this computer.");(0,j.printTrace)("print promise rejected",{code:e.code,detail:e.detail}),v("failed"),P({code:e.code,message:e.message}),A.toast.error("invalid-document"===e.code?"Print document is empty":"Printing failed",{description:e.message,duration:3500}),z(3500)}finally{K.current=!1}},[l]),W=(0,n.useRef)(!1);(0,n.useEffect)(()=>{!c||W.current||m||(W.current=!0,F())},[c,m,F]);let V="queued"===y?w>0?`Queued (${w} ahead)`:"Queued…":"printing"===y?"Printing…":"printed"===y?"Printed":"failed"===y?"Print Failed":l,G="failed"===y&&T?`${T.message}${s(T.code)?" Press to try again.":""}`:`Print this receipt on the ${g} roll of this computer's default printer`;return(0,t.jsxs)("div",{className:(0,k.cn)("no-print inline-flex items-stretch",f),children:[(0,t.jsxs)(r.Button,{variant:"failed"===y?"destructive":p,size:h,disabled:m||U,onClick:F,className:(0,k.cn)("flex-1",u&&"rounded-r-none"),title:G,"aria-busy":U||void 0,children:["printing"===y&&(0,t.jsx)(M.Loader2,{className:"mr-1.5 h-4 w-4 animate-spin"}),"queued"===y&&(0,t.jsx)(D.Clock,{className:"mr-1.5 h-4 w-4"}),"printed"===y&&(0,t.jsx)(C.Check,{className:"mr-1.5 h-4 w-4"}),"failed"===y&&(0,t.jsx)(S.AlertTriangle,{className:"mr-1.5 h-4 w-4"}),"idle"===y&&(0,t.jsx)(q.Printer,{className:"mr-1.5 h-4 w-4"}),V]}),u&&(0,t.jsxs)(i.DropdownMenu,{children:[(0,t.jsx)(i.DropdownMenuTrigger,{disabled:m||U,"aria-label":"Receipt paper width",title:`Receipt paper: ${g}`,className:(0,k.cn)((0,r.buttonVariants)({variant:"failed"===y?"destructive":p,size:h}),"rounded-l-none border-l-black/10 px-1.5 dark:border-l-white/15"),children:(0,t.jsx)(R.ChevronDown,{className:"h-3.5 w-3.5"})}),(0,t.jsxs)(i.DropdownMenuContent,{align:"end",className:"w-60",children:[(0,t.jsx)(i.DropdownMenuLabel,{children:"Receipt paper on this printer"}),(0,t.jsx)(i.DropdownMenuSeparator,{}),(0,t.jsx)(i.DropdownMenuRadioGroup,{value:g,onValueChange:e=>b(e),children:$.map(e=>(0,t.jsx)(i.DropdownMenuRadioItem,{value:e.value,className:"py-1.5",children:(0,t.jsxs)("span",{className:"flex flex-col",children:[(0,t.jsx)("span",{children:e.label}),(0,t.jsx)("span",{className:"text-xs text-muted-foreground",children:e.hint})]})},e.value))}),(0,t.jsx)(i.DropdownMenuSeparator,{}),(0,t.jsx)("p",{className:"px-2 py-1.5 text-xs text-muted-foreground",children:"Receipts go to the printer set as default on this computer. Change the printer in Windows Printers & scanners."})]})]})]})}],530917);let I=new Map,B=new Map,L=new Map,O=new Set,Q=new Map,U=new Set;async function K(e){if(!O.has(e)){O.add(e);try{for(;;){let t=L.get(e),n=t?.shift();if(!n)break;if(Q.set(e,n),F(e),await function(){let e=globalThis.scheduler;return e&&"function"==typeof e.yield?e.yield():new Promise(e=>setTimeout(e,0))}(),n.cancelled){Q.delete(e),F(e);continue}let r=Date.now();W(n,{state:"printing",position:0,timings:{...n.snapshot.timings,startedAt:r,queueWaitMs:r-n.snapshot.timings.createdAt}});let i={jobId:n.snapshot.jobId,timings:()=>n.snapshot.timings,composed:e=>W(n,{timings:{...n.snapshot.timings,composeMs:_(e)}}),connected:e=>W(n,{timings:{...n.snapshot.timings,connectMs:_(e)}}),sent:e=>W(n,{timings:{...n.snapshot.timings,sendMs:_(e)}}),attempt:e=>W(n,{attempt:e,timings:{...n.snapshot.timings,attempts:e}}),get cancelled(){return n.cancelled}};try{let e=await n.run(i);z(n,"printed",{result:e})}catch(t){let e=o(t,"print-failed");z(n,"failed",{error:{code:e.code,message:e.message}},e)}finally{Q.get(e)===n&&Q.delete(e),F(e)}}}finally{O.delete(e),(L.get(e)?.length??0)>0&&K(e)}}}function z(e,t,n,r){let i=Date.now();W(e,{state:t,position:0,...n,timings:{...e.snapshot.timings,finishedAt:i,totalMs:i-e.snapshot.timings.createdAt}}),B.delete(e.snapshot.key),"printed"===t?e.resolve(n.result):e.reject(r??new a(n.error?.code??"print-failed",n.error?.message??"Unable to print.")),function(e){if(!(0,j.printDebugEnabled)())return;let t=e.timings,n=`queue ${G(t.queueWaitMs)} \xb7 compose ${G(t.composeMs)} \xb7 connect ${G(t.connectMs)} \xb7 send ${G(t.sendMs)} \xb7 total ${G(t.totalMs)} \xb7 attempts ${t.attempts}`,r=`[print] ${e.documentType}${e.documentId?` ${e.documentId}`:""} → ${e.state}`;if("failed"===e.state?console.warn(`${r} (${e.error?.code}): ${n}`):console.debug(`${r}: ${n}`),"u">typeof performance&&"function"==typeof performance.measure&&t.finishedAt)try{performance.measure(`print:${e.documentType}`,{start:t.createdAt,end:t.finishedAt})}catch{}}(e.snapshot),setTimeout(()=>{I.get(e.snapshot.jobId)===e&&I.delete(e.snapshot.jobId)},3e4)}function F(e){let t=L.get(e);if(!t)return;let n=+!!Q.has(e);t.forEach((e,t)=>{let r=t+n;e.snapshot.position!==r&&W(e,{position:r})})}function W(e,t){let n=e.snapshot.state;e.snapshot={...e.snapshot,...t},t.state&&t.state!==n&&(0,j.printTrace)(`job ${t.state}`,{jobId:e.snapshot.jobId,attempt:e.snapshot.attempt}),V(e)}function V(e){for(let t of e.listeners)try{t(e.snapshot)}catch{}for(let e of U)try{e()}catch{}}function G(e){return void 0===e?"—":`${Math.round(e)}ms`}function _(e){return Math.round(10*e)/10}function J(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function H(e){return Math.round(e).toLocaleString("en-US")}function X(e,t){return`${t.trim()} ${H(e)}`}function Y(e,t){let n=arguments.length>2&&void 0!==arguments[2]?arguments[2]:"";return`<div class="kv ${n}"><span class="k">${J(e)}</span><span class="v">${J(t)}</span></div>`}function Z(){let e=arguments.length>0&&void 0!==arguments[0]&&arguments[0];return`<hr class="rule${e?" dashed":""}">`}function ee(e){return e&&e.startsWith("data:image/")?`<img class="logo" src="${e}" alt="">`:""}function et(e,t,n){let r;return`<!doctype html>
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
    font-size: ${r(u)};
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
  .doc-title { font-size: ${r(u)}; text-transform: uppercase; letter-spacing: 0.04em; }
  .sub { font-size: ${r(u)}; }
  .small { font-size: ${r(m)}; }
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
    font-size: ${r(m)}; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;
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
  .note { font-size: ${r(u)}; }
  .sign { display: flex; gap: 4mm; margin-top: 5mm; }
  .sign > div { flex: 1 1 0; border-top: 1px solid #000; padding-top: 0.6mm; font-size: ${r(m)}; text-transform: uppercase; }
  .footer { font-size: ${r(h)}; text-align: center; margin-top: 2mm; }
  img.logo { display: block; margin: 0 auto 1mm; height: 12mm; width: auto; max-width: 28mm; }
  #mb-gauge { position: absolute; top: 0; left: 0; width: ${t.paperWidthMm}mm; height: 0; visibility: hidden; }
  @media print { #mb-gauge { display: none; } }
  `}</style>
<style id="${v}"></style>
</head>
<body><div id="mb-gauge"></div><div class="receipt" id="mb-receipt">${n}</div></body>
</html>`}class en extends Error{constructor(e){super(e),this.name="InvalidDocumentError"}}function er(e,t){if(0===e.items.length&&0===e.packingItems.length)throw new en("There are no waiting demands to print.");if(null!==e.totals.grandAmount){let t=e.branchItems.filter(e=>null!==e.amount);if(t.length!==e.branchItems.length)throw new en("The grand amount is stated but a branch amount is unavailable.");let n=t.reduce((e,t)=>e+(t.amount??0),0);if(Math.abs(n-e.totals.grandAmount)>1)throw new en(`The branch amounts do not add up to the grand total (${n} ≠ ${e.totals.grandAmount}).`)}let n=y(t),r=e.currencySymbol?.trim()||"Rs.",i=(e.companyName?.trim()||"MOUNTAIN BAKES").toUpperCase(),a=e.items.map(e=>`<tr><td class="name">${J(e.productName)}</td><td class="num amt">${H(e.qty)}</td></tr>`).join(""),s=e.packingItems.map(e=>`<tr><td class="name">${J(e.materialName)}</td><td class="num amt">${H(e.qty)}</td></tr>`).join(""),o=e.branchItems.map(e=>`<tr>
  <td class="name">${J(e.branchName)}</td>
  <td class="num qty">${H(e.qty)}</td>
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
${Y("Total Qty",H(e.totals.totalProductQty))}
${Z()}
${e.packingItems.length>0?`<div class="section">Packing Material Requirements</div>
<table class="items">
  <thead><tr><th class="name">Packing Material</th><th class="num amt">Qty</th></tr></thead>
  <tbody>${s}</tbody>
</table>
${Y("Packing Qty",H(e.totals.totalPackingQty))}
${Z()}`:""}
<div class="section">Demand Totals</div>
${Y("Distinct Products",H(e.totals.distinctProducts))}
${Y("Total Product Qty",H(e.totals.totalProductQty))}
${e.totals.distinctPacking>0?Y("Distinct Packing Items",H(e.totals.distinctPacking)):""}
${e.totals.distinctPacking>0?Y("Total Packing Qty",H(e.totals.totalPackingQty)):""}
${Z()}
<div class="section">Branch-wise Summary</div>
<table class="items">
  <thead><tr><th class="name">Branch</th><th class="num qty">Qty</th><th class="num amt">Amount</th></tr></thead>
  <tbody>${o}</tbody>
</table>
${Y("Grand Qty",H(e.totals.totalProductQty))}
${Y("Grand Amount",null===e.totals.grandAmount?"Amount unavailable":X(e.totals.grandAmount,r),"total")}
${Z()}
<div class="footer">* Design &amp; developed by arifsiksavi@gmail.com | 0322-2050545 *</div>
`;return{kind:"demand-summary",id:e.businessDateText,title:"Production Demand Summary",paper:n,html:et("Production Demand Summary",n,l),mustContain:["Production Demand Summary",i]}}function ei(e,t,n,r){if(!("function"==typeof window.print&&"u">typeof document))return Promise.reject(new a("not-supported","This browser cannot open a print dialog, so the printer installed on this computer cannot be reached from here."));let{promise:i}=function(e){let t,n,r=B.get(e.key);if(r)return e.onUpdate&&(r.listeners.add(e.onUpdate),e.onUpdate(r.snapshot)),{jobId:r.snapshot.jobId,promise:r.promise,deduplicated:!0};let i="u">typeof crypto&&"function"==typeof crypto.randomUUID?crypto.randomUUID():`job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`,a=new Promise((e,r)=>{t=e,n=r});a.catch(()=>{});let s={snapshot:{jobId:i,key:e.key,printerKey:e.printerKey,documentType:e.documentType,documentId:e.documentId,state:"queued",position:0,attempt:0,timings:{createdAt:Date.now(),attempts:0}},run:e.run,listeners:new Set(e.onUpdate?[e.onUpdate]:[]),resolve:t,reject:n,promise:a,cancelled:!1};I.set(i,s),B.set(e.key,s);let o=L.get(e.printerKey)??[];return o.push(s),L.set(e.printerKey,o),F(e.printerKey),V(s),K(e.printerKey),{jobId:i,promise:a,deduplicated:!1}}({key:`${t}:${e||"none"}${r.requestId?`:${r.requestId}`:""}`,printerKey:"system-default",documentType:t,documentId:e||null,onUpdate:r.onJobUpdate,run:e=>ea(n,e)});return i}async function ea(e,t){let n,r=Date.now(),i=ec();try{n=e()}catch(e){if(e instanceof en)throw new a("invalid-document",e.message);throw e}return t.composed(ec()-i),(0,j.printTrace)("document composed",{ms:Math.round(ec()-i),bytes:n.html.length,kind:n.kind}),await es(n,t),{printJobId:t.jobId,durationMs:Date.now()-r}}async function es(e,t){let n=window.document,r=n.createElement("iframe");r.setAttribute("aria-hidden","true"),r.setAttribute("tabindex","-1"),r.title=e.title,r.style.cssText=`position:absolute;top:-10000px;left:-10000px;width:${e.paper.paperWidthMm+20}mm;height:400mm;border:0;background:#fff`;let i=()=>{window.setTimeout(()=>r.remove(),1e3)};n.body.appendChild(r);try{let n=ec();await new Promise((t,n)=>{let i=window.setTimeout(()=>n(new a("timeout","The receipt could not be prepared for the printer. Try again.")),1e4);r.addEventListener("load",()=>{window.clearTimeout(i),t()},{once:!0}),r.srcdoc=e.html});let i=r.contentWindow,s=r.contentDocument;if(!i||!s)throw new a("print-failed","The receipt could not be prepared for the printer. Try again.");(0,j.printTrace)("receipt frame loaded"),await el(s),function(e,t){try{let n=e.getElementById("mb-gauge"),r=e.getElementById("mb-receipt"),i=e.getElementById(v);if(!n||!r||!i)return;let a=n.getBoundingClientRect().width/t;if(!(a>0))return;let s=r.getBoundingClientRect().height/a;if(!(s>0))return;let o=Math.ceil(s)+2;i.textContent=`@page { size: ${t}mm ${o}mm; margin: 0; }`}catch{}}(s,e.paper.paperWidthMm),function(e,t){let n=e.getElementById("mb-receipt"),r=n?.getBoundingClientRect();if(!n||!r||!(r.height>0)||!(r.width>0))throw new a("invalid-document","Print document is empty. Nothing was sent to the printer.");let i=ed(n.innerText||n.textContent||"");if(0===i.length)throw new a("invalid-document","Print document is empty. Nothing was sent to the printer.");let s=t.mustContain.filter(e=>!i.includes(ed(e)));if(s.length>0)throw new a("invalid-document","Print document is incomplete. Nothing was sent to the printer.",`missing: ${s.join(", ")}`)}(s,e),t.connected(ec()-n),(0,j.printTrace)("receipt fitted and verified",{ms:Math.round(ec()-n)});let l=ec();await new Promise((e,t)=>{let n=!1,r=0,a=0,l=()=>{window.clearTimeout(r),window.clearTimeout(a),i.removeEventListener("afterprint",d),window.removeEventListener("afterprint",d)};function d(){n||(n=!0,l(),(0,j.printTrace)("print dialog finished"),e())}i.addEventListener("afterprint",d),window.addEventListener("afterprint",d),r=window.setTimeout(d,3e4);try{if((0,E.isIOS)()){let e=function(e){let t=window.document;t.getElementById(eo)?.remove();let n=t.createElement("div");n.id=eo;let r=n.attachShadow({mode:"open"});for(let n of Array.from(e.querySelectorAll("style"))){if(n.id===v)continue;let e=t.createElement("style");e.textContent=(n.textContent??"").replace(/@page\s*\{[^}]*\}/g,"").replace(/\bhtml\s*,\s*body\b/g,":host").replace(/(^|[}\s])body(\s*\{)/g,"$1:host$2"),r.appendChild(e)}let i=e.getElementById("mb-receipt");i&&r.appendChild(t.importNode(i,!0));let a=e.getElementById(v)?.textContent??"",s=t.createElement("style");return s.textContent=`
    #${eo} { display: none; }
    @media print {
      html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
      body > *:not(#${eo}) { display: none !important; }
      #${eo} { display: block !important; }
    }
    ${a}
  `,t.head.appendChild(s),t.body.appendChild(n),()=>{s.remove(),n.remove()}}(s),t=()=>window.setTimeout(e,1e3);window.addEventListener("afterprint",t,{once:!0}),window.setTimeout(t,3e4),(0,j.printTrace)("top-document print() called (iOS)"),window.print();return}i.focus(),(0,j.printTrace)("frame print() called"),i.print(),(0,j.printTrace)("frame print() returned")}catch(e){n=!0,l(),t(o(e,"print-failed"));return}a=window.setTimeout(d,1500)}),t.sent(ec()-l)}catch(e){throw i(),o(e,"print-failed")}i()}let eo="mb-ios-print";async function el(e){let t=e.fonts?.ready,n=Array.from(e.images).filter(e=>!e.complete).map(e=>"function"==typeof e.decode?e.decode().catch(()=>void 0):Promise.resolve()),r=Promise.all([t??Promise.resolve(),...n]);await Promise.race([r,new Promise(e=>setTimeout(e,1500))]),await new Promise(t=>{let n=(e.defaultView??window).requestAnimationFrame;"function"==typeof n?n(()=>t()):t()})}function ed(e){return e.replace(/\s+/g," ").trim().toLowerCase()}function ec(){return"u">typeof performance?performance.now():Date.now()}e.s(["demandSummaryDocument",0,function(e){let t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:"80mm";return er(e,t)},"printBranchClosing",0,function(e){let t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:{};return ei(`${e.branchName}-${e.businessDateText}`,"branch-closing",()=>(function(e,t){if(!e.branchName?.trim())throw new en("This closing sheet has no branch to print.");if(!e.businessDateText?.trim())throw new en("This closing sheet has no business date to print.");let n=e.paymentLines.reduce((e,t)=>e+t.amount,0);if(Math.abs(n-e.totalSales)>1)throw new en(`The payment method totals do not add up to total sales (${n} ≠ ${e.totalSales}).`);let r=y(t),i=e.currencySymbol?.trim()||"Rs.",a=(e.companyName?.trim()||"MOUNTAIN BAKES").toUpperCase(),s=e.branchName.trim(),o=e.stockLines.map(e=>`<tr><td class="name">${J(e.productName)}</td><td class="num amt">${H(e.balance)}</td></tr>`).join(""),l=e.paymentLines.map(e=>Y(e.label,X(e.amount,i))).join(""),d=`
<div class="c">
  ${ee(e.logo)}
  <div class="company">${J(a)}</div>
  <div class="dept">Branch Closing</div>
  <div class="sub">${J(s)}</div>
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
  <tbody>${o||'<tr><td colspan="2" class="note">No balance stock.</td></tr>'}</tbody>
</table>
${Z()}
<div class="section">Payment Details</div>
${l||'<div class="note">No sales recorded for this date.</div>'}
${Z()}
${Y("Total Sales",X(e.totalSales,i))}
${e.discounts>0?Y("Discounts",X(e.discounts,i)):""}
${Y("Expenses",X(e.totalExpenses,i))}
${Y("Closing Cash",X(e.cashInHand,i),"total")}
${Y("Orders / Cancelled",`${H(e.orderCount)} / ${H(e.cancelled)}`)}
${Z()}
<div class="footer">End of Closing Report</div>
`;return{kind:"branch-closing",id:`${s}-${e.businessDateText}`,title:`Branch Closing — ${s}`,paper:r,html:et(`Branch Closing — ${s}`,r,d),mustContain:["Branch Closing",a,s]}})(e,t.paper??"80mm"),t)},"printDemandSummary",0,function(e){let t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:{};return ei(e.businessDateText,"demand-summary",()=>er(e,t.paper??"80mm"),t)},"printProductionOrder",0,function(e){let t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:{};return ei(e.orderNumber,"production-order",()=>{var n,r,i,a;let s,o,l,d,c,u,m,p,h,f,g;return n=t.paper??"80mm",!function(e){if(!e.orderNumber?.trim())throw new en("This order has no reference number to print.");let t=e.items.filter(e=>e.qty>0),n=e.packingItems??[];if(0===t.length&&0===n.length)throw new en("This order has no approved items or packing materials to print.");let r=t.reduce((e,t)=>e+t.amount,0);if(Math.abs(r-e.grandTotal)>1)throw new en(`The order lines do not add up to the total (${r} ≠ ${e.grandTotal}).`);let i=new Set;for(let e of n){let t=e.materialName?.trim();if(!t)throw new en("A packing material on this order has no name.");if(!(e.qty>0))throw new en(`"${t}" has no quantity and should not be on the print.`);let n=t.toLowerCase();if(i.has(n))throw new en(`"${t}" appears twice on this order.`);i.add(n)}}(e),s=y(n),o=e.currencySymbol?.trim()||"Rs.",l=(e.companyName?.trim()||"MOUNTAIN BAKES").toUpperCase(),d=e.items.filter(e=>e.qty>0),c=e.packingItems??[],u=d.reduce((e,t)=>e+t.qty,0),m=X(e.grandTotal,o),p=d.map(e=>`<tr>
  <td class="name">${J(e.productName)}</td>
  <td class="num qty">${H(e.qty)}</td>
  <td class="num rate">${H(e.unitPrice)}</td>
  <td class="num amt">${H(e.amount)}</td>
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
${Y("Total Qty",H(u))}
${Y("TOTAL",m,"total")}
${Z()}
${c.length>0?(f=(r=c).map(e=>`<tr>
  <td class="name">${J(e.materialName)}</td>
  <td class="num amt">${H(e.qty)}</td>
</tr>`).join(""),g=r.reduce((e,t)=>e+t.qty,0),`<div class="section">Packing Materials</div>
<table class="items">
  <thead><tr><th class="name">Packing Material</th><th class="num amt">Qty</th></tr></thead>
  <tbody>${f}</tbody>
</table>
${Y("Packing Qty",H(g))}
${Z()}`):""}
${void 0===e.previousCollection?"":(i=e.previousCollection,a=o,i?`<div class="section">Previous Order Balance</div>
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
`,{kind:"production-order",id:e.orderNumber,title:`Production order ${e.orderNumber}`,paper:s,html:et(`Production order ${e.orderNumber}`,s,h),mustContain:[e.orderNumber,m,l,...c.map(e=>e.materialName)]}},t)},"printSaleReceipt",0,function(e){let t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:{};return ei(e.saleId,"sale",()=>(function(e,t){if(!e.items||0===e.items.length)throw new en("This sale has no items to print.");if(!e.saleId?.trim())throw new en("This sale has no reference number yet.");if(!e.paymentMethodLabel?.trim())throw new en("This sale has no payment method recorded.");if(Math.abs(e.grossTotal-e.discountTotal+e.taxAmount-e.grandTotal)>1)throw new en(`The sale totals do not reconcile (gross ${e.grossTotal} - discount ${e.discountTotal} + tax ${e.taxAmount} ≠ total ${e.grandTotal}).`);let n=y(t),r=e.currencySymbol?.trim()||"Rs.",i=(e.companyName?.trim()||"MOUNTAIN BAKES").toUpperCase(),a=X(e.grandTotal,r),s=e.items.map(e=>`<tr>
  <td class="name">${J(e.productName)}</td>
  <td class="num qty">${H(e.qty)}</td>
  <td class="num rate">${H(e.unitPrice)}</td>
  <td class="num amt">${H(e.lineTotal)}</td>
</tr>`).join(""),o=`
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
  <tbody>${s}</tbody>
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
`;return{kind:"sale",id:e.saleId,title:`Receipt ${e.saleId}`,paper:n,html:et(`Receipt ${e.saleId}`,n,o),mustContain:[e.saleId,a,i]}})(e,t.paper??"80mm"),t)}],828844)}]);