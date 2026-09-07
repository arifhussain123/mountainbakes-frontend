# Printing

Two paths, deliberately separate, and neither falls back to the other on its own.

```
Receipts (POP Print)                              A4 documents
────────────────────                              ────────────
PopPrintButton                                    PrintButton
      ↓                                                 ↓
lib/print/systemPrinter                           lib/print/browser/documentPrint
      ↓  validate → canonical document                  ↓  window.print() of the page
lib/print/receipt/*  (one HTML document,          browser print dialog
      ↓               its own stylesheet)               ↓
a frame of its own → measured page box            sheet printer / Save as PDF
      ↓  content read back and checked
window.print() of the frame
      ↓
the printer this computer has installed
(dialog, or none with --kiosk-printing)
```

## One canonical document

`lib/print/receipt/` builds the receipt as a **self-contained HTML document**:
its own `<style>`, black on white stated explicitly, one font family and one type
scale (`styles.ts` — `PRINT_STYLES`), no dependency on the application's CSS.
Everything that prints a receipt prints *that document*:

- **POP Print** hands it to the installed printer (`systemPrinter.ts`).
- **Save as PDF** is a destination in the same dialog for the same document.
- A preview is the same HTML opened in a tab.

There is no second template for the PDF and no third for the paper. The figures
are the caller's stored figures (`receipt/types.ts`), checked in `validate.ts` —
the parts must reconcile to the total, and the total is printed as given, never
recomputed.

## What a browser can do here, and what it cannot

A web page cannot pick a printer or print silently on its own. `print()` sends
the document to the **operating system's default printer through the browser's
print dialog**; the person at the till presses Print. Chrome and Edge can be told
to skip the dialog — start the browser with `--kiosk-printing` — and the job goes
straight to the default printer. That is a decision about the machine, made once
by whoever sets the till up. Nothing here bypasses it, opens a device, or talks
to a local service.

Consequently there is **no printer setup in the app**. Which printer, how it is
connected, its address — those are set once in Windows *Printers & scanners* and
never asked for here. The one printing setting Mountain Bakes keeps is the roll
width (80mm / 58mm), per device, in `receiptPaper.ts`, because no browser can read
it off the driver and a receipt laid out for 72mm on a 48mm roll loses its
amounts column.

## One source of print data — the production order

```
order (fetched, not remembered)
      ↓
getPrintData()            lib/print/productionOrderPrintData.ts
      ↓
validatePrintData()       lib/print/receipt/validate.ts
      ↓
ProductionOrderDoc        the canonical print document, as data
      ├── POP Print       receipt/productionOrder.ts → systemPrinter → default printer
      ├── A4 challan      OrderPrintPreview PrintCopy ×2 → browser dialog / Save as PDF
      └── Check sheet     OrderPrintPreview ProductionCheckSheet
```

`getPrintData` is the only place a demand line becomes a printed quantity. It
resolves, once, per line: the branch's **demand**, Production's **changed**
quantity (the stored approval once the order has left `pending`; the quantity
being typed before that), the snapshotted rate and the amount. The on-screen
review table uses the same resolver (`resolveProductLine` /
`resolvePackingLine`), so the screen, the roll and the sheet cannot disagree.
No destination recomputes a total: `grandTotal` is checked against the lines
and printed as given.

**Every print starts with a fetch.** `OrderPrintPreview.preparePrintData()`
refetches the order and its previous-balance figures and builds the document
from what comes back — never from the `order` prop the dialog opened with. A
fetch that fails is a print that does not happen; the toast says so.

**Packing materials** (shoppers, boxes, spoons, writing cream — the Admin
master list in `packing_materials`) ride on the same document, in their own
table, with no rate and no amount and never in the total:

- The document carries a packing line **only when the branch requested it**
  (`demandQty > 0`). A demand with no packing request prints no packing
  heading, no empty table — nothing.
