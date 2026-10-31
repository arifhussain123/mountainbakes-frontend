'use client';

import { useMemo } from 'react';
import type { LoanClientWithBalance } from '@mb/shared';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox';
import { useLoanClients } from '@/lib/finance';

/** Search name, company, code and number — the things a person remembers a client by. */
function matches(c: LoanClientWithBalance | null, query: string): boolean {
  if (c == null) return false;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, '');
  return (
    c.clientName.toLowerCase().includes(q) ||
    (c.companyName ?? '').toLowerCase().includes(q) ||
    c.clientCode.toLowerCase().includes(q) ||
    (digits.length >= 3 && (c.mobileNumber ?? '').replace(/\D/g, '').includes(digits))
  );
}

/**
 * The searchable client select, shared by the Loan Ledger's client filter and
 * the three entry forms. A Combobox rather than a Select because the list grows
 * and this has to work on a phone (the same reason SupplierPicker is one).
 *
 * `activeOnly` leaves inactive clients out of an entry form — the API refuses
 * an entry for one — while the ledger filter still offers them, since their
 * history is still worth reading.
 */
export function LoanClientPicker({
  value,
  onChange,
  activeOnly = false,
  invalid,
  id,
  placeholder = 'Search client…',
}: {
  value: string | null;
  onChange: (client: LoanClientWithBalance | null) => void;
  activeOnly?: boolean;
  invalid?: boolean;
  id?: string;
  placeholder?: string;
}) {
  const clientsQ = useLoanClients();
  const items = useMemo(
    () => (clientsQ.data ?? []).filter((c) => !activeOnly || c.isActive || c.id === value),
    [clientsQ.data, activeOnly, value],
  );
  const selected = items.find((c) => c.id === value) ?? null;

  return (
    <Combobox
      items={items}
      filter={matches}
      value={selected}
      onValueChange={(c: LoanClientWithBalance | null) => onChange(c)}
      itemToStringLabel={(c: LoanClientWithBalance) => c.clientName}
      itemToStringValue={(c: LoanClientWithBalance) => c.id}
      isItemEqualToValue={(a: LoanClientWithBalance, b: LoanClientWithBalance) => a?.id === b?.id}
    >
      <ComboboxInput
        id={id}
        aria-label="Client"
        aria-invalid={invalid}
        placeholder={clientsQ.isLoading ? 'Loading clients…' : placeholder}
        className="text-base sm:text-sm"
      />
      <ComboboxContent>
        <ComboboxEmpty>No client found. Add one under Detail of Clients.</ComboboxEmpty>
        <ComboboxList>
          {(c: LoanClientWithBalance) => (
            <ComboboxItem key={c.id} value={c}>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">
                  {c.clientName}
                  {!c.isActive && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(inactive)</span>}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {c.clientCode}
                  {c.companyName ? ` · ${c.companyName}` : ''}
                  {c.mobileNumber ? ` · ${c.mobileNumber}` : ''}
                </span>
              </div>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
