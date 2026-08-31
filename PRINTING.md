# Printing

Two paths, deliberately separate, and neither falls back to the other on its own.

```
POS receipts                          A4 documents
────────────                          ────────────
PosPrintButton                        PrintButton
      ↓                                     ↓
lib/print/pos/printerService          lib/print/browser/documentPrint
      ↓  ESC/POS bytes                      ↓  window.print()
lib/print/pos/transport               browser print dialog
      ↓  WebUSB / Web Serial / TCP          ↓
80mm thermal printer                  sheet printer / Save as PDF
```

## The local print service is gone

Receipts used to be posted as base64 to a small Node agent on `127.0.0.1:9110`,
which spooled them raw. It worked, and it cost a second program on every till
that had to be installed, started at boot, kept running and kept reachable. When
it was not, the counter got:

> POS printing service is not running. Start the local print service on this
> computer and try again.

— a message about our plumbing, offering a fix nobody at a till can perform.

**The browser opens the printer itself now.** `lib/print/pos/transport/` holds
three ways to do that, and `printerService` no longer knows or cares which one is
in use. Nothing in this app may reintroduce that sentence; `service-unavailable`
is not a code any more, and the two codes that replaced it draw the line it
blurred — between a browser that *cannot* do this (`not-supported`, a different
browser is the only fix) and a printer that is not there *right now*
(`not-connected` / `printer-offline`, plug it in and press Reconnect).

`print-agent/` is retained on disk as a reference implementation and is no longer
used, started, or reached by anything in the app.

## Why "Print preview failed" happened

`src/app/globals.css` declares a global `@page { size: A4; margin: 12mm }`. A bare
`window.print()` leaves it in force, and an 80mm roll driver handed an A4 page box
is a layout Chrome cannot generate a preview for — it reports *"Print preview
failed"* and greys out its own Print button.

`src/lib/printPaper.ts` overrides that page box for a POS device, and **every**
browser print now goes through `printDocument()`, which applies it and removes the
injected `@page` on `afterprint`. Receipts do not print through the browser at
all.

## POS printing

`src/lib/print/pos/`

| module | what it owns |
| --- | --- |
| `escpos.ts` | The printer's command language. Blocks → bytes, and blocks → text for the in-app preview. |
| `table.ts` | The PRODUCT / QTY / RATE / AMOUNT formatter. Column widths measured from the rows, never guessed. Wrapping, alignment, dividers, amount rows. |
| `profiles.ts` | Paper widths and how many characters fit across them (80mm → 48, 58mm → 32). |
| `receiptFormatter.ts` | The sale receipt, the production slip, the test page — and the validation that runs before any of them is composed. |
| `printerConfig.ts` | Which printer this device uses. localStorage, keyed by branch. |
| `transport/` | How the bytes leave the browser. WebUSB, Web Serial, raw TCP. |
| `printerService.ts` | The one entry point. Validate → compose → send → log. |
| `printLog.ts` | The last 200 jobs on this device, for diagnosing a POS complaint. |
| `errors.ts` | Every failure code, and the sentence a cashier sees for it. |

Screens call `printSaleReceipt(doc, context)` or `printProductionOrder(doc, context)`
and show what comes back. Neither Sales nor Production contains printer logic —
that is the point, because the moment it exists in two pages it starts to differ
between them.

### The three transports, and what each really needs

| | API | Works in | Does not work in |
| --- | --- | --- | --- |
| **USB POS Printer** | WebUSB | Chrome / Edge / Opera, desktop and Android, over https | Firefox, Safari, anything on iOS |
| **USB Serial POS Printer** | Web Serial | Chrome / Edge / Opera, desktop only, over https | Firefox, Safari, Android, iOS |
| **Network / LAN** | Direct Sockets (`TCPSocket`) | An installed Isolated Web App | An ordinary web page — see below |

Each transport answers `support()` **before** anything is offered, so a till that
cannot do this is told at setup time, on a quiet morning, rather than by a failed
print in front of a customer. Unsupported options appear in the dialog greyed,
with the reason, rather than disappearing.

Two limits worth knowing before someone files a bug:

- **Windows will not share a USB printer.** If the unit is installed through
  *Printers & scanners*, `usbprint.sys` owns the interface and `claimInterface`
  fails. That is reported as `device-busy` with the fix in the sentence: remove it
  from Windows printers, or bind WinUSB to it (Zadig). It is an OS rule, not
  something this code can work around.
- **A serial printer at the wrong baud rate prints garbage, not nothing.** It is
  the one failure a status pill cannot catch, which is why the speed is a visible
  setting with 9600 as the default.

### Why LAN printing is honest about being unavailable

A network thermal printer speaks **raw TCP on port 9100**. It is not an HTTP
server: no request line, no CORS headers, and it will cheerfully print the text of
an HTTP request sent to it.

