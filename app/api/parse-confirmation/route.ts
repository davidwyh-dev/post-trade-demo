import { NextResponse } from 'next/server';
import {
  parseConfirmationCommand,
  type PdfAttachment,
  type VisibleEventBrief,
} from '@/lib/parser/confirmations-anthropic';
import { toPositionError } from '@/lib/positions/errors';

export const dynamic = 'force-dynamic';

// Per-request cap to keep us inside the model's request size budget. Anthropic
// allows ~32MB total request size; PDFs are usually <2MB but we set a hard
// guard to fail fast with a clear error.
const MAX_PDF_BYTES = 8 * 1024 * 1024; // 8 MB per file
const MAX_TOTAL_PDF_BYTES = 20 * 1024 * 1024; // 20 MB across all files

// Two request shapes:
//   application/json — { text, visibleEventIds: number[], visibleEvents?: VisibleEventBrief[] }
//   multipart/form-data — text, visibleEvents (JSON string), files[] (PDFs)
//
// Three response shapes (mirrored by app/confirmations/_components/ConfirmationsCli.tsx):
//   { ok: true, intent: 'FILTER',    filter,    confidence, summary }
//   { ok: true, intent: 'SELECT',    eventIds,  confidence, summary }
//   { ok: true, intent: 'RECONCILE', matches,   confidence, summary }
//   { ok: false, error: { message } }
export async function POST(req: Request) {
  let text = '';
  let visibleEvents: VisibleEventBrief[] | number[] = [];
  const attachments: PdfAttachment[] = [];

  const contentType = req.headers.get('content-type') ?? '';

  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      text = typeof form.get('text') === 'string' ? (form.get('text') as string).trim() : '';

      const visibleRaw = form.get('visibleEvents');
      if (typeof visibleRaw === 'string' && visibleRaw.length > 0) {
        try {
          const parsed = JSON.parse(visibleRaw);
          if (Array.isArray(parsed)) visibleEvents = parsed as VisibleEventBrief[];
        } catch { /* leave as [] */ }
      } else {
        const idsRaw = form.get('visibleEventIds');
        if (typeof idsRaw === 'string' && idsRaw.length > 0) {
          try {
            const parsed = JSON.parse(idsRaw);
            if (Array.isArray(parsed)) {
              visibleEvents = parsed.filter((n: unknown): n is number =>
                typeof n === 'number' && Number.isFinite(n));
            }
          } catch { /* leave as [] */ }
        }
      }

      let totalBytes = 0;
      for (const entry of form.getAll('files')) {
        if (!(entry instanceof File)) continue;
        if (entry.type && entry.type !== 'application/pdf') {
          return NextResponse.json(
            { ok: false, error: { kind: 'validation', message: `Only PDF attachments are supported (got ${entry.type} for ${entry.name}).` } },
            { status: 400 },
          );
        }
        if (entry.size > MAX_PDF_BYTES) {
          return NextResponse.json(
            { ok: false, error: { kind: 'validation', message: `PDF "${entry.name}" exceeds the 8 MB limit.` } },
            { status: 400 },
          );
        }
        totalBytes += entry.size;
        if (totalBytes > MAX_TOTAL_PDF_BYTES) {
          return NextResponse.json(
            { ok: false, error: { kind: 'validation', message: 'Total attachment size exceeds 20 MB.' } },
            { status: 400 },
          );
        }
        const buf = Buffer.from(await entry.arrayBuffer());
        attachments.push({ filename: entry.name || 'attachment.pdf', base64: buf.toString('base64') });
      }
    } else {
      const body = await req.json().catch(() => ({}));
      text = typeof body?.text === 'string' ? body.text.trim() : '';
      if (Array.isArray(body?.visibleEvents)) {
        visibleEvents = body.visibleEvents as VisibleEventBrief[];
      } else if (Array.isArray(body?.visibleEventIds)) {
        visibleEvents = body.visibleEventIds.filter(
          (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n),
        );
      }
    }
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: { kind: 'validation', message: err instanceof Error ? err.message : 'Bad request' } },
      { status: 400 },
    );
  }

  if (!text && attachments.length === 0) {
    return NextResponse.json(
      { ok: false, error: { kind: 'validation', message: 'Provide text or at least one PDF attachment.' } },
      { status: 400 },
    );
  }

  // Empty text is fine when PDFs are attached — the docs become the input.
  const promptText = text || '(no text — reconcile attached document(s) against visible events)';

  try {
    const parsed = await parseConfirmationCommand(promptText, visibleEvents, attachments);
    if (parsed.tool === 'filter_events') {
      return NextResponse.json({
        ok: true,
        intent: 'FILTER',
        filter: parsed.filter,
        confidence: parsed.confidence,
        summary: parsed.summary,
      });
    }
    if (parsed.tool === 'select_events') {
      return NextResponse.json({
        ok: true,
        intent: 'SELECT',
        eventIds: parsed.eventIds,
        confidence: parsed.confidence,
        summary: parsed.summary,
      });
    }
    return NextResponse.json({
      ok: true,
      intent: 'RECONCILE',
      matches: parsed.matches,
      confidence: parsed.confidence,
      summary: parsed.summary,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: toPositionError(err) },
      { status: 400 },
    );
  }
}
