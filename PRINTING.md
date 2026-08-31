# Printing

Two paths, deliberately separate, and neither falls back to the other on its own.

```
POS receipts                          A4 documents
────────────                          ────────────
PosPrintButton                        PrintButton
      ↓                                     ↓
lib/print/pos/printerService          lib/print/browser/documentPrint
      ↓  ESC/POS bytes over HTTP            ↓  window.print()
print-agent (127.0.0.1:9110)          browser print dialog
      ↓  raw spool job                      ↓
80mm thermal printer                  sheet printer / Save as PDF
```

## Why "Print preview failed" happened

`src/app/globals.css` declares a global `@page { size: A4; margin: 12mm }`. A bare
`window.print()` leaves it in force, and an 80mm roll driver handed an A4 page box
is a layout Chrome cannot generate a preview for — it reports *"Print preview
failed"* and greys out its own Print button.

`src/lib/printPaper.ts` has always existed to override that page box for a POS
device, but only `OrderPrintPreview` ever called it. The sales invoice — the
screen the bug was reported from — called `window.print()` directly, both on the
"Save & Print" timer and through `PrintButton`'s default action.

Both halves are fixed:

- **Every** browser print now goes through `printDocument()`, which applies the
  device's paper and removes the injected `@page` on `afterprint`. There is no
  call site left that can forget it.
- Receipts do not print through the browser at all any more.

## POS printing

`src/lib/print/pos/`

| module | what it owns |
| --- | --- |
| `escpos.ts` | The printer's command language. Blocks → bytes, and blocks → text for the in-app preview. |
| `table.ts` | The PRODUCT / QTY / RATE / AMOUNT formatter. Column widths measured from the rows, never guessed. |
| `profiles.ts` | Paper widths and how many characters fit across them (80mm → 48, 58mm → 32). |
| `receiptFormatter.ts` | The sale receipt, the production slip, the test page — and the validation that runs before any of them is composed. |
| `printerConfig.ts` | Which printer this device uses. localStorage, keyed by branch. |
| `printerService.ts` | The one entry point. Validate → compose → send → log. |
| `printLog.ts` | The last 200 jobs on this device, for diagnosing a POS complaint. |
| `errors.ts` | Every failure code, and the sentence a cashier sees for it. |

Screens call `printSaleReceipt(doc, context)` or `printProductionOrder(doc, context)`
and show what comes back. Neither Sales nor Production contains printer logic —
that is the point, because the moment it exists in two pages it starts to differ
between them.

### The local print agent

A browser cannot open a USB port or spool a job, so the bytes go to a small Node
service on the till. It is in `print-agent/`, has no dependencies, binds
loopback only, and is documented in its own README — including how to run it as a
service and which transports it supports (Windows spooler, CUPS, raw TCP, device
node).

The app finds it at `http://127.0.0.1:9110` by default; a till can move that in
Printer Settings.

### Printer setup

Printer Settings opens from the `● POS Printer …` indicator on the Sales page and
in the production order dialog, and from the failure panel when a print fails. It
lists **the printers the till actually has**, read from that machine's spooler.
Nothing hardcodes a printer name; replacing the hardware is a re-pick, not a
release.

The test page prints a character ruler. If it wraps instead of ending at the edge
of the roll, the printer is set to a different font — correct it with
*Characters per line* rather than by editing `profiles.ts`.

### Duplicate protection, in three layers

Each catches something the others cannot:

1. **The button** disables itself while a print is in flight — an impatient
   double-click.
2. **The service** refuses a second print of the same document while one is in
   flight — two different buttons aimed at one sale.
3. **The agent** ignores a `printJobId` it has already run, for one minute — a
   request retried after its response was lost.

A deliberate reprint mints a new job id and is never suppressed.

### What the sale receipt does and does not carry

It carries the payment method, in capitals, as its last line. It does **not**
carry `settings.receiptFooter` — the "Thank you for choosing Mountain Bakes…
Phone: …" line. That footer belongs to the A4/PDF invoice (`InvoiceView` reads
it); the POS receipt is a till record and ends at the payment method and the cut.
Do not add it back because the on-screen invoice has it.

Totals are printed exactly as stored. `validateSaleDoc` refuses to compose a
receipt whose parts do not reconcile to its total — an unprintable receipt beats a
wrong one in a customer's hand.

## Browser printing

`src/lib/print/browser/documentPrint.ts`, driven by `PrintButton`. Used by the A4
delivery challan, the production check sheet, the reports and the branch closing
sheet. All unchanged in behaviour except that the paper switch is now guaranteed.

`usePrintCapability` / `usePaperCapability` still decide the button's wording and
the page box. Read the caveats in that file: no browser can enumerate printers, so
both are device preferences with a heuristic default, not facts.

## Security

- **No secret ships in the bundle.** The agent's optional shared key is typed into
  Printer Settings on the till that needs it and stays in that browser. There is no
  `NEXT_PUBLIC_` variable for it and there must not be one — a build-time constant
  would put the shop's print key in every browser that loads the app.
- **The agent is loopback-only and origin-allowlisted.** It is not reachable from
  the shop LAN, and only the app's own origins may drive it. `print-agent.config.json`
  is gitignored.
- **Printing cannot leak another branch's data.** The receipt is composed from data
  the API already returned to this session, and the API scopes every read against
  the JWT. There is no print-by-id endpoint to tamper with.
- **Debug output is role-gated.** Payload previews and raw agent detail are
  super-admin only; counter staff see the sentence and the next action.

## Mobile

`mobile/src/common/printing/` is the React Native app's own ESC/POS layer, over
Bluetooth via a native module. It is deliberately parallel to `lib/print/pos/` —
same block model, same wrap rules, same transliteration table — so a receipt from
the counter tablet reads like one from the till. They are separate files because
the runtimes disagree about primitives this low (Hermes has no `btoa`, the browser
has no `Buffer`). **Nothing enforces that they stay in step**; change one and check
the other.
