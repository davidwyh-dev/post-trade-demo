-- G-SIB counterparties used by the macro fund. Aliases let the trade-CLI
-- parser map shorthand ("JPM", "JPMorgan") onto the canonical code.

INSERT INTO counterparties (code, name, aliases) VALUES
  ('JPM',  'JPMorgan Chase Bank, N.A.',          ARRAY['jpmorgan','jpm','jpmc']),
  ('GS',   'Goldman Sachs Bank USA',             ARRAY['goldman','gs','gsi']),
  ('MS',   'Morgan Stanley & Co. LLC',           ARRAY['morgan stanley','ms','msi']),
  ('BAML', 'Bank of America, N.A.',              ARRAY['bofa','baml','boa','bank of america']),
  ('CITI', 'Citibank, N.A.',                     ARRAY['citi','citibank','citigroup']),
  ('BARC', 'Barclays Bank PLC',                  ARRAY['barclays','barc']),
  ('DB',   'Deutsche Bank AG',                   ARRAY['deutsche','db','deutsche bank']),
  ('UBS',  'UBS AG',                             ARRAY['ubs']),
  ('HSBC', 'HSBC Bank plc',                      ARRAY['hsbc']),
  ('BNP',  'BNP Paribas',                        ARRAY['bnp','bnp paribas','paribas']),
  ('SG',   'Societe Generale',                   ARRAY['socgen','sg','societe generale'])
ON CONFLICT (code) DO NOTHING;
