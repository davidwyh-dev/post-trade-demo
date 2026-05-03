'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useTradeStore } from '@/lib/store/tradeStore';
import type { PositionParams } from '@/lib/positions/params';
import type { ProductType } from '@/lib/db/schema';
import {
  G10_CURRENCIES, FLOATING_INDICES, PAY_RECEIVE, FX_KINDS, SIDES, FUTURES_EXCHANGES, RFR_BY_CCY,
} from '@/lib/constants';
import { cn } from '@/lib/utils';

type Props = { prefill?: Partial<PositionParams> };

const PRODUCT_TABS: { key: ProductType; label: string }[] = [
  { key: 'IRS', label: 'IRS' },
  { key: 'FUTURE', label: 'Future' },
  { key: 'TREASURY', label: 'Treasury' },
  { key: 'FX', label: 'FX' },
];

export function NewPositionForm({ prefill }: Props) {
  const [product, setProduct] = useState<ProductType>(prefill?.product ?? 'IRS');
  return (
    <div className="space-y-4">
      <div className="flex gap-1">
        {PRODUCT_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setProduct(t.key)}
            className={cn(
              'px-3 py-1.5 text-xs rounded border transition-colors',
              product === t.key
                ? 'border-accent bg-accent/15 text-accent'
                : 'border-border-strong hover:bg-panel-elevated',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {product === 'IRS' && <IrsForm prefill={prefill?.product === 'IRS' ? prefill : undefined} />}
      {product === 'FUTURE' && <FutureForm prefill={prefill?.product === 'FUTURE' ? prefill : undefined} />}
      {product === 'TREASURY' && <TreasuryForm prefill={prefill?.product === 'TREASURY' ? prefill : undefined} />}
      {product === 'FX' && <FxForm prefill={prefill?.product === 'FX' ? prefill : undefined} />}
    </div>
  );
}

// ---------- shared ----------
async function submitNewPosition(params: Record<string, unknown>): Promise<number | null> {
  const res = await fetch('/api/positions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ params }),
  });
  const json = await res.json();
  if (!json.ok) {
    toast.error(json.error?.message ?? 'Failed to create position');
    return null;
  }
  if (json.result.matched) {
    toast.info('Matched an existing position with these key parameters.');
  } else {
    toast.success(`Position #${json.result.position.id} created.`);
  }
  return json.result.position.id as number;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  'bg-panel-elevated border border-border rounded px-2 py-1 text-sm font-mono ' +
  'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent';

function FormShell({ onSubmit, children }: { onSubmit: () => void; children: React.ReactNode }) {
  const setDetails = useTradeStore((s) => s.setDetailsMode);
  const setPositions = useTradeStore((s) => s.setPositions);
  const select = useTradeStore((s) => s.selectPosition);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit();
    // Refetch positions after submit so the table reflects the new row.
    const r = await fetch('/api/positions');
    const j = await r.json();
    setPositions(j.positions ?? []);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {children}
      <div className="flex gap-2 pt-2 border-t border-border">
        <button
          type="submit"
          className="px-3 py-1.5 text-xs font-medium rounded bg-accent text-accent-foreground hover:opacity-90 transition-opacity"
        >
          Insert position
        </button>
        <button
          type="button"
          onClick={() => { setDetails({ kind: 'idle' }); select(null); }}
          className="px-3 py-1.5 text-xs font-medium rounded border border-border-strong hover:bg-panel-elevated transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------- IRS ----------
function IrsForm({ prefill }: { prefill?: Partial<Extract<PositionParams, { product: 'IRS' }>> }) {
  const [currency, setCurrency] = useState(prefill?.currency ?? 'USD');
  const [notional, setNotional] = useState(prefill?.notional ?? 100_000_000);
  const [fixedRate, setFixedRate] = useState(prefill?.fixedRate ?? 4.25);
  const [payReceive, setPayReceive] = useState(prefill?.payReceive ?? 'PAY_FIXED');
  const [effectiveDate, setEffectiveDate] = useState(prefill?.effectiveDate ?? today());
  const [maturityDate, setMaturityDate] = useState(prefill?.maturityDate ?? plusYears(today(), 5));
  const [floatingIndex, setFloatingIndex] = useState(prefill?.floatingIndex ?? RFR_BY_CCY[currency]);
  const [counterparty, setCounterparty] = useState(prefill?.counterparty ?? 'JPM');
  const [paymentFreqMonths, setPaymentFreqMonths] = useState(prefill?.paymentFreqMonths ?? 3);

  const setDetails = useTradeStore((s) => s.setDetailsMode);
  const select = useTradeStore((s) => s.selectPosition);
  return (
    <FormShell onSubmit={async () => {
      const id = await submitNewPosition({
        product: 'IRS', currency, notional: Number(notional), fixedRate: Number(fixedRate),
        payReceive, effectiveDate, maturityDate, floatingIndex, counterparty,
        paymentFreqMonths: Number(paymentFreqMonths),
      });
      if (id) { select(id); setDetails({ kind: 'view', positionId: id }); }
    }}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Currency *">
          <select value={currency} onChange={(e) => { setCurrency(e.target.value as typeof currency); setFloatingIndex(RFR_BY_CCY[e.target.value as typeof currency]); }} className={inputCls}>
            {G10_CURRENCIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Notional">
          <input type="number" value={notional} onChange={(e) => setNotional(Number(e.target.value))} className={inputCls} />
        </Field>
        <Field label="Fixed rate (%) *">
          <input type="number" step="0.0001" value={fixedRate} onChange={(e) => setFixedRate(Number(e.target.value))} className={inputCls} />
        </Field>
        <Field label="Pay/Receive *">
          <select value={payReceive} onChange={(e) => setPayReceive(e.target.value as typeof payReceive)} className={inputCls}>
            {PAY_RECEIVE.map((d) => <option key={d}>{d}</option>)}
          </select>
        </Field>
        <Field label="Effective *">
          <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Maturity *">
          <input type="date" value={maturityDate} onChange={(e) => setMaturityDate(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Floating index *">
          <select value={floatingIndex} onChange={(e) => setFloatingIndex(e.target.value as typeof floatingIndex)} className={inputCls}>
            {FLOATING_INDICES.map((i) => <option key={i}>{i}</option>)}
          </select>
        </Field>
        <Field label="Counterparty *">
          <input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Payment freq (months) *">
          <input type="number" value={paymentFreqMonths} onChange={(e) => setPaymentFreqMonths(Number(e.target.value))} className={inputCls} />
        </Field>
      </div>
      <p className="text-[10px] text-muted-foreground">* fields are part of the position key (identity).</p>
    </FormShell>
  );
}

// ---------- FUTURE ----------
function FutureForm({ prefill }: { prefill?: Partial<Extract<PositionParams, { product: 'FUTURE' }>> }) {
  const [contractCode, setContractCode] = useState(prefill?.contractCode ?? '');
  const [exchange, setExchange] = useState(prefill?.exchange ?? 'CME');
  const [account, setAccount] = useState(prefill?.account ?? 'MAIN');
  const [initialContracts, setInitialContracts] = useState(prefill?.initialContracts ?? 100);
  const [expiryDate, setExpiryDate] = useState(prefill?.expiryDate ?? plusYears(today(), 1));
  const [multiplier, setMultiplier] = useState(prefill?.multiplier ?? 1000);
  const [tickSize, setTickSize] = useState(prefill?.tickSize ?? 0.01);
  const [description, setDescription] = useState(prefill?.description ?? '');
  const setDetails = useTradeStore((s) => s.setDetailsMode);
  const select = useTradeStore((s) => s.selectPosition);
  return (
    <FormShell onSubmit={async () => {
      const id = await submitNewPosition({
        product: 'FUTURE', contractCode, exchange, account,
        initialContracts: Number(initialContracts), expiryDate,
        multiplier: Number(multiplier), tickSize: Number(tickSize), description,
      });
      if (id) { select(id); setDetails({ kind: 'view', positionId: id }); }
    }}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Contract code *"><input value={contractCode} onChange={(e) => setContractCode(e.target.value)} className={inputCls} placeholder="FVH6" /></Field>
        <Field label="Exchange *">
          <select value={exchange} onChange={(e) => setExchange(e.target.value as typeof exchange)} className={inputCls}>
            {FUTURES_EXCHANGES.map((x) => <option key={x}>{x}</option>)}
          </select>
        </Field>
        <Field label="Account *"><input value={account} onChange={(e) => setAccount(e.target.value)} className={inputCls} /></Field>
        <Field label="Initial contracts (signed)"><input type="number" value={initialContracts} onChange={(e) => setInitialContracts(Number(e.target.value))} className={inputCls} /></Field>
        <Field label="Expiry"><input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className={inputCls} /></Field>
        <Field label="Multiplier"><input type="number" value={multiplier} onChange={(e) => setMultiplier(Number(e.target.value))} className={inputCls} /></Field>
        <Field label="Tick size"><input type="number" step="0.0001" value={tickSize} onChange={(e) => setTickSize(Number(e.target.value))} className={inputCls} /></Field>
        <Field label="Description"><input value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} /></Field>
      </div>
      <p className="text-[10px] text-muted-foreground">* fields are part of the position key.</p>
    </FormShell>
  );
}

// ---------- TREASURY ----------
function TreasuryForm({ prefill }: { prefill?: Partial<Extract<PositionParams, { product: 'TREASURY' }>> }) {
  const [isin, setIsin] = useState(prefill?.isin ?? '');
  const [issuer, setIssuer] = useState(prefill?.issuer ?? 'US Treasury');
  const [currency, setCurrency] = useState(prefill?.currency ?? 'USD');
  const [coupon, setCoupon] = useState(prefill?.coupon ?? 4.0);
  const [maturityDate, setMaturityDate] = useState(prefill?.maturityDate ?? plusYears(today(), 10));
  const [side, setSide] = useState(prefill?.side ?? 'LONG');
  const [account, setAccount] = useState(prefill?.account ?? 'MAIN');
  const [initialFaceAmount, setInitialFaceAmount] = useState(prefill?.initialFaceAmount ?? 10_000_000);
  const setDetails = useTradeStore((s) => s.setDetailsMode);
  const select = useTradeStore((s) => s.selectPosition);
  return (
    <FormShell onSubmit={async () => {
      const id = await submitNewPosition({
        product: 'TREASURY', isin, issuer, currency, coupon: Number(coupon),
        maturityDate, side, account, initialFaceAmount: Number(initialFaceAmount),
      });
      if (id) { select(id); setDetails({ kind: 'view', positionId: id }); }
    }}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="ISIN *"><input value={isin} onChange={(e) => setIsin(e.target.value.toUpperCase())} className={inputCls} placeholder="US912828YY08" /></Field>
        <Field label="Issuer"><input value={issuer} onChange={(e) => setIssuer(e.target.value)} className={inputCls} /></Field>
        <Field label="Currency">
          <select value={currency} onChange={(e) => setCurrency(e.target.value as typeof currency)} className={inputCls}>
            {G10_CURRENCIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Coupon (%)"><input type="number" step="0.001" value={coupon} onChange={(e) => setCoupon(Number(e.target.value))} className={inputCls} /></Field>
        <Field label="Maturity"><input type="date" value={maturityDate} onChange={(e) => setMaturityDate(e.target.value)} className={inputCls} /></Field>
        <Field label="Side *">
          <select value={side} onChange={(e) => setSide(e.target.value as typeof side)} className={inputCls}>
            {SIDES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Account *"><input value={account} onChange={(e) => setAccount(e.target.value)} className={inputCls} /></Field>
        <Field label="Face amount"><input type="number" value={initialFaceAmount} onChange={(e) => setInitialFaceAmount(Number(e.target.value))} className={inputCls} /></Field>
      </div>
      <p className="text-[10px] text-muted-foreground">* fields are part of the position key.</p>
    </FormShell>
  );
}

// ---------- FX ----------
function FxForm({ prefill }: { prefill?: Partial<Extract<PositionParams, { product: 'FX' }>> }) {
  const [pair, setPair] = useState(prefill?.pair ?? 'EUR/USD');
  const [base, quote] = pair.split('/');
  const [kind, setKind] = useState(prefill?.kind ?? 'SPOT');
  const [valueDate, setValueDate] = useState(prefill?.valueDate ?? plusDays(today(), 2));
  const [notionalBase, setNotionalBase] = useState(prefill?.notionalBase ?? 25_000_000);
  const [rate, setRate] = useState(prefill?.rate ?? 1.0875);
  const [counterparty, setCounterparty] = useState(prefill?.counterparty ?? 'GS');
  const [farValueDate, setFarValueDate] = useState(prefill?.farValueDate ?? '');
  const [farRate, setFarRate] = useState(prefill?.farRate ?? 0);
  const setDetails = useTradeStore((s) => s.setDetailsMode);
  const select = useTradeStore((s) => s.selectPosition);
  return (
    <FormShell onSubmit={async () => {
      const id = await submitNewPosition({
        product: 'FX', pair, baseCurrency: base, quoteCurrency: quote,
        kind, valueDate, notionalBase: Number(notionalBase), rate: Number(rate),
        counterparty,
        ...(kind === 'SWAP' ? { farValueDate, farRate: Number(farRate) } : {}),
      });
      if (id) { select(id); setDetails({ kind: 'view', positionId: id }); }
    }}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Pair *"><input value={pair} onChange={(e) => setPair(e.target.value.toUpperCase())} className={inputCls} placeholder="EUR/USD" /></Field>
        <Field label="Kind *">
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={inputCls}>
            {FX_KINDS.map((k) => <option key={k}>{k}</option>)}
          </select>
        </Field>
        <Field label="Value date *"><input type="date" value={valueDate} onChange={(e) => setValueDate(e.target.value)} className={inputCls} /></Field>
        <Field label="Counterparty *"><input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} className={inputCls} /></Field>
        <Field label={`Notional (${base})`}><input type="number" value={notionalBase} onChange={(e) => setNotionalBase(Number(e.target.value))} className={inputCls} /></Field>
        <Field label="Rate"><input type="number" step="0.0001" value={rate} onChange={(e) => setRate(Number(e.target.value))} className={inputCls} /></Field>
        {kind === 'SWAP' && (
          <>
            <Field label="Far value date"><input type="date" value={farValueDate} onChange={(e) => setFarValueDate(e.target.value)} className={inputCls} /></Field>
            <Field label="Far rate"><input type="number" step="0.0001" value={farRate} onChange={(e) => setFarRate(Number(e.target.value))} className={inputCls} /></Field>
          </>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground">* fields are part of the position key.</p>
    </FormShell>
  );
}

// ---------- helpers ----------
function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function plusYears(date: string, years: number): string {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}
function plusDays(date: string, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
