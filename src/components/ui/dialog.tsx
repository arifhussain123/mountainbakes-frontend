"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        // 40% rather than 10%: behind a full-width bottom sheet a 10% scrim reads
        // as a rendering glitch rather than as depth.
        "fixed inset-0 isolate z-50 bg-black/40 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

/**
 * A modal at `md` and up; a bottom sheet (or a full-screen page) on a phone.
 *
 * There is deliberately no `useIsMobile()` branch here. `Sheet` and `Dialog` are
 * the same base-ui primitive — they differ only by className — so the phone form
 * is a *style* of this component, not a different one. Expressing it in CSS
 * means no first-render flash, and no remount that would throw away the state of
 * a long form (SaleForm, NewOrderModal) when the device rotates across the
 * breakpoint.
 *
 * `mobile` picks the phone form:
 *  - `'sheet'` (default) — bottom sheet, height driven by content, capped at 90dvh.
 *  - `'fullscreen'` — edge to edge, full height. For the heavy multi-step forms.
 *
 * Width: the `md:max-w-lg` default is deliberately breakpoint-prefixed. Call
 * sites must override with `md:max-w-*` too — an unprefixed `max-w-*` lands in a
 * different tailwind-merge group, so both would survive and the `md:` default
 * would win inside the media query. (That was exactly the bug here before: a
 * trailing `sm:max-w-sm` silently capped every dialog in the app at 24rem.)
 */
function DialogContent({
  className,
  children,
  showCloseButton = true,
  mobile = "sheet",
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
  mobile?: "sheet" | "fullscreen"
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        data-mobile={mobile}
        className={cn(
          "fixed z-50 grid w-full gap-4 overflow-y-auto bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none",
          // Phone form.
          mobile === "sheet"
            ? "inset-x-0 bottom-0 max-h-[90dvh] rounded-t-2xl pb-[calc(1rem+env(safe-area-inset-bottom))]"
            : "inset-x-0 top-0 bottom-0 rounded-none pb-[calc(1rem+env(safe-area-inset-bottom))]",
          // md and up: the centred modal, positioned exactly as it always was.
          "md:top-1/2 md:right-auto md:bottom-auto md:left-1/2 md:h-auto md:max-h-[90dvh] md:max-w-lg md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-xl md:pb-4",
          // Slides up from the bottom on a phone, zooms in place on a desktop.
          "data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-bottom-4 data-closed:animate-out data-closed:fade-out-0 data-closed:slide-out-to-bottom-4",
          "md:data-open:slide-in-from-bottom-0 md:data-open:zoom-in-95 md:data-closed:slide-out-to-bottom-0 md:data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {/* Grab handle — the affordance that says "this sheet drags down". */}
        {mobile === "sheet" && (
          <div
            aria-hidden
            className="mx-auto -mt-1 h-1 w-10 shrink-0 rounded-full bg-border md:hidden"
          />
        )}
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon-sm"
              />
            }
          >
            <XIcon
            />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 flex flex-col-reverse gap-2 border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        // Cancels the popup's own bottom padding so the bar reaches the edge,
        // then re-adds it inside — otherwise the buttons sit under the iOS home
        // indicator on a sheet.
        "-mb-[calc(1rem+env(safe-area-inset-bottom))] pb-[calc(1rem+env(safe-area-inset-bottom))]",
        "md:-mb-4 md:rounded-b-xl md:pb-4",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
