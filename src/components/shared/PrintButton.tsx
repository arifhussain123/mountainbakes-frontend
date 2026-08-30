'use client';

import type { ComponentProps } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Printer, Download, ChevronDown } from 'lucide-react';
import {
  usePrintCapability,
  usePaperCapability,
  type PrintPreference,
  type PaperPreference,
} from '@/hooks/usePrintCapability';
import { cn } from '@/lib/utils';

const OPTIONS: { value: PrintPreference; label: string; hint: string }[] = [
  { value: 'auto', label: 'Detect automatically', hint: 'Guess from the device' },
  { value: 'print', label: 'This device has a printer', hint: 'Always offer Print' },
  { value: 'save', label: 'No printer on this device', hint: 'Always offer Save as PDF' },
];

const PAPER_OPTIONS: { value: PaperPreference; label: string; hint: string }[] = [
  { value: 'auto', label: 'Detect automatically', hint: 'Falls back to A4' },
  { value: 'a4', label: 'A4 sheet printer', hint: 'Full-page delivery challan' },
  { value: 'pos', label: 'POS receipt printer', hint: '80mm thermal roll' },
];

export interface PrintButtonProps {
  /** What the action does. Defaults to opening the browser print dialog. */
  onPrint?: () => void;
  /** Label when a printer is available. */
  printLabel?: string;
  /** Label when none is — the same action, saving instead of printing. */
  saveLabel?: string;
  /** Drop the "which device is this?" menu when there is no room for it. */
  showMenu?: boolean;
  /**
   * Offer the A4 / POS-roll choice as well.
   *
   * Off by default and it must stay that way: the setting is per *device*, not
   * per screen, so exposing it somewhere that has no receipt layout would let
   * someone pin a shared till to POS and quietly reformat the page box of every
   * report printed from it afterwards. Turn it on only where a POS layout
   * actually exists to render.
   */
  showPaper?: boolean;
  disabled?: boolean;
  variant?: ComponentProps<typeof Button>['variant'];
  size?: ComponentProps<typeof Button>['size'];
  /** Applied to the wrapper, so `w-full` / margins land where you expect. */
  className?: string;
  /**
   * Applied to the main button. Height belongs here, not on `className` — the
   * wrapper takes its height from this button and the menu trigger stretches to
   * match, so `h-9` on the wrapper would leave a short button inside a tall box.
   */
  buttonClassName?: string;
}

/**
 * Print action that names itself after the device: **Print** where a printer is
 * set up, **Save as PDF** where none is.
 *
 * Both do the same thing — `window.print()`, or `onPrint` — because that single
 * dialog is both the printer picker and the PDF writer, and on a machine with no
 * printer installed "Save as PDF" is the only destination it can offer. Only the
 * promise made to the user changes.
 *
 * The device is *guessed*, never known — see `usePrintCapability`. The attached
 * menu is not a nicety: it is how a wrong guess gets corrected, and the choice
 * sticks per device (localStorage), so hide it only where another instance on the
 * same screen already exposes it.
 */
export function PrintButton({
  onPrint,
  printLabel = 'Print',
  saveLabel = 'Save as PDF',
  showMenu = true,
  showPaper = false,
  disabled,
  variant = 'default',
  size = 'default',
  className,
  buttonClassName,
}: PrintButtonProps) {
  const { mode, preference, setPreference } = usePrintCapability();
  const { paperPreference, setPaperPreference } = usePaperCapability();
  const save = mode === 'save';

  function run() {
    if (onPrint) onPrint();
    else window.print();
  }

  return (
    <div className={cn('no-print inline-flex items-stretch', className)}>
      <Button
        variant={variant}
        size={size}
        disabled={disabled}
        onClick={run}
        className={cn('flex-1', showMenu && 'rounded-r-none', buttonClassName)}
        title={save ? 'Save this document as a PDF' : 'Send this document to a printer'}
      >
        {save ? <Download className="mr-1.5 h-4 w-4" /> : <Printer className="mr-1.5 h-4 w-4" />}
        {save ? saveLabel : printLabel}
      </Button>

      {showMenu && (
        <DropdownMenu>
          {/* Styled from buttonVariants rather than by hand so it tracks the main
              button through theme changes; only the seam and padding differ. */}
          <DropdownMenuTrigger
            disabled={disabled}
            aria-label="Printer availability"
            title="Printer availability"
            className={cn(
              buttonVariants({ variant, size }),
              'rounded-l-none border-l-black/10 px-1.5 dark:border-l-white/15',
              buttonClassName,
            )}
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>Printer on this device</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              value={preference}
              onValueChange={(v) => setPreference(v as PrintPreference)}
            >
              {OPTIONS.map((o) => (
                <DropdownMenuRadioItem key={o.value} value={o.value} className="py-1.5">
                  <span className="flex flex-col">
                    <span>{o.label}</span>
                    <span className="text-xs text-muted-foreground">{o.hint}</span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>

            {showPaper && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Paper on this device</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuRadioGroup
                  value={paperPreference}
                  onValueChange={(v) => setPaperPreference(v as PaperPreference)}
                >
                  {PAPER_OPTIONS.map((o) => (
                    <DropdownMenuRadioItem key={o.value} value={o.value} className="py-1.5">
                      <span className="flex flex-col">
                        <span>{o.label}</span>
                        <span className="text-xs text-muted-foreground">{o.hint}</span>
                      </span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
