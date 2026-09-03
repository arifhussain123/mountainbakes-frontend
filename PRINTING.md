# Printing

Two paths, deliberately separate, and neither falls back to the other on its own.

```
POS receipts                                    A4 documents
────────────                                    ────────────
PosPrintButton                                  PrintButton
      ↓                                               ↓
lib/print/pos/printerService                    lib/print/browser/documentPrint
      ↓  one PrintJob: bytes + blocks                 ↓  window.print()
lib/print/pos/transport                         browser print dialog
      ↓                     ↓                         ↓
 WebUSB / Serial / TCP    system driver          sheet printer / Save as PDF
      ↓                     ↓
 80mm thermal printer   whatever Windows has installed
```

Note the fourth transport. The three on the left open the device and write ESC/POS
to it. `system` cannot open anything — it hands the receipt to the printer the
operating system already has, which is the only route to a unit whose driver owns
it. It is still not `documentPrint`: a receipt printed that way is composed by the
same formatter, wrapped to the same columns, and rendered in an iframe with its
own `@page`; the A4 path is untouched and neither falls back to the other.

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
| `discovery.ts` | Finding it without being asked. Enumerates the devices this origin was granted, adopts one when the branch has none, and states in the type system what a browser cannot know about the OS default. |
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
| **Installed Printer** | `window.print()` in an iframe | Everywhere there is a print dialog | Nowhere — this is the fallback that always exists |
| **USB Serial POS Printer** | Web Serial | Chrome / Edge / Opera, desktop only, over https | Firefox, Safari, Android, iOS |
| **Network / LAN** | Direct Sockets (`TCPSocket`) | An installed Isolated Web App | An ordinary web page — see below |

Each transport answers `support()` **before** anything is offered, so a till that
cannot do this is told at setup time, on a quiet morning, rather than by a failed
print in front of a customer. Unsupported options appear in the dialog greyed,
with the reason, rather than disappearing.

Two limits worth knowing before someone files a bug:

- **Windows will not share a USB printer.** If the unit is installed through
  *Printers & scanners*, `usbprint.sys` owns the interface and `claimInterface`
  fails. That is reported as `device-busy`, and it is an OS rule, not something
  this code can work around. There are now two fixes rather than one: remove it
  from Windows printers / bind WinUSB (Zadig) and print directly, **or** choose
  *Installed Printer* and print through the driver that owns it. The first is
  faster and silent; the second needs no change to the machine.
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
else. It never fakes a send and never *silently* falls back to anything. What its
message now does is name the setting that will work tonight: most LAN units are
also installed on the till, and *Installed Printer* prints through that driver,
which does the networking itself. The other honest alternatives, for whoever asks:
point USB at the same printer, or use a printer's own "server print" polling mode,
which is an API change rather than a browser one.

### The installed printer — `transport/system.ts`

The transport for the printer that is already set up on the machine, and the
answer to the most common report there is: *"the POS-80 is installed, it prints
its own test page, and Mountain Bakes does not detect it."* It does not detect it
because Windows owns it; this prints through Windows instead.

It is chosen in Printer Setup under **Connection → Installed Printer**, and
detection offers it on its own when nothing authorised for direct printing can
print right now — never alongside a device this app has open (see the priority
chain below). Three things are given up, and all three
are on screen before anyone commits:

1. **A dialog opens.** Unless the browser was started with `--kiosk-printing`
   (`chrome.exe --kiosk-printing --app=<the app>`), which sends `window.print()`
   straight to the default printer with no preview. That is a shortcut on a
   dedicated till, set once by whoever set the till up — this app cannot turn it
   on and does not pretend to have.
2. **There is no confirmation.** `afterprint` fires identically for *printed* and
   *cancelled* and no browser exposes the difference, so the transport reports
   *handed to the printer* and the log says exactly that. It never claims paper
   moved.
3. **The printer cannot be named.** Whichever one the OS picks is the one that
   prints. `isSystemDefault` is therefore still `null`: sending to the system
   printer and reading which it is are separate powers, and only the first exists.

The receipt itself is not re-laid-out. The page is built from
`previewStyled(blocks, columns)` — the same lines, wrapped by the same code,
padded by the same column maths as the ESC/POS path, and carrying the same
emphasis — set in Courier New at a size derived from the profile's
`printableWidthMm / charactersPerLine`, so a till that switches between this and
USB gets the same receipt character for character. The test page's ruler proves
the width on real paper exactly as it does for a device, and *Characters per
line* corrects it the same way.

Each line is its own element rather than one run of text in a `<pre>`, because a
flattened page printed the company name and the grand total looking exactly like
a line item — the one figure a reader looks for had no emphasis on the one
document they read. `previewStyled` keeps each line's style; `.h2` reproduces
`GS !` double height, `.w2` double width.

#### Why the driver page is set in bold

