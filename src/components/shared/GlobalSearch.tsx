'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useDebounce } from '@/hooks/useDebounce';
import { useAuth } from '@/hooks/useAuth';
import { apiCall } from '@/utils/api';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';

interface SearchResult {
  id: string;
  label: string;
  type: string;
  href: string;
  status?: string;
}

interface SearchGroup {
  type: string;
  items: SearchResult[];
}

export function GlobalSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [results, setResults] = useState<SearchGroup[]>([]);
  const [fetchedFor, setFetchedFor] = useState('');
  const { token } = useAuth();
  const router = useRouter();

  const loading = debouncedSearch.length >= 2 && fetchedFor !== debouncedSearch;
  const displayResults = debouncedSearch.length >= 2 && fetchedFor === debouncedSearch ? results : [];

  // Open on Ctrl+K
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!debouncedSearch || debouncedSearch.length < 2 || !token) return;
    apiCall<{ results: SearchGroup[] }>(`/api/search?q=${encodeURIComponent(debouncedSearch)}`, {}, token)
      .then((r) => { setResults(r.results); setFetchedFor(debouncedSearch); })
      .catch(() => { setResults([]); setFetchedFor(debouncedSearch); });
  }, [debouncedSearch, token]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search orders, products, customersâ€¦"
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        {loading && <CommandEmpty>Searchingâ€¦</CommandEmpty>}
        {!loading && debouncedSearch.length >= 2 && displayResults.length === 0 && (
          <CommandEmpty>No results found for &quot;{debouncedSearch}&quot;</CommandEmpty>
        )}
        {!loading && debouncedSearch.length < 2 && (
          <CommandEmpty>Type at least 2 characters to search</CommandEmpty>
        )}
        {displayResults.map((group) => (
          <CommandGroup key={group.type} heading={group.type}>
            {group.items.map((item) => (
              <CommandItem
                key={item.id}
                value={item.label}
                onSelect={() => {
                  router.push(item.href);
                  onOpenChange(false);
                  setSearch('');
                }}
                className="flex items-center justify-between"
              >
                <span className="truncate">{item.label}</span>
                {item.status && (
                  <Badge variant="outline" className="ml-2 text-[10px] capitalize">
                    {item.status}
                  </Badge>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
