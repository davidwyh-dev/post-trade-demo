'use client';

import { useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { useConfirmationsStore } from '@/lib/store/confirmationsStore';
import { AppNav } from '@/app/_components/AppNav';
import { EventTable } from './EventTable';
import { EventDetailsPanel } from './EventDetailsPanel';
import { EventsSummary } from './EventsSummary';
import { ConfirmationsCli } from './ConfirmationsCli';

export function ConfirmationsWorkspace() {
  const fromDate = useConfirmationsStore((s) => s.filter.fromDate);
  const toDate   = useConfirmationsStore((s) => s.filter.toDate);
  const setEvents = useConfirmationsStore((s) => s.setEvents);
  const setLoading = useConfirmationsStore((s) => s.setLoading);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/events?from=${fromDate}&to=${toDate}`);
      // A bare 500 with no body would .json()-throw; surface that as a
      // clearer message than "Unexpected end of JSON input".
      const text = await res.text();
      if (!text) {
        toast.error(`Server returned empty ${res.status} response. Check server logs and DB migrations.`);
        return;
      }
      const j = JSON.parse(text);
      if (!j.ok) {
        toast.error(j.error?.message ?? 'Failed to load events');
        return;
      }
      setEvents(j.events ?? [], j.allEventsByPosition ?? {});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, setEvents, setLoading]);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <div
      className="grid h-screen w-screen text-foreground"
      style={{
        gridTemplateRows: 'auto minmax(0, 1.1fr) minmax(0, 0.9fr) auto',
        gridTemplateColumns: '1fr',
      }}
    >
      <AppNav />

      {/* Top: Event Table | Event Details */}
      <section
        className="grid min-h-0 overflow-hidden border-b border-border"
        style={{ gridTemplateColumns: '1.1fr 1fr' }}
      >
        <div className="border-r border-border min-h-0 overflow-hidden">
          <EventTable onReload={reload} />
        </div>
        <div className="min-h-0 overflow-y-auto">
          <EventDetailsPanel onReload={reload} />
        </div>
      </section>

      {/* Middle: Events Summary */}
      <section className="border-b border-border min-h-0 overflow-y-auto">
        <EventsSummary onReload={reload} />
      </section>

      {/* Bottom: Confirmations CLI */}
      <section>
        <ConfirmationsCli />
      </section>
    </div>
  );
}