Because that is the fix for faint output, and it is a rasterisation problem
rather than a printer one. The driver is handed a greyscale bitmap and has one
ink: Courier New's stems at receipt size land as mid-grey, and thresholding those
drops roughly half the dots in every glyph — the *"very faint, some characters
unreadable"* receipt. Bold stems survive the threshold. It is safe for the column
maths only because Courier New Bold is metrically identical to the regular face
(the same 0.6em advance), which is also why the weight, the ligature setting and
`text-rendering` all sit on the selector shared with `#mb-probe`: that probe is
the ruler `fitDocument()` scales the receipt against, and a ruler rendered in a
different mode from the thing it measures gives a wrong answer confidently.

Nothing on the ESC/POS path needs any of this — there the printer sets the glyph
itself, at full density.

#### Blank paper, and the leading

Three separate things made these receipts longer than the receipt:

- `@page { margin: 0 }`, and `fitDocument()` measuring the rendered height and
  writing it into a second `@page` rule — both already in place, and the reason
  the last `<style>` in the head must stay last (two rules setting `size` are
  resolved by document order).
- `line-height`, which was `1.15`. It is `1` now, matching what the bytes path
  does — 24 dots of leading for a 24-dot glyph. On a 40-line demand the old value
  was several centimetres of roll for nothing.
- `.receipt`'s `padding: 2mm 0`, now `0`. The head already cannot print in the
  first millimetre of paper; a deliberate margin on top of that is paper spent
  twice.

#### The page box is the print area, not the paper

`@page { size }` names **`printableWidthMm`** (72mm on an 80mm roll), and `.receipt`
fills it at `margin: 0`. Both `@page` rules say so — the placeholder in the head and
the one `fitDocument()` writes over it — because the second wins on document order,
so a paper width left in either one is a paper width on every receipt.

It was `paperWidthMm` (80mm), with `.receipt` centred inside by `margin: 0 auto`:
the document drawing the head's unprintable margin itself, as an equal gutter either
side. That is what put **the company name off centre in the print preview**. The
margin is real, but it belongs to the driver, and on a POS-80 it is not symmetric —
the head is commonly flush to one edge with the whole 8mm of slack at the other.
Handed an 80mm page, the driver lays our 4mm of blank down its own left margin and
clips 4mm off the right of the receipt. The whole strip moves sideways; it shows up
first and worst on the one line with white space around it to move within.

A page exactly the print area cannot be placed wrong — it lands on the printable
rectangle whichever paper edge that rectangle starts at, so the receipt begins where
the head begins. That is the origin the ESC/POS path prints from, which is what makes
a till that switches between the two get the same receipt in the same place.

#### The browser's own header and footer

The URL, page number and date Chrome can draw on a printed page are drawn **in
the page margin**, and `@page { margin: 0 }` is the whole of what a document can
do about them — with no margin there is no band to draw them in. If they still
appear, the dialog's **Headers and footers** checkbox is on. That is a browser
setting, remembered per user, and no page can read or change it: turning it off
once, or running the till with `--kiosk-printing`, is the fix. This app cannot do
it and does not claim to.

It prints from a **detached iframe with its own document**, which is why this is
not the banned bare `window.print()`: `globals.css` and its global
`@page { size: A4 }` do not reach that document at all, so there is no rule to
inject and no rule to remember to remove, and the screen is neither rebuilt nor
hidden while the dialog is open. Copies are pages of one document rather than
repeats of the job — repeating it would open one dialog per copy.

### Automatic detection, and the printer this app cannot see

`src/lib/print/pos/discovery.ts`

A till does not choose its printer every morning, and after this it does not
choose one on a fresh branch login either. On load, `usePosPrinter` runs
`detectPrinters()` alongside its reconnect: every device this origin already holds
a grant for is enumerated, each is checked against what is attached, and — **only
when the branch has no printer configured** — the best one is adopted and written
to the config. Nothing prompts, nothing appears on screen, and no gesture is
needed, because `getDevices()` / `getPorts()` answer from the browser's own
permission store.

That is what makes the grant, rather than the config, the thing that persists. A
printer authorised once in the life of the machine is found for every account that
signs into it afterwards.

**It is not the operating system's printer list, and it cannot become one.**
*Sending* to the machine's printer and *reading* which one that is are separate
powers; `transport/system.ts` takes the first and everything in this paragraph is
still true of the second. There is no `navigator.getDefaultPrinter()`, no
`listSystemPrinters()`, and nothing in any shipping or proposed standard that
reports which printer Windows calls default. The only browser API that touches the OS print stack is `window.print()`,
which *shows a dialog* rather than telling the page anything. So `DetectedPrinter`
carries `isSystemDefault`, typed `null` — not `boolean | null`, not optional —
because a field that can only hold one value cannot later be quietly upgraded to a
guess, and the type is what enforces that. `SYSTEM_DEFAULT_NOTICE` is the sentence
shown on screen in its place.

