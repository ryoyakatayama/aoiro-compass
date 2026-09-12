import type { Database, SqlJsStatic, SqlValue } from 'sql.js';
import { z } from 'zod';
import { SCHEMA_VERSION, migration1, defaultAccounts } from './schema';
import {
  transactionSchema,
  profileSchema,
  assetSchema,
  extractionSchema,
  auditResultSchema,
  replySchema,
  historicalSchema,
  yearSchema,
  findingStatuses,
  newId,
  now,
  type Snapshot,
  type Transaction,
  type Evidence,
  type Audit,
  type Finding,
  type Message,
  type Account,
  type Asset,
  type BankEntry,
  type Depreciation,
} from '../domain/model';
import {
  validateJournal,
  closingChecks,
  reconciliationCandidates,
  report,
} from '../domain/accounting';
import { businessDepreciation, openingValue, straightLine } from '../domain/depreciation';

type Row = Record<string, SqlValue>;
export class Store {
  readonly db: Database;
  constructor(SQL: SqlJsStatic, bytes?: Uint8Array) {
    this.db = new SQL.Database(bytes);
    this.db.run('PRAGMA foreign_keys=ON');
    const v = Number(this.all('PRAGMA user_version')[0].user_version);
    if (v > SCHEMA_VERSION)
      throw new Error('このバックアップは新しいバージョンのアプリで作成されています');
    if (v === 0) {
      if (bytes) throw new Error('青色コンパスのバックアップではありません');
      this.atomic(() => {
        this.db.run(migration1);
        for (const [code, name, type] of defaultAccounts)
          this.run('INSERT INTO accounts VALUES(?,?,?,?,1)', [code, code, name, type]);
        this.run('INSERT INTO settings VALUES(?,?)', ['app_id', 'aoiro-compass']);
        this.addYear(new Date().getFullYear());
      });
    } else if (this.setting('app_id') !== 'aoiro-compass')
      throw new Error('青色コンパスのバックアップではありません');
  }
  all(sql: string, params: SqlValue[] = []): Row[] {
    const st = this.db.prepare(sql);
    try {
      st.bind(params);
      const rows: Row[] = [];
      while (st.step()) rows.push(st.getAsObject());
      return rows;
    } finally {
      st.free();
    }
  }
  run(sql: string, params: SqlValue[] = []) {
    this.db.run(sql, params);
  }
  atomic<T>(fn: () => T): T {
    this.run('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.run('COMMIT');
      return result;
    } catch (e) {
      this.run('ROLLBACK');
      throw e;
    }
  }
  setting(key: string) {
    return this.all('SELECT value FROM settings WHERE key=?', [key])[0]?.value as
      string | undefined;
  }
  setSetting(key: string, value: string) {
    this.run(
      'INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      [key, value],
    );
  }
  event(type: string, id: string, payload: unknown = {}) {
    this.run('INSERT INTO audit_events VALUES(?,?,?,?,?)', [
      newId(),
      type,
      id,
      now(),
      JSON.stringify(payload),
    ]);
  }
  assertEditable(year: number) {
    if (this.all('SELECT status FROM fiscal_years WHERE year=?', [year])[0]?.status !== 'active')
      throw new Error('この年度は閲覧専用です。締め済み年度は年度管理で解除してください');
  }
  addYear(year: number) {
    yearSchema.parse(year);
    this.run("INSERT INTO fiscal_years(year,status) VALUES(?,'active')", [year]);
    this.event('fiscal_year_created', String(year));
  }
  addAccount(input: unknown) {
    const a = z
      .object({
        code: z.string().regex(/^[A-Za-z0-9_-]{1,20}$/),
        name: z.string().trim().min(1).max(100),
        type: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']),
      })
      .parse(input);
    this.run('INSERT INTO accounts VALUES(?,?,?,?,1)', [a.code, a.code, a.name, a.type]);
    this.event('account_created', a.code);
  }
  saveProfile(input: unknown) {
    const profile = profileSchema.parse(input);
    this.setSetting('profile', JSON.stringify(profile));
    this.event('profile_updated', 'profile');
  }
  saveTransaction(input: unknown, allowHistorical = false) {
    const t = transactionSchema.parse(input);
    if (!allowHistorical) this.assertEditable(t.year);
    if (t.status === 'locked' && !allowHistorical)
      throw new Error('ロック状態は年度締めで設定します');
    const accounts = this.all('SELECT * FROM accounts') as unknown as Account[];
    validateJournal(t, accounts);
    const existing = this.all('SELECT * FROM transactions WHERE id=?', [t.id])[0];
    if (existing) {
      if (existing.year !== t.year) throw new Error('取引の年度は変更できません');
      if (existing.status !== 'draft')
        throw new Error('確定済み仕訳は修正操作から下書きに戻してください');
      if (t.updated_at !== existing.updated_at)
        throw new Error('別のタブで更新されました。開き直してから編集してください');
    }
    for (const eid of t.evidence_ids) {
      const e = this.all('SELECT year FROM evidences WHERE id=?', [eid])[0];
      if (!e || e.year !== t.year) throw new Error('証憑が存在しないか、年度が一致しません');
    }
    const stamp = new Date(
      Math.max(Date.now(), existing ? Date.parse(String(existing.updated_at)) + 1 : 0),
    ).toISOString();
    this.run(
      'INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET transaction_date=excluded.transaction_date,description=excluded.description,status=excluded.status,source=excluded.source,kind=excluded.kind,updated_at=excluded.updated_at',
      [t.id, t.year, t.transaction_date, t.description, t.status, t.source, t.kind, stamp],
    );
    this.run('DELETE FROM journal_lines WHERE transaction_id=?', [t.id]);
    t.lines.forEach((l, i) =>
      this.run('INSERT INTO journal_lines VALUES(?,?,?,?,?,?,?,?)', [
        newId(),
        t.id,
        l.account_id,
        l.debit_amount,
        l.credit_amount,
        l.tax_category,
        l.memo,
        i,
      ]),
    );
    this.run('DELETE FROM evidence_transaction_links WHERE transaction_id=?', [t.id]);
    for (const eid of new Set(t.evidence_ids))
      this.run('INSERT INTO evidence_transaction_links VALUES(?,?)', [eid, t.id]);
    this.refreshEvidenceStatuses(t.year);
    this.run('UPDATE ai_extractions SET status=? WHERE transaction_id=?', [
      t.status === 'confirmed' ? 'confirmed' : 'drafted',
      t.id,
    ]);
    this.event(t.status === 'confirmed' ? 'transaction_confirmed' : 'transaction_saved', t.id, {
      before: existing || null,
      after: t,
    });
    return t.id;
  }
  reviseTransaction(input: unknown, reason: string) {
    const t = transactionSchema.parse(input);
    const existing = this.snapshot().transactions.find((v) => v.id === t.id);
    if (!existing || existing.status !== 'confirmed' || existing.updated_at !== t.updated_at)
      throw new Error(
        '別の端末またはタブで仕訳が更新されました。入力内容を控えてから開き直してください',
      );
    this.unlockTransaction(t.id, reason);
    const updated = this.snapshot().transactions.find((v) => v.id === t.id)!;
    return this.saveTransaction({ ...t, updated_at: updated.updated_at });
  }
  unlockTransaction(id: string, reason: string) {
    if (!reason.trim()) throw new Error('修正理由を入力してください');
    const t = this.snapshot().transactions.find((t) => t.id === id);
    if (!t) throw new Error('仕訳が見つかりません');
    this.assertEditable(t.year);
    this.run("UPDATE transactions SET status='draft',updated_at=? WHERE id=?", [
      new Date(Math.max(Date.now(), Date.parse(t.updated_at || '') + 1 || 0)).toISOString(),
      id,
    ]);
    this.refreshEvidenceStatuses(t.year);
    this.run("UPDATE ai_extractions SET status='drafted' WHERE transaction_id=?", [id]);
    this.event('transaction_unlocked', id, { reason, before: t });
  }
  deleteDraft(id: string) {
    const t = this.snapshot().transactions.find((t) => t.id === id);
    if (!t || t.status !== 'draft') throw new Error('削除できるのは下書きだけです');
    this.assertEditable(t.year);
    if (this.all('SELECT id FROM ai_extractions WHERE transaction_id=?', [id]).length)
      this.run(
        "UPDATE ai_extractions SET transaction_id=NULL,status='pending' WHERE transaction_id=?",
        [id],
      );
    if (this.all('SELECT id FROM depreciation_entries WHERE transaction_id=?', [id]).length)
      throw new Error('償却明細に対応する仕訳です。内容を修正して確定してください');
    this.run('DELETE FROM transactions WHERE id=?', [id]);
    this.refreshEvidenceStatuses(t.year);
    this.event('draft_deleted', id, { before: t });
  }
  private refreshEvidenceStatuses(year: number) {
    this.run(
      `UPDATE evidences SET status=CASE
        WHEN EXISTS(SELECT 1 FROM evidence_transaction_links link JOIN transactions t ON t.id=link.transaction_id WHERE link.evidence_id=evidences.id AND t.status IN ('confirmed','locked')) THEN 'confirmed'
        WHEN EXISTS(SELECT 1 FROM ai_extractions x WHERE x.evidence_id=evidences.id) THEN 'ai_imported'
        WHEN drive_file_id IS NULL THEN 'queued' ELSE 'indexed' END
        WHERE year=? AND status IN ('indexed','queued','confirmed','ai_imported')`,
      [year],
    );
  }
  upsertEvidence(e: Evidence) {
    const existing = e.drive_file_id
      ? this.all('SELECT * FROM evidences WHERE drive_file_id=?', [e.drive_file_id])[0]
      : this.all('SELECT * FROM evidences WHERE id=?', [e.id])[0];
    if (existing) {
      const changed = existing.original_sha256 !== e.sha256;
      this.run(
        'UPDATE evidences SET filename=?,mime_type=?,size_bytes=?,sha256=?,modified_time=?,status=? WHERE id=?',
        [
          e.filename,
          e.mime_type,
          e.size_bytes,
          e.sha256,
          e.modified_time,
          changed
            ? 'modified'
            : existing.status === 'missing'
              ? 'indexed'
              : String(existing.status),
          String(existing.id),
        ],
      );
      if (changed) this.event('evidence_modified_detected', String(existing.id));
      return String(existing.id);
    }
    if (!this.all('SELECT year FROM fiscal_years WHERE year=?', [e.year]).length)
      throw new Error('年度がありません');
    const duplicate = this.all('SELECT id FROM evidences WHERE sha256=?', [e.sha256]).length > 0;
    this.run('INSERT INTO evidences VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [
      e.id,
      e.year,
      e.drive_file_id,
      e.filename,
      e.mime_type,
      e.size_bytes,
      e.sha256,
      e.original_sha256,
      e.modified_time,
      duplicate ? 'duplicate' : e.status,
      e.capture_source,
      e.hint,
      e.payment_account,
      e.note,
      e.indexed_at,
    ]);
    if (!e.drive_file_id)
      this.run("INSERT INTO upload_queue(id,status) VALUES(?,'pending')", [e.id]);
    this.event('evidence_indexed', e.id, { sha256: e.sha256 });
    return e.id;
  }
  markMissing(driveId: string) {
    this.run("UPDATE evidences SET status='missing' WHERE drive_file_id=?", [driveId]);
    this.event('evidence_missing_detected', driveId);
  }
  acknowledgeEvidence(id: string, action: 'ignored' | 'accept', note: string) {
    if (!note.trim()) throw new Error('確認メモを入力してください');
    const e = this.snapshot().evidences.find((e) => e.id === id);
    if (!e) throw new Error('証憑が見つかりません');
    this.assertEditable(e.year);
    if (action === 'accept' && e.status === 'missing')
      throw new Error('欠落した原本は確認済みにできません。Driveから復旧してください');
    this.run('UPDATE evidences SET status=?,note=? WHERE id=?', [
      action === 'ignored' ? 'ignored' : 'indexed',
      note,
      id,
    ]);
    if (action === 'accept' && e.status === 'modified')
      this.run('UPDATE evidences SET original_sha256=sha256 WHERE id=?', [id]);
    this.event('evidence_reviewed', id, {
      action,
      note,
      prior_hash: e.original_sha256,
      current_hash: e.sha256,
    });
  }
  importExtractions(text: string) {
    const lines = text
      .replace(/^\uFEFF/, '')
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
    if (!lines.length || lines.length > 1000)
      throw new Error('1〜1,000行のJSONLを指定してください');
    const values = lines.map((l, i) => {
      try {
        return extractionSchema.parse(JSON.parse(l));
      } catch {
        throw new Error(`${i + 1}行目の読取JSONが形式に合いません`);
      }
    });
    const seen = new Set<string>();
    for (const value of values) {
      if (seen.has(value.evidence_id)) throw new Error('バッチ内で証憑IDが重複しています');
      seen.add(value.evidence_id);
      const e = this.all('SELECT year FROM evidences WHERE id=?', [value.evidence_id])[0];
      if (!e) throw new Error('不明な証憑IDです: ' + value.evidence_id);
      this.assertEditable(Number(e.year));
      const canonical = JSON.stringify(value);
      if (this.all('SELECT id FROM ai_extractions WHERE import_hash=?', [canonical]).length)
        throw new Error('この読取結果は取込済みです');
      this.run('INSERT INTO ai_extractions VALUES(?,?,?,?,?,?,?)', [
        newId(),
        value.evidence_id,
        canonical,
        canonical,
        'pending',
        null,
        now(),
      ]);
      this.run(
        "UPDATE evidences SET status=CASE WHEN status IN ('missing','modified','duplicate') THEN status ELSE 'ai_imported' END WHERE id=?",
        [value.evidence_id],
      );
    }
    this.event('ai_extractions_imported', newId(), { count: values.length });
    return values.length;
  }
  saveReviewedExtraction(id: string, input: unknown) {
    const s = this.snapshot(),
      x = s.extractions.find((x) => x.id === id);
    if (!x || x.transaction_id)
      throw new Error('この読取候補は別の操作で処理されています。開き直してください');
    if (s.transactions.some((t) => t.evidence_ids.includes(x.evidence_id)))
      throw new Error(
        'この原本には既に仕訳があります。二重計上を避けるため既存の仕訳を確認してください',
      );
    const t = transactionSchema.parse(input);
    if (
      t.evidence_ids.length !== 1 ||
      t.evidence_ids[0] !== x.evidence_id ||
      s.transactions.some((v) => v.id === t.id)
    )
      throw new Error('読取候補と仕訳が一致しません');
    const transactionId = this.saveTransaction(t);
    this.run('UPDATE ai_extractions SET transaction_id=?,status=? WHERE id=?', [
      transactionId,
      t.status === 'confirmed' ? 'confirmed' : 'drafted',
      id,
    ]);
    return transactionId;
  }
  draftFromExtraction(id: string) {
    const s = this.snapshot(),
      x = s.extractions.find((x) => x.id === id);
    if (!x || x.transaction_id) throw new Error('この候補は既に下書きに反映されています');
    const e = s.evidences.find((e) => e.id === x.evidence_id)!;
    this.assertEditable(e.year);
    const a = s.accounts.find(
      (a) => a.name === x.suggested_account || a.id === x.suggested_account,
    );
    if (!a) throw new Error('AIが返した科目が未登録です。先に勘定科目を追加してください');
    const income = a.type === 'revenue';
    const counter = s.accounts.find((a) => a.id === e.payment_account)?.id || '3100';
    const transaction_id = this.saveTransaction({
      id: newId(),
      year: e.year,
      transaction_date: x.transaction_date,
      description: x.vendor,
      status: 'draft',
      source: 'ai',
      lines: [
        {
          account_id: a.id,
          debit_amount: income ? 0 : x.gross_amount,
          credit_amount: income ? x.gross_amount : 0,
        },
        {
          account_id: counter,
          debit_amount: income ? x.gross_amount : 0,
          credit_amount: income ? 0 : x.gross_amount,
        },
      ],
      evidence_ids: [e.id],
    });
    this.run("UPDATE ai_extractions SET transaction_id=?,status='drafted' WHERE id=?", [
      transaction_id,
      id,
    ]);
    return transaction_id;
  }
  saveAsset(input: unknown) {
    const a = assetSchema.parse(input);
    this.assertEditable(a.year);
    if (a.opening_year === undefined && Number(a.acquisition_date.slice(0, 4)) !== a.year)
      throw new Error('取得日と登録年度が一致しません');
    if (
      a.asset_account_id &&
      !this.snapshot().accounts.some(
        (account) =>
          account.id === a.asset_account_id && account.type === 'asset' && account.is_active,
      )
    )
      throw new Error('資産の貸方には有効な資産科目を選んでください');
    if (this.all('SELECT id FROM assets WHERE id=?', [a.id]).length)
      throw new Error('既存資産の上書きはできません');
    this.run('INSERT INTO assets VALUES(?,?,?)', [a.id, a.year, JSON.stringify(a)]);
    this.event('asset_created', a.id);
  }
  addDepreciation(input: unknown) {
    const d = z
      .object({
        asset_id: z.string().uuid(),
        year: yearSchema,
        opening_book_value: z.number().int().nonnegative(),
        depreciation_amount: z.number().int().nonnegative(),
        rule_version: z.string().trim().min(1).max(200),
        calculation: z.string().trim().min(1).max(5000),
        automatic: z.boolean().default(false),
        months: z.number().int().min(1).max(12).optional(),
      })
      .parse(input);
    this.assertEditable(d.year);
    const s = this.snapshot(),
      a = s.assets.find((a) => a.id === d.asset_id);
    if (
      !a ||
      a.year > d.year ||
      a.in_service_date > `${d.year}-12-31` ||
      (a.disposed_at && a.disposed_at < `${d.year}-01-01`)
    )
      throw new Error('この年度に供用されていない資産です');
    if (s.depreciations.some((p) => p.asset_id === a.id && p.year === d.year))
      throw new Error('この年度の償却は登録済みです');
    if (d.opening_book_value !== openingValue(a, d.year, s.depreciations))
      throw new Error('前年度末または引継ぎの簿価と一致しません');
    if (d.automatic) {
      if (a.depreciation_method !== 'straight_line')
        throw new Error('自動計算は登録した定額法の資産で利用できます');
      const calculated = straightLine(a, d.year, d.opening_book_value, d.months);
      d.depreciation_amount = calculated.amount;
      d.rule_version = calculated.rule;
      d.calculation = calculated.basis;
    }
    if (d.depreciation_amount > d.opening_book_value)
      throw new Error('償却額が期首簿価を超えています');
    const prior = s.depreciations
      .filter((p) => p.asset_id === a.id && p.year < d.year)
      .sort((a, b) => b.year - a.year)[0];
    if (prior && d.opening_book_value !== prior.closing_book_value)
      throw new Error('前回の期末簿価と一致しません');
    if (!prior && a.opening_year !== d.year && d.opening_book_value !== a.acquisition_cost)
      throw new Error('初回の期首簿価には取得価額を指定してください');
    if (prior && prior.year !== d.year - 1)
      throw new Error('前年度の償却明細を先に登録してください');
    if (!prior && a.opening_year !== d.year && d.year !== Number(a.in_service_date.slice(0, 4)))
      throw new Error('供用年度から順に償却明細を登録してください');
    let tid: string | null = null;
    const expense = businessDepreciation(d.depreciation_amount, a.business_use_ratio);
    const privateAmount = d.depreciation_amount - expense;
    if (d.depreciation_amount) {
      const lines = [
        {
          account_id: a.asset_account_id || (a.asset_class === '車両運搬具' ? '1510' : '1500'),
          debit_amount: 0,
          credit_amount: d.depreciation_amount,
        },
      ];
      if (expense) lines.push({ account_id: '6200', debit_amount: expense, credit_amount: 0 });
      if (privateAmount)
        lines.push({ account_id: '1600', debit_amount: privateAmount, credit_amount: 0 });
      tid = this.saveTransaction({
        id: newId(),
        year: d.year,
        transaction_date: `${d.year}-12-31`,
        description: `減価償却 / ${a.name}`,
        status: 'draft',
        source: 'depreciation',
        lines,
      });
    }
    this.run('INSERT INTO depreciation_entries VALUES(?,?,?,?,?,?,?,?,?)', [
      newId(),
      a.id,
      d.year,
      d.opening_book_value,
      d.depreciation_amount,
      d.opening_book_value - d.depreciation_amount,
      d.rule_version,
      d.calculation,
      tid,
    ]);
    this.event('depreciation_created', a.id, { ...d, transaction_id: tid });
  }
  importBank(
    rows: Omit<BankEntry, 'id' | 'batch_id' | 'reconciliation_status' | 'transaction_id'>[],
    hash: string,
    name: string,
  ) {
    if (!rows.length) throw new Error('取込対象の明細がありません');
    const year = rows[0].year;
    this.assertEditable(year);
    if (this.all('SELECT id FROM bank_import_batches WHERE file_hash=?', [hash]).length)
      throw new Error('このCSVは取込済みです');
    const batch = newId();
    this.run('INSERT INTO bank_import_batches VALUES(?,?,?,?,?)', [batch, year, name, hash, now()]);
    for (const r of rows) {
      if (r.year !== year) throw new Error('年度ごとにCSVを取り込んでください');
      this.run('INSERT INTO bank_entries VALUES(?,?,?,?,?,?,?,?,?)', [
        newId(),
        r.year,
        batch,
        r.transaction_date,
        r.description,
        r.amount,
        r.account_id,
        'unmatched',
        null,
      ]);
    }
    this.event('bank_imported', batch, { count: rows.length });
  }
  reconcile(id: string, transactionId: string | null) {
    const s = this.snapshot(),
      b = s.banks.find((b) => b.id === id);
    if (!b) throw new Error('明細がありません');
    this.assertEditable(b.year);
    if (
      transactionId &&
      !reconciliationCandidates(b, s.transactions).some((c) => c.transaction.id === transactionId)
    )
      throw new Error('金額・日付・口座が一致しません');
    this.run('UPDATE bank_entries SET reconciliation_status=?,transaction_id=? WHERE id=?', [
      transactionId ? 'matched' : 'ignored',
      transactionId,
      id,
    ]);
    this.event('bank_reconciled', id, { transactionId });
  }
  createAudit(a: Audit) {
    if (
      !a.target_years.length ||
      a.target_years.some(
        (y) => !this.all('SELECT year FROM fiscal_years WHERE year=?', [y]).length,
      )
    )
      throw new Error('対象年度が見つかりません');
    if (
      a.review_type === 'continuity' &&
      (a.target_years.length !== 2 || Math.abs(a.target_years[0] - a.target_years[1]) !== 1)
    )
      throw new Error('継続性レビューには連続する2年度を選んでください');
    this.run('INSERT INTO ai_audits VALUES(?,?,?,?,?,?,?,?,?,?)', [
      a.id,
      a.review_type,
      JSON.stringify(a.target_years),
      JSON.stringify(a.law_basis_years),
      a.created_at,
      'prepared',
      a.question,
      '',
      null,
      '[]',
    ]);
    this.event('audit_prepared', a.id);
  }
  importAudit(input: unknown) {
    const r = auditResultSchema.parse(input),
      s = this.snapshot(),
      a = s.audits.find((a) => a.id === r.audit_id);
    if (!a) throw new Error('アプリで作成した相談パックのaudit_idを使用してください');
    if (a.status !== 'prepared')
      throw new Error('この監査結果は取込済みです。追加回答は対話用JSONで取り込んでください');
    if (a.review_type !== r.review_type) throw new Error('レビュー種別が一致しません');
    const ids = new Set<string>();
    for (const f of r.findings) {
      if (ids.has(f.finding_id)) throw new Error('指摘IDが重複しています');
      ids.add(f.finding_id);
      for (const id of f.affected_transaction_ids)
        if (!s.transactions.some((t) => t.id === id && a.target_years.includes(t.year)))
          throw new Error('対象外または不明な仕訳IDです');
    }
    for (const id of [
      ...r.requested_evidence_ids,
      ...r.findings.flatMap((f) => f.requested_evidence_ids),
    ])
      if (!s.evidences.some((e) => e.id === id && a.target_years.includes(e.year)))
        throw new Error('対象外または不明な証憑IDです');
    for (const f of r.findings)
      this.run('INSERT INTO ai_audit_findings VALUES(?,?,?,?,?,?)', [
        newId(),
        a.id,
        f.finding_id,
        JSON.stringify(f),
        'new',
        '',
      ]);
    this.run(
      "UPDATE ai_audits SET status='imported',summary=?,raw_result_json=?,requested_evidence_json=? WHERE id=?",
      [
        r.summary.overall_assessment,
        JSON.stringify(r),
        JSON.stringify([
          ...new Set([
            ...r.requested_evidence_ids,
            ...r.findings.flatMap((f) => f.requested_evidence_ids),
          ]),
        ]),
        a.id,
      ],
    );
    this.event('ai_audit_imported', a.id, { findings: r.findings.length });
  }
  updateFinding(id: string, status: string, note: string) {
    z.enum(findingStatuses).parse(status);
    if (!this.all('SELECT id FROM ai_audit_findings WHERE id=?', [id]).length)
      throw new Error('指摘が見つかりません');
    this.run('UPDATE ai_audit_findings SET status=?,resolution_note=? WHERE id=?', [
      status,
      note.slice(0, 10000),
      id,
    ]);
    this.event('finding_updated', id, { status, note });
  }
  addMessage(auditId: string, findingId: string | null, content: string) {
    z.string().trim().min(1).max(20000).parse(content);
    const s = this.snapshot();
    if (!s.audits.some((a) => a.id === auditId)) throw new Error('相談が見つかりません');
    if (findingId && !s.findings.some((f) => f.id === findingId && f.audit_id === auditId))
      throw new Error('相談と指摘が一致しません');
    const id = newId();
    this.run('INSERT INTO consultation_messages VALUES(?,?,?,?,?,?,?)', [
      id,
      auditId,
      findingId,
      'user',
      content,
      now(),
      null,
    ]);
    if (findingId)
      this.run("UPDATE ai_audit_findings SET status='reviewing' WHERE id=?", [findingId]);
    this.event('consultation_reply_saved', id);
    return id;
  }
  importReplies(input: unknown) {
    const r = replySchema.parse(input),
      s = this.snapshot();
    if (!s.audits.some((a) => a.id === r.audit_id)) throw new Error('不明な相談IDです');
    for (const m of r.messages) {
      if (
        s.messages.some((x) => x.id === m.message_id) ||
        this.all('SELECT id FROM consultation_messages WHERE id=?', [m.message_id]).length
      )
        throw new Error('この回答は既に取込済みです');
      const parent = s.messages.find(
        (x) => x.id === m.reply_to && x.audit_id === r.audit_id && x.role === 'user',
      );
      if (!parent) throw new Error('返信先のメッセージが見つかりません');
      const f = m.finding_id
        ? s.findings.find(
            (f) =>
              (f.id === m.finding_id || f.finding_id === m.finding_id) && f.audit_id === r.audit_id,
          )
        : null;
      if (m.finding_id && !f) throw new Error('不明な指摘IDです');
      if (parent.finding_id !== (f?.id || null)) throw new Error('返信先と指摘が一致しません');
      this.run('INSERT INTO consultation_messages VALUES(?,?,?,?,?,?,?)', [
        m.message_id,
        r.audit_id,
        f?.id || null,
        'assistant',
        m.content,
        now(),
        m.reply_to,
      ]);
    }
    this.event('consultation_responses_imported', r.audit_id, { count: r.messages.length });
  }
  draftCorrection(findingId: string, year: number) {
    const s = this.snapshot(),
      f = s.findings.find((f) => f.id === findingId);
    if (!f?.suggested_draft_change) throw new Error('構造化された修正案がありません');
    this.assertEditable(year);
    if (!s.audits.find((a) => a.id === f.audit_id)?.target_years.includes(year))
      throw new Error('修正先年度が相談対象外です');
    const id = this.saveTransaction({
      ...f.suggested_draft_change,
      id: newId(),
      year,
      status: 'draft',
      source: `audit:${f.id}`,
      evidence_ids: [],
    });
    this.event('audit_correction_drafted', f.id, { id });
    return id;
  }
  importHistorical(input: unknown) {
    const h = historicalSchema.parse(input);
    if (this.all('SELECT year FROM fiscal_years WHERE year=?', [h.year]).length)
      throw new Error('既存年度は上書きしません。未登録年度を指定してください');
    if (h.data_completeness === 'summary_only' && (!h.summary || h.transactions.length))
      throw new Error('集計のみの年度にはsummaryが必要です（仕訳との併用不可）');
    if (h.data_completeness !== 'summary_only' && !h.transactions.length)
      throw new Error('仕訳データがありません');
    this.run("INSERT INTO fiscal_years VALUES(?,'historical_import',?,NULL)", [
      h.year,
      h.data_completeness,
    ]);
    for (const a of h.accounts) {
      const existing = this.all('SELECT * FROM accounts WHERE id=?', [a.id])[0];
      if (existing && (existing.name !== a.name || existing.type !== a.type))
        throw new Error('勘定科目の定義が既存データと矛盾しています');
      if (!existing)
        this.run('INSERT INTO accounts VALUES(?,?,?,?,?)', [
          a.id,
          a.code,
          a.name,
          a.type,
          a.is_active,
        ]);
    }
    for (const t of h.transactions) {
      if (t.year !== h.year || t.status === 'draft')
        throw new Error('対象年度の確定仕訳だけを指定してください');
      this.saveTransaction(
        { ...t, status: 'locked', source: 'historical', evidence_ids: [] },
        true,
      );
    }
    if (h.summary) {
      const accounts = this.all('SELECT * FROM accounts') as unknown as Account[];
      const ids = new Set<string>();
      let dr = 0,
        cr = 0;
      for (const b of h.summary.balance_sheet) {
        if (
          ids.has(b.account_id) ||
          !accounts.some((a) => a.id === b.account_id && !['revenue', 'expense'].includes(a.type))
        )
          throw new Error('B/Sの科目が無効または重複しています');
        ids.add(b.account_id);
        dr += b.debit_amount;
        cr += b.credit_amount;
      }
      if (dr !== cr) throw new Error('過年度B/Sの借方と貸方が一致しません');
      if (new Set(h.summary.monthly.map((m) => m.month)).size !== h.summary.monthly.length)
        throw new Error('月次集計の月が重複しています');
      for (const metric of ['revenue', 'expense'] as const) {
        const known = h.summary.monthly.filter((m) => m[metric] !== null);
        const sum = known.reduce((s, m) => s + m[metric]!, 0);
        if (known.length === 12 && sum !== h.summary[metric])
          throw new Error('月次集計と年次集計が一致しません');
      }
      this.run('INSERT INTO historical_summaries VALUES(?,?)', [h.year, JSON.stringify(h.summary)]);
      if (h.transactions.length) {
        const r = report(this.snapshot(), h.year);
        if (r.revenue !== h.summary.revenue || r.expense !== h.summary.expense)
          throw new Error('仕訳と損益の集計値が一致しません');
      }
    }
    for (const a of h.assets) {
      if (a.year !== h.year) throw new Error('資産の取得年度を確認してください');
      this.run('INSERT INTO assets VALUES(?,?,?)', [a.id, a.year, JSON.stringify(a)]);
    }
    this.event('historical_import_completed', String(h.year));
  }
  carryForward(prior: number, next: number) {
    this.assertEditable(next);
    if (next !== prior + 1) throw new Error('翌年度のみ繰越可能です');
    const s = this.snapshot();
    const source = s.years.find((y) => y.year === prior);
    if (!source || source.status === 'active')
      throw new Error('前年度を締めてから繰り越してください');
    if (s.transactions.some((t) => t.year === next && t.kind === 'opening'))
      throw new Error('翌年度には既に期首残高があります');
    const r = report(s, prior);
    let lines = r.balance
      .filter((a) => !['revenue', 'expense'].includes(a.type))
      .map((a) => {
        let signed = a.debit - a.credit;
        if (['1600', '3100'].includes(a.id)) signed = 0;
        if (a.id === '3000')
          signed -=
            r.profit +
            (r.balance.find((x) => x.id === '3100')?.balance || 0) -
            (r.balance.find((x) => x.id === '1600')?.balance || 0);
        return {
          account_id: a.id,
          debit_amount: Math.max(0, signed),
          credit_amount: Math.max(0, -signed),
        };
      })
      .filter((l) => l.debit_amount || l.credit_amount);
    if (r.summaryOnly) {
      const summary = s.historicalSummaries[prior];
      if (!summary?.balance_sheet.length) throw new Error('過年度のB/Sがありません');
      lines = summary.balance_sheet
        .filter((l) => !['1600', '3100'].includes(l.account_id))
        .map((l) => ({ ...l }));
      const owner = summary.balance_sheet
        .filter((l) => ['1600', '3100'].includes(l.account_id))
        .reduce((n, l) => n + l.credit_amount - l.debit_amount, 0);
      const capital = lines.find((l) => l.account_id === '3000');
      if (owner) {
        const signed = (capital ? capital.debit_amount - capital.credit_amount : 0) - owner;
        const row = {
          account_id: '3000',
          debit_amount: Math.max(0, signed),
          credit_amount: Math.max(0, -signed),
        };
        if (capital) Object.assign(capital, row);
        else lines.push(row);
      }
    }
    if (!lines.length) throw new Error('繰り越す残高がありません');
    this.saveTransaction({
      id: newId(),
      year: next,
      transaction_date: `${next}-01-01`,
      description: `${prior}年からの期首残高`,
      status: 'draft',
      source: 'carry_forward',
      kind: 'opening',
      lines,
    });
    this.event('opening_balance_carried_forward', String(next), { prior });
  }
  closeYear(year: number, archive: string) {
    this.assertEditable(year);
    if (closingChecks(this.snapshot(), year).some((c) => c.fatal && c.count))
      throw new Error('年度締めを妨げる項目が残っています');
    if (!archive) throw new Error('バックアップの保存が必要です');
    this.run("UPDATE fiscal_years SET status='closed',locked_at=? WHERE year=?", [now(), year]);
    this.run("UPDATE transactions SET status='locked' WHERE year=? AND status='confirmed'", [year]);
    this.event('fiscal_year_locked', String(year), { archive });
  }
  unlockYear(year: number, reason: string) {
    if (!reason.trim()) throw new Error('解除理由を入力してください');
    if (this.all('SELECT status FROM fiscal_years WHERE year=?', [year])[0]?.status !== 'closed')
      throw new Error('締め済み年度のみ解除できます');
    this.run("UPDATE fiscal_years SET status='active',locked_at=NULL WHERE year=?", [year]);
    this.run("UPDATE transactions SET status='confirmed' WHERE year=? AND status='locked'", [year]);
    this.event('fiscal_year_unlocked', String(year), { reason });
  }
  snapshot(): Snapshot {
    const lines = this.all('SELECT * FROM journal_lines ORDER BY sort_order'),
      links = this.all('SELECT * FROM evidence_transaction_links');
    const lineMap = new Map<string, Row[]>(),
      linkMap = new Map<string, string[]>();
    for (const l of lines) {
      const id = String(l.transaction_id);
      lineMap.set(id, [...(lineMap.get(id) || []), l]);
    }
    for (const l of links) {
      const id = String(l.transaction_id);
      linkMap.set(id, [...(linkMap.get(id) || []), String(l.evidence_id)]);
    }
    return {
      years: this.all(
        'SELECT * FROM fiscal_years ORDER BY year DESC',
      ) as unknown as Snapshot['years'],
      accounts: this.all('SELECT * FROM accounts ORDER BY code') as unknown as Account[],
      transactions: this.all('SELECT * FROM transactions ORDER BY transaction_date DESC,id').map(
        (t) => ({
          ...t,
          lines: lineMap.get(String(t.id)) || [],
          evidence_ids: linkMap.get(String(t.id)) || [],
        }),
      ) as unknown as Transaction[],
      evidences: this.all(
        'SELECT * FROM evidences ORDER BY indexed_at DESC',
      ) as unknown as Evidence[],
      extractions: this.all('SELECT * FROM ai_extractions ORDER BY imported_at').map((x) => ({
        ...JSON.parse(String(x.raw_json)),
        id: x.id,
        status: x.status,
        transaction_id: x.transaction_id,
      })),
      assets: this.all('SELECT * FROM assets').map((a) =>
        JSON.parse(String(a.data_json)),
      ) as Asset[],
      depreciations: this.all('SELECT * FROM depreciation_entries') as unknown as Depreciation[],
      banks: this.all(
        'SELECT * FROM bank_entries ORDER BY transaction_date DESC',
      ) as unknown as BankEntry[],
      audits: this.all('SELECT * FROM ai_audits ORDER BY created_at DESC').map((a) => ({
        id: a.id,
        review_type: a.review_type,
        target_years: JSON.parse(String(a.target_years_json)),
        law_basis_years: JSON.parse(String(a.law_basis_years_json)),
        created_at: a.created_at,
        status: a.status,
        question: a.question,
        summary: a.summary,
        requested_evidence_ids: JSON.parse(String(a.requested_evidence_json)),
      })) as Audit[],
      findings: this.all('SELECT * FROM ai_audit_findings').map((f) => ({
        ...JSON.parse(String(f.data_json)),
        id: f.id,
        audit_id: f.audit_id,
        status: f.status,
        resolution_note: f.resolution_note,
      })) as Finding[],
      messages: this.all(
        'SELECT * FROM consultation_messages ORDER BY created_at,id',
      ) as unknown as Message[],
      profile: profileSchema.parse(JSON.parse(this.setting('profile') || '{}')),
      settings: Object.fromEntries(
        this.all('SELECT * FROM settings').map((r) => [String(r.key), String(r.value)]),
      ),
      events: this.all(
        'SELECT * FROM audit_events ORDER BY occurred_at DESC LIMIT 300',
      ) as unknown as Snapshot['events'],
      historicalSummaries: Object.fromEntries(
        this.all('SELECT * FROM historical_summaries').map((r) => [
          String(r.year),
          JSON.parse(String(r.data_json)),
        ]),
      ),
    };
  }
  validate() {
    if (this.all("SELECT name FROM sqlite_master WHERE type IN ('trigger','view')").length)
      throw new Error('未対応のSQLオブジェクトを含むバックアップです');
    if (
      this.all('PRAGMA integrity_check')[0]?.integrity_check !== 'ok' ||
      this.all('PRAGMA foreign_key_check').length
    )
      throw new Error('バックアップの整合性を確認できません');
    const s = this.snapshot();
    for (const t of s.transactions) validateJournal(transactionSchema.parse(t), s.accounts);
    for (const a of s.assets) assetSchema.parse(a);
    for (const f of s.findings)
      if (!s.audits.some((a) => a.id === f.audit_id)) throw new Error('相談データが不正です');
  }
  export() {
    const bytes = this.db.export();
    this.db.run('PRAGMA foreign_keys=ON');
    return bytes;
  }
  close() {
    this.db.close();
  }
}
