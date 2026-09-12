import Papa from 'papaparse';
import { dateSchema, type BankEntry } from '../domain/model';
export function exportCsv(rows: unknown[][]) {
  return (
    '\uFEFF' +
    Papa.unparse(
      rows.map((row) =>
        row.map((v) => (typeof v === 'string' && /^[\s]*[=+\-@]/.test(v) ? `'${v}` : v)),
      ),
    )
  );
}
export async function readTextFile(file: File, encoding = 'utf-8') {
  const bytes = await file.arrayBuffer();
  const header = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 4));
  if (header[0] === 0x50 && header[1] === 0x4b && header[2] === 3 && header[3] === 4)
    throw new Error(
      'このファイルの中身はExcel形式などのZIPファイルです。Excelで開いてCSV UTF-8として保存してから取り込んでください。拡張子だけの変更では変換できません。',
    );
  return new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
}
export function parseBankCsv(
  text: string,
  year: number,
  accountId: string,
  mapping = { date: '日付', description: '摘要', amount: '金額' },
) {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^\uFEFF/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
  });
  if (parsed.errors.length) throw new Error(`CSV形式エラー: ${parsed.errors[0].message}`);
  if (
    ![mapping.date, mapping.description, mapping.amount].every((k) =>
      parsed.meta.fields?.includes(k),
    )
  )
    throw new Error('CSVの列名を確認してください（日付・摘要・金額）');
  return parsed.data.map((r, i) => {
    const rawDate = r[mapping.date].trim().replace(/\//g, '-');
    const parts = rawDate.split('-');
    const date =
      parts.length === 3
        ? `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`
        : rawDate;
    dateSchema.parse(date);
    if (Number(date.slice(0, 4)) !== year) throw new Error(`${i + 2}行目: 対象年度が異なります`);
    const raw = r[mapping.amount].trim().replace(/[,¥￥\s]/g, '');
    if (!/^-?\d+$/.test(raw)) throw new Error(`${i + 2}行目: 金額は整数で入力してください`);
    const amount = Number(raw);
    if (!Number.isSafeInteger(amount) || Math.abs(amount) > 1e12)
      throw new Error('金額が大きすぎます');
    return {
      year,
      transaction_date: date,
      description: r[mapping.description].slice(0, 2000),
      amount,
      account_id: accountId,
    } as Omit<BankEntry, 'id' | 'batch_id' | 'reconciliation_status' | 'transaction_id'>;
  });
}
