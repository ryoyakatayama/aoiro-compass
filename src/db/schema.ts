export const SCHEMA_VERSION = 1;
export const migration1 = `
CREATE TABLE fiscal_years(year INTEGER PRIMARY KEY, status TEXT NOT NULL CHECK(status IN ('active','closed','historical_import')), data_completeness TEXT NOT NULL DEFAULT 'full', locked_at TEXT);
CREATE TABLE accounts(id TEXT PRIMARY KEY,code TEXT UNIQUE NOT NULL,name TEXT NOT NULL,type TEXT NOT NULL CHECK(type IN ('asset','liability','equity','revenue','expense')),is_active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE transactions(id TEXT PRIMARY KEY,year INTEGER NOT NULL REFERENCES fiscal_years(year),transaction_date TEXT NOT NULL,description TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('draft','confirmed','locked')),source TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'normal',updated_at TEXT NOT NULL);
CREATE INDEX transactions_year_date ON transactions(year,transaction_date);
CREATE TABLE journal_lines(id TEXT PRIMARY KEY,transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,account_id TEXT NOT NULL REFERENCES accounts(id),debit_amount INTEGER NOT NULL CHECK(debit_amount>=0),credit_amount INTEGER NOT NULL CHECK(credit_amount>=0),tax_category TEXT NOT NULL,memo TEXT NOT NULL,sort_order INTEGER NOT NULL,CHECK(debit_amount=0 OR credit_amount=0));
CREATE INDEX journal_lines_transaction ON journal_lines(transaction_id);
CREATE INDEX journal_lines_account ON journal_lines(account_id);
CREATE TABLE evidences(id TEXT PRIMARY KEY,year INTEGER NOT NULL REFERENCES fiscal_years(year),drive_file_id TEXT UNIQUE,filename TEXT NOT NULL,mime_type TEXT NOT NULL,size_bytes INTEGER NOT NULL,sha256 TEXT NOT NULL,original_sha256 TEXT NOT NULL,modified_time TEXT,status TEXT NOT NULL,capture_source TEXT NOT NULL,hint TEXT NOT NULL DEFAULT '',payment_account TEXT NOT NULL DEFAULT '3100',note TEXT NOT NULL DEFAULT '',indexed_at TEXT NOT NULL);
CREATE INDEX evidences_year ON evidences(year,status);
CREATE INDEX evidences_hash ON evidences(sha256);
CREATE TABLE evidence_transaction_links(evidence_id TEXT REFERENCES evidences(id),transaction_id TEXT REFERENCES transactions(id) ON DELETE CASCADE,PRIMARY KEY(evidence_id,transaction_id));
CREATE TABLE ai_extractions(id TEXT PRIMARY KEY,evidence_id TEXT NOT NULL REFERENCES evidences(id),raw_json TEXT NOT NULL,import_hash TEXT UNIQUE NOT NULL,status TEXT NOT NULL,transaction_id TEXT REFERENCES transactions(id),imported_at TEXT NOT NULL);
CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE assets(id TEXT PRIMARY KEY,year INTEGER NOT NULL REFERENCES fiscal_years(year),data_json TEXT NOT NULL);
CREATE TABLE depreciation_entries(id TEXT PRIMARY KEY,asset_id TEXT NOT NULL REFERENCES assets(id),year INTEGER NOT NULL REFERENCES fiscal_years(year),opening_book_value INTEGER NOT NULL,depreciation_amount INTEGER NOT NULL,closing_book_value INTEGER NOT NULL,rule_version TEXT NOT NULL,calculation TEXT NOT NULL,transaction_id TEXT REFERENCES transactions(id),UNIQUE(asset_id,year));
CREATE TABLE bank_import_batches(id TEXT PRIMARY KEY,year INTEGER NOT NULL REFERENCES fiscal_years(year),source_name TEXT NOT NULL,file_hash TEXT UNIQUE NOT NULL,imported_at TEXT NOT NULL);
CREATE TABLE bank_entries(id TEXT PRIMARY KEY,year INTEGER NOT NULL REFERENCES fiscal_years(year),batch_id TEXT NOT NULL REFERENCES bank_import_batches(id),transaction_date TEXT NOT NULL,description TEXT NOT NULL,amount INTEGER NOT NULL,account_id TEXT NOT NULL REFERENCES accounts(id),reconciliation_status TEXT NOT NULL,transaction_id TEXT UNIQUE REFERENCES transactions(id));
CREATE TABLE upload_queue(id TEXT PRIMARY KEY REFERENCES evidences(id),target_folder_id TEXT,status TEXT NOT NULL,retry_count INTEGER NOT NULL DEFAULT 0,last_error TEXT);
CREATE TABLE drive_sync_state(year INTEGER PRIMARY KEY REFERENCES fiscal_years(year),root_folder_id TEXT NOT NULL,page_token TEXT,last_sync_at TEXT);
CREATE TABLE ai_audits(id TEXT PRIMARY KEY,review_type TEXT NOT NULL,target_years_json TEXT NOT NULL,law_basis_years_json TEXT NOT NULL,created_at TEXT NOT NULL,status TEXT NOT NULL,question TEXT NOT NULL,summary TEXT NOT NULL DEFAULT '',raw_result_json TEXT,requested_evidence_json TEXT NOT NULL DEFAULT '[]');
CREATE TABLE ai_audit_findings(id TEXT PRIMARY KEY,audit_id TEXT NOT NULL REFERENCES ai_audits(id),external_finding_id TEXT NOT NULL,data_json TEXT NOT NULL,status TEXT NOT NULL,resolution_note TEXT NOT NULL DEFAULT '',UNIQUE(audit_id,external_finding_id));
CREATE TABLE consultation_messages(id TEXT PRIMARY KEY,audit_id TEXT NOT NULL REFERENCES ai_audits(id),finding_id TEXT REFERENCES ai_audit_findings(id),role TEXT NOT NULL CHECK(role IN ('user','assistant')),content TEXT NOT NULL,created_at TEXT NOT NULL,reply_to TEXT REFERENCES consultation_messages(id));
CREATE TABLE historical_summaries(year INTEGER PRIMARY KEY REFERENCES fiscal_years(year),data_json TEXT NOT NULL);
CREATE TABLE audit_events(id TEXT PRIMARY KEY,event_type TEXT NOT NULL,entity_id TEXT NOT NULL,occurred_at TEXT NOT NULL,payload_json TEXT NOT NULL);
CREATE INDEX audit_events_time ON audit_events(occurred_at);
PRAGMA user_version=1;
`;
export const defaultAccounts = [
  ['1000', '現金', 'asset'],
  ['1010', '普通預金', 'asset'],
  ['1100', '売掛金', 'asset'],
  ['1200', '商品・棚卸資産', 'asset'],
  ['1300', '前払費用', 'asset'],
  ['1500', '工具器具備品', 'asset'],
  ['1510', '車両運搬具', 'asset'],
  ['1600', '事業主貸', 'asset'],
  ['2000', '買掛金', 'liability'],
  ['2100', '未払金', 'liability'],
  ['2200', '借入金', 'liability'],
  ['2300', '預り金', 'liability'],
  ['2400', '前受金', 'liability'],
  ['3000', '元入金', 'equity'],
  ['3100', '事業主借', 'equity'],
  ['4000', '売上高', 'revenue'],
  ['4100', '雑収入', 'revenue'],
  ['5000', '仕入高', 'expense'],
  ['5100', '外注工賃', 'expense'],
  ['5200', '消耗品費', 'expense'],
  ['5300', '通信費', 'expense'],
  ['5400', '旅費交通費', 'expense'],
  ['5500', '地代家賃', 'expense'],
  ['5600', '水道光熱費', 'expense'],
  ['5700', '広告宣伝費', 'expense'],
  ['5800', '接待交際費', 'expense'],
  ['5900', '会議費', 'expense'],
  ['6000', '支払手数料', 'expense'],
  ['6100', '租税公課', 'expense'],
  ['6200', '減価償却費', 'expense'],
  ['6300', '保険料', 'expense'],
  ['6400', '給料賃金', 'expense'],
  ['6500', '新聞図書費', 'expense'],
  ['6600', '雑費', 'expense'],
] as const;
