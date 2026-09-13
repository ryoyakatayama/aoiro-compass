import { useState } from 'react';
import { Card, Field, Modal } from './shared';
import { useApp } from './context';
import {
  activityPrefix,
  activitySchema,
  incomeActivities,
  type IncomeActivity,
} from '../domain/activities';
import { now, newId } from '../domain/model';
import { isMisc } from '../lib/book';
export default function Activities() {
  const { s, year, engine, run, busy } = useApp();
  const [edit, setEdit] = useState<IncomeActivity | null>(null),
    [base, setBase] = useState<string | undefined>();
  const open = (a?: IncomeActivity) => {
    setBase(a ? s.settings[activityPrefix + a.id] : undefined);
    setEdit(
      a || {
        id: newId(),
        name: '',
        from_year: year,
        to_year: null,
        category: '',
        description: '',
        income_source: '',
        expenses: '',
        allocation: '',
        note: '',
        archived: false,
        updated: now(),
      },
    );
  };
  const save = (archived = false) =>
    void run(async () => {
      const value = activitySchema.parse({ ...edit, archived, updated: now() }),
        key = activityPrefix + value.id;
      await engine.write((st) => {
        if (st.setting(key) !== base && (st.setting(key) || undefined) !== base)
          throw new Error('活動情報が更新されています。開き直してください');
        st.setSetting(key, JSON.stringify(value));
        st.event('income_activity_saved', value.id);
      });
      setEdit(null);
    }, '活動情報を保存しました');
  const fields = [
    ['name', '活動名'],
    ['category', isMisc ? '雑所得の種類・本人の認識' : '業種・活動の種類'],
    ['description', '具体的な仕事内容・活動内容'],
    ['income_source', '収入の支払者・契約・交付条件'],
    ['expenses', '経費の内容と収入との関係'],
    ['allocation', '事業・雑所得・私用との共用や按分'],
    ['note', 'この期間の変更点・未確認事項'],
  ] as const;
  return (
    <Card
      title={isMisc ? '雑所得の活動・年度別プロフィール' : '事業の活動・年度別プロフィール'}
      subtitle="複数の活動を登録できます。該当する年度のAI相談へ渡します。活動ごとの収入金額の配賦や所得区分の自動変更は行いません。"
    >
      <button className="button secondary" onClick={() => open()}>
        活動を追加
      </button>
      {incomeActivities(s).map((a) => (
        <div className="activity-row" key={a.id}>
          <div>
            <strong>{a.name}</strong>
            <p>
              {a.from_year}年〜{a.to_year ?? '継続中'} · {a.category || '種類未記入'}
            </p>
            <p>{a.description}</p>
          </div>
          <button className="button secondary compact" onClick={() => open(a)}>
            活動を編集
          </button>
        </div>
      ))}
      {!incomeActivities(s).length && (
        <p>
          未登録です。雑所得の収入が研究・副業・年金などのどの活動から生じるか、交付条件や経費との関係を記録できます。
        </p>
      )}
      {edit && (
        <Modal title="活動プロフィールを編集" wide onClose={() => setEdit(null)}>
          <div className="modal-body">
            <div className="form-grid">
              <Field label="活動の開始年">
                <input
                  type="number"
                  value={edit.from_year}
                  onChange={(e) => setEdit({ ...edit, from_year: Number(e.target.value) })}
                />
              </Field>
              <Field label="活動の終了年（継続中は空欄）">
                <input
                  type="number"
                  value={edit.to_year ?? ''}
                  onChange={(e) =>
                    setEdit({ ...edit, to_year: e.target.value ? Number(e.target.value) : null })
                  }
                />
              </Field>
              {fields.map(([key, label]) => (
                <Field key={key} label={label} className="span-2">
                  <textarea
                    rows={key === 'description' ? 3 : 2}
                    value={edit[key]}
                    onChange={(e) => setEdit({ ...edit, [key]: e.target.value })}
                  />
                </Field>
              ))}
            </div>
          </div>
          <div className="modal-footer">
            {base && (
              <button className="text-button" disabled={busy} onClick={() => save(true)}>
                誤登録を取り下げる
              </button>
            )}
            <button className="button" disabled={busy || !edit.name.trim()} onClick={() => save()}>
              活動情報を保存
            </button>
          </div>
        </Modal>
      )}
    </Card>
  );
}