Worth stating plainly, because it is the thing people ask for: **on Windows, "the
system default printer" and "printed to silently by the page" are mutually
exclusive.** Install the unit through *Printers & scanners*
and `usbprint.sys` owns its interface, so `claimInterface` fails with `device-busy`
— the printer the OS calls default is precisely the one this app cannot open, and
the only route left to it is the browser print dialog. Bind it to WinUSB instead
and this app writes to it directly with no dialog and no driver, but it is then not
an installed printer and nothing anywhere reports it as default. A till picks one
or the other; this app is built for the second. Closing that gap needs a native
wrapper (Electron's `getPrintersAsync()` returns `isDefault` and
`webContents.print({ silent: true, deviceName })` prints without a preview), which
is a desktop build and a distribution story rather than a change in this folder.

The priority chain in `discovery.ts` is:

1. **The branch's configured printer** — a decision, never overruled by detection,
   and kept even when it is offline. Silently switching a till to the spare is how
   a receipt ends up on a roll in another room.
2. **An authorised device on this machine** — the automatic case. Attached beats
   remembered; two attached printers are adopted by first, with `ambiguous` set so
   Printer Settings says which was chosen rather than leaving it a mystery.
3. **The printer installed on this computer** — appended by `detectPrinters` only
   when rung 2 found nothing that can print *right now*, then adopted by the same
   code that adopts anything else. Reported as `system-fallback` rather than
   `auto-detected`, so Printer Settings says why a dialog is about to appear. It is
   deliberately never offered alongside a working device this app can open: that
   would present a good route and a worse one as peers.

   The test is `available`, not "the list is empty", and the difference is a till
   that was locked out of printing entirely. A grant for a printer since unplugged
   still enumerates from the browser's permission store, so the old test saw a
   non-empty list, withheld this rung, and let rung 2 adopt the **dead** device
   into the config — where rung 1 then protected it for good. A printer Windows is
   holding (`device-busy`, reported `error`) is the same shape, and it is the exact
   case this route exists to answer.
4. **The chooser** — only when the three above found nothing, and only from a click.

`PrinterAvailability` is the counter's vocabulary — `ready`, `printing`, `offline`,
`unavailable`, `error` — and is deliberately not `LinkState`. The two differ where
it matters most: a device held by the Windows driver is `disconnected` to the
transport and `error` here, because a cable is not the fix. `printing` is layered
on from `activePrintCount()`, since no device API reports "busy" — a bulk endpoint
takes bytes or it does not.

### Printer setup

*POS Printer Setup* opens from the `● POS Printer …` indicator on the Sales page
and in the production order dialog, and from the failure panel when a print fails.

The form is a **draft** until Save: Connect and Test Print run against what is on
screen, so a printer can be tried before the till commits to it, and closing
without saving leaves the previous printer untouched. Save marks it the default
printer for this device and this branch — after which nothing asks again.

`Refresh Printers` re-runs detection: it re-reads the permission store, re-checks
each device, and adopts one if this branch still has none. It prompts for nothing
— that is the whole difference between it and Connect — so it is the button for a
printer switched on after the page loaded. The *Detected Printers* list appears
only when there is more than one, and picking from it edits the draft like any
other field.

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
   double-click. On the installed-printer route "in flight" lasts until the dialog
   closes, which is why `send` there waits for `afterprint` rather than returning
   as soon as `print()` is called.
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

### What the production slip carries

The demand's lines and grand total, then the previous delivery's collection and
two signature lines. The last two are on the A4 challan as well, deliberately:
the roll is what physically travels with the delivery, and a collection the rider
cannot read at the counter is one that gets argued about later.

The collection block is **not** a "previous balance" and must not be labelled as
one. The carry-forward balance was removed server-side (migration 74) and
Production no longer sees a Prev. Balance / Total Demand pair at all. What this
prints is money owed for the *last delivery* — company share, less returns, less
claims, giving `TO COLLECT` — which is the opposite direction from
`production_balances` (goods owed **to** the branch). Every figure is
server-computed, because `company_share_pct` lives in `finance_settings` and
production users cannot read it, and every figure is printed exactly as supplied.
A slip that recomputed the collection would be the one document in the building
disagreeing with the ledger.

`PreviousCollection` distinguishes three states and they print differently:
supplied (the working), `null` (*"No previous delivery - nothing to collect."*),
and omitted entirely — which is what a caller passes while the query is still in
flight, so an early print leaves the block off rather than printing a collection
of zero against a delivery that has one. Zeros and "nothing owed" read the same as
numbers and mean different things.

Deduction lines are printed only when non-zero, so the one delivery that did have
a claim against it is findable in a stack.

### Line spacing on the bytes path

`renderBlocks` sends `ESC 3 24` after the reset — one character cell of leading
for the 12×24 Font A glyph, the standard receipt figure. The printer's own default
is 30–34 dots depending on the unit, which is set for prose and is visibly loose
on a receipt.

It is sent at the head of the document rather than from `init()`, because `init()`
is *also* the trailing reset and the whole point of that one is to hand the
printer back in its default state — including to a job sent by a different
application. Tightening the leading is this document's business, not the next
one's.

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
