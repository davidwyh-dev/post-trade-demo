// G10 currencies. The macro fund trades only these.
export const G10_CURRENCIES = ['USD','EUR','GBP','JPY','CHF','CAD','AUD','NZD','SEK','NOK'] as const;
export type G10Currency = (typeof G10_CURRENCIES)[number];

// Risk-free rate (RFR) per currency. Used as the floating-leg index default for IRS.
export const RFR_BY_CCY: Record<G10Currency, string> = {
  USD: 'SOFR',
  EUR: 'ESTR',
  GBP: 'SONIA',
  JPY: 'TONA',
  CHF: 'SARON',
  CAD: 'CORRA',
  AUD: 'BBSW',   // BBSW is technically IBOR, kept for desk familiarity
  NZD: 'BKBM',
  SEK: 'SWESTR',
  NOK: 'NOWA',
};

export const FLOATING_INDICES = [
  'SOFR','ESTR','SONIA','TONA','SARON','CORRA','BBSW','BKBM','SWESTR','NOWA',
] as const;
export type FloatingIndex = (typeof FLOATING_INDICES)[number];

export const FX_KINDS = ['SPOT','FORWARD','SWAP'] as const;
export type FxKind = (typeof FX_KINDS)[number];

export const PAY_RECEIVE = ['PAY_FIXED','RECV_FIXED'] as const;
export type PayReceive = (typeof PAY_RECEIVE)[number];

export const SIDES = ['LONG','SHORT'] as const;
export type Side = (typeof SIDES)[number];

// Common futures exchanges traded by macro funds.
export const FUTURES_EXCHANGES = ['CME','CBOT','EUREX','ICE','LIFFE','TFX','SGX','HKEX'] as const;
export type FuturesExchange = (typeof FUTURES_EXCHANGES)[number];