- When it did, every requested material prints at its exact demand and
  changed quantities, once. `validatePrintData` refuses a zero-quantity or
  duplicate packing row rather than printing it.
- A packing-only demand is a real order: it prints with a product total of 0.
- An order with **nothing going out** — no product and no packing line with a
  changed quantity above zero — is refused before any destination sees it, so
  the printer never feeds and cuts a blank slip.

The receipt prints, top to bottom: logo, company, Production Department,
Production Order; order number, slip reference, branch, status, business date
and time, required date, print date and time; PRODUCTS as *Product (@ rate) /
Demand / Changed / Amount* with Total Qty and TOTAL; PACKING MATERIALS as
*Packing Material / Demand / Changed* (only when requested); PREVIOUS ORDER
BALANCE and AMOUNT TO COLLECT; the PAYMENT lines the rider fills in; and the
Collected By / Received By signatures. The A4 copies carry the same data on a
sheet, plus the itemised returns and discounts on the Company Copy.

## The blank-page guard

The failure this design answers: paper and PDF both came out completely white
while the app said "Printed successfully", and the printer cut the blank paper.
Before `print()` is called, `systemPrinter.ts`:

1. Loads the document into an **off-screen but opaque** frame. A frame that is
   `display: none`, `visibility: hidden` or `opacity: 0` has been seen to print
   as a blank sheet; one parked outside the viewport is laid out like any other.
2. Waits for the frame's fonts (local — Arial first, nothing fetched) and images
   (inlined `data:` URLs only; a plain URL is left off rather than waited for).
3. **Measures** the rendered receipt and writes the page box as
   `<paper width> × <measured height>` — the paper width, which every roll driver
   lists, not the 72mm print area, which none does.
4. **Reads the rendered text back** and refuses the job as `invalid-document` if
   the receipt box has no height or its text does not contain the reference
   number, the total, the company name and every requested packing material
   (`PrintDocument.mustContain`). Nothing is sent, no paper is fed, no cut
   happens.

## The queue

`printQueue.ts` runs one job at a time and folds a second request for the same
document onto the job in flight. The press returns immediately; composing, the
frame, the measurement and the dialog all happen after the event loop has had a
turn, so the button repaints as *Printing…* before any of it starts. A print
never reloads the page, refetches the order list or blocks React.

Feedback: a 1.2 s success toast and a tick on the button; on failure a toast
with one sentence naming the next action, and the button reads *Print Failed*
until pressed again. No modal, no `alert()`.

## Typography

One family — `Arial, Helvetica, "Liberation Sans", "DejaVu Sans", sans-serif` —
and one scale, in `PRINT_STYLES`:

| Role | Size |
|---|---|
| Company name | 16px bold |
| Department / section headings | 12px bold |
| Order information, product rows, collection working | 11px |
| Column headings, footer, signature captions | 9.5px |
| TOTAL, AMOUNT TO COLLECT | 13px bold |

58mm paper multiplies the scale by 0.86. Nothing in a receipt names a font or a
size outside this table.

## The A4 path

`documentPrint.ts` prints the page itself through `window.print()`. The delivery
challan (two copies per sheet), the reports, the daily-sale sheet and the
production check sheet are documents on sheets and stay here. `globals.css`
declares `@page { size: A4 }` and the `.print-area` / `.no-print` rules; the print
DOM is portalled to `<body>` (`PrintPortal`) and mounted only for the duration of
the print (`useDocumentPrint`).

## Diagnostics

Every print writes a stage trace to the console when `?printDebug=1` is on the
URL (or `localStorage.mb.printDebug = 1`; development builds have it on):
document composed → frame loaded → fitted and verified → `print()` called /
returned → dialog finished, with a 30-second main-thread watchdog. A blank-paper
refusal appears as `print promise rejected {code: 'invalid-document', detail:
'missing: …'}`.

## Mobile

`mobile/src/common/printing/` is the React Native app's own Bluetooth ESC/POS
path and is unaffected by any of this.