A web page cannot open a TCP socket. `fetch('http://192.168.1.100:9100', …)` — the
shape of every "LAN printing from the browser" snippet online — fails three ways
at once (mixed content, CORS, and the printer receiving HTTP headers as text), and
**none of them is detectable from script**. That is exactly why the approach looks
like it works: the promise settles, nothing throws where anyone is looking, and
the page reports success while no paper has moved.

`transport/network.ts` therefore implements the real thing (`TCPSocket`, granted
to Isolated Web Apps) and reports `not-supported` with an explanation everywhere
else. It never fakes a send and never falls back to the browser dialog. The two
honest alternatives, for whoever asks: point USB at the same printer, or use a
printer's own "server print" polling mode, which is an API change rather than a
browser one.

### Printer setup

*POS Printer Setup* opens from the `● POS Printer …` indicator on the Sales page
and in the production order dialog, and from the failure panel when a print fails.

The form is a **draft** until Save: Connect and Test Print run against what is on
screen, so a printer can be tried before the till commits to it, and closing
without saving leaves the previous printer untouched. Save marks it the default
printer for this device and this branch — after which nothing asks again.

`Connect Printer` opens the *browser's* device chooser. The app never sees the
list and cannot pre-select from it; the grant is made by a person, to one device,
for this origin, and Chrome remembers it. `getDevices()` re-adopts it silently on
every later load, which is what makes "set it up once" true.

The test page prints a character ruler. If it wraps instead of ending at the edge
of the roll, the printer is set to a different font — correct it with
*Characters per line* rather than by editing `profiles.ts`.

### Per branch, per machine

The config is localStorage keyed by branch id. That is deliberate twice over: a
printer is a fact about a *machine* (the office laptop has a different one, or
none), and a shared till at head office is signed into by more than one branch
account — a Committee Chowk receipt must not go to the roll another branch set up
on the same computer. Switching branch switches printer, with no step for anyone
to forget.

A config written by the print-agent build is migrated on read: the paper width,
copies and column override survive; the agent URL, the agent token and the spooler
printer id are dropped, because none of them addresses a device this app can open.
The till presses Connect once.

### Duplicate protection, in two layers

1. **The button** disables itself while a print is in flight — an impatient
   double-click.
2. **The service** refuses a second print of the same document while one is in
   flight — two different buttons aimed at one sale.

There used to be a third in the agent, which ignored a job id it had already run —
protection against an HTTP request retried after its response was lost. With no
request and no response, the write either reaches the device or throws. The layer
went with the hazard it existed for.

A deliberate reprint mints a new job id and is never suppressed.

### What the sale receipt does and does not carry

It carries the payment method, in capitals, as its last line (`PAYMENT METHOD:
CASH` — Cash, Easypaisa, Foodpanda, Bank Account). It does **not** carry
`settings.receiptFooter` — the "Thank you for choosing Mountain Bakes… Phone: …"
line. That footer belongs to the A4/PDF invoice (`InvoiceView` reads it); the POS
receipt is a till record and ends at the payment method and the cut. Do not add it
back because the on-screen invoice has it.

Totals are printed exactly as stored. `validateSaleDoc` refuses to compose a
receipt whose parts do not reconcile to its total — an unprintable receipt beats a
wrong one in a customer's hand.

## Browser printing

`src/lib/print/browser/documentPrint.ts`, driven by `PrintButton`. Used by the A4
delivery challan, the production check sheet, the reports and the branch closing
sheet.

`usePrintCapability` / `usePaperCapability` still decide the button's wording and
the page box. Read the caveats in that file: no browser can enumerate printers, so
both are device preferences with a heuristic default, not facts.

## Security

- **No secret ships in the bundle, and there is no longer a secret at all.** The
  agent's optional shared key went with the agent. What is stored per till is a
  vendor id, a product id and a serial number — a *description* of a device, not a
  credential. With those three numbers and no browser grant, this app can do
  nothing.
- **The grant is the security boundary.** A page can only reach a USB or serial
  device a person explicitly chose for this origin, and only over https. No other
  site can use it, and this one cannot enumerate what it was not given.
- **Printing cannot leak another branch's data.** The receipt is composed from data
  the API already returned to this session, and the API scopes every read against
  the JWT. There is no print-by-id endpoint to tamper with.
- **Debug output is role-gated.** Payload previews and raw device detail are
  super-admin only; counter staff see the sentence and the next action.

## Mobile

`mobile/src/common/printing/` is the React Native app's own ESC/POS layer, over
Bluetooth via a native module. It is deliberately parallel to `lib/print/pos/` —
same block model, same wrap rules, same transliteration table — so a receipt from
the counter tablet reads like one from the till. They are separate files because
the runtimes disagree about primitives this low (Hermes has no `btoa`, the browser
has no `Buffer`; mobile ends in base64 for its native bridge, the web hands a
`Uint8Array` to a device API). **Nothing enforces that they stay in step**; change
one and check the other.
