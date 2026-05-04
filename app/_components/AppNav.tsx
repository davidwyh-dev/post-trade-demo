'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const ITEMS = [
  { href: '/trade',         label: 'Trade'         },
  { href: '/confirmations', label: 'Confirmations' },
];

export function AppNav() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1 px-4 py-2 border-b border-border bg-panel">
      <span className="font-mono text-xs text-muted-foreground mr-3 select-none">post-trade BoR</span>
      {ITEMS.map((it) => {
        const active = pathname === it.href || pathname.startsWith(it.href + '/');
        return (
          <Link
            key={it.href}
            href={it.href}
            className={cn(
              'px-3 py-1 text-xs font-medium rounded-md border transition-colors',
              active
                ? 'bg-accent/15 border-accent/40 text-foreground'
                : 'border-transparent text-muted-foreground hover:bg-panel-elevated hover:text-foreground',
            )}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
