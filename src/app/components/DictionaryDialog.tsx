import React, { useState, useEffect, useRef, useCallback, ChangeEvent } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';

export const DICTIONARY_STORAGE_KEY = 'speechflow-dictionary-terms';
const MAX_ENTRIES = 100;
const DICTIONARY_API = '/api/dictionary';

interface StoredEntry {
  term: string;
  reading: string;
}

interface Entry extends StoredEntry {
  id: string;
}

type SortOrder = 'none' | 'term' | 'reading';

const DEFAULT_ENTRIES: StoredEntry[] = [
  { term: 'カミナシ', reading: '' },
  { term: 'インフォバーン', reading: '' },
  { term: 'MIXI', reading: 'ミクシィ' },
  { term: 'Muture', reading: 'ミューチャー' },
  { term: 'GMOメディア', reading: '' },
];

let _nextId = 0;
const nextId = () => String(_nextId++);

function toEntries(stored: StoredEntry[]): Entry[] {
  return stored.map(e => ({ ...e, id: nextId() }));
}

function normalizeData(data: unknown): StoredEntry[] | null {
  if (!Array.isArray(data) || data.length === 0) return null;
  if (typeof data[0] === 'object' && data[0] !== null) {
    const entries = data.filter(
      (e): e is StoredEntry =>
        typeof e === 'object' && e !== null &&
        typeof (e as StoredEntry).term === 'string' &&
        (e as StoredEntry).term.trim() !== '',
    );
    return entries.length > 0 ? entries : null;
  }
  if (typeof data[0] === 'string') {
    const terms = data.filter((t): t is string => typeof t === 'string' && t.trim() !== '');
    return terms.length > 0 ? terms.map(t => ({ term: t, reading: '' })) : null;
  }
  return null;
}

async function fetchEntriesFromServer(): Promise<StoredEntry[] | null> {
  try {
    const res = await fetch(DICTIONARY_API, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json() as Record<string, unknown>;
    if ('entries' in data) return normalizeData(data.entries);
    if ('terms' in data) return normalizeData(data.terms);
    return null;
  } catch {
    return null;
  }
}

async function saveEntriesToServer(entries: StoredEntry[]): Promise<boolean> {
  try {
    const res = await fetch(DICTIONARY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function loadDictionaryTerms(): Promise<string[]> {
  const serverEntries = await fetchEntriesFromServer();
  if (serverEntries && serverEntries.length > 0) return serverEntries.map(e => e.term);
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(DICTIONARY_STORAGE_KEY);
      if (stored) {
        const entries = normalizeData(JSON.parse(stored));
        if (entries && entries.length > 0) return entries.map(e => e.term);
      }
    } catch { /* ignore */ }
  }
  return DEFAULT_ENTRIES.map(e => e.term);
}

function parseCSV(text: string): StoredEntry[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [term = '', reading = ''] = line.split(',').map(s => s.trim());
      return { term, reading };
    })
    .filter(e => e.term !== '');
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function DictionaryDialog({ open, onClose }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [filter, setFilter] = useState('');
  const [sortOrder, setSortOrder] = useState<SortOrder>('none');
  const [importCount, setImportCount] = useState<number | null>(null);
  const isSavingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setSaveError(false);
    setFilter('');
    setSortOrder('none');
    setImportCount(null);
    setLoading(true);
    fetchEntriesFromServer().then(serverEntries => {
      if (serverEntries && serverEntries.length > 0) {
        setEntries(toEntries(serverEntries));
        return;
      }
      if (typeof window !== 'undefined') {
        try {
          const stored = localStorage.getItem(DICTIONARY_STORAGE_KEY);
          if (stored) {
            const localEntries = normalizeData(JSON.parse(stored));
            if (localEntries && localEntries.length > 0) {
              setEntries(toEntries(localEntries));
              return;
            }
          }
        } catch { /* ignore */ }
      }
      setEntries(toEntries(DEFAULT_ENTRIES));
    }).finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (importCount === null) return;
    const timer = setTimeout(() => setImportCount(null), 4000);
    return () => clearTimeout(timer);
  }, [importCount]);

  const handleChange = useCallback((id: string, field: 'term' | 'reading', value: string) => {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e));
  }, []);

  const handleDelete = useCallback((id: string) => {
    setEntries(prev => prev.filter(e => e.id !== id));
  }, []);

  const handleAdd = useCallback(() => {
    setEntries(prev => {
      if (prev.length >= MAX_ENTRIES) return prev;
      return [...prev, { id: nextId(), term: '', reading: '' }];
    });
  }, []);

  const handleCSVImport = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result;
      if (typeof text !== 'string') return;
      const imported = parseCSV(text);
      setEntries(prev => {
        const existingTerms = new Set(prev.map(e => e.term.trim()));
        const newEntries = imported
          .filter(e => !existingTerms.has(e.term.trim()))
          .slice(0, MAX_ENTRIES - prev.length)
          .map(e => ({ ...e, id: nextId() }));
        setImportCount(newEntries.length);
        return [...prev, ...newEntries];
      });
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  }, []);

  const handleSave = async () => {
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    setSaving(true);
    setSaveError(false);
    const stored: StoredEntry[] = entries
      .map(({ term, reading }) => ({ term: term.trim(), reading: reading.trim() }))
      .filter(e => e.term !== '');
    localStorage.setItem(DICTIONARY_STORAGE_KEY, JSON.stringify(stored));
    const ok = await saveEntriesToServer(stored);
    setSaving(false);
    isSavingRef.current = false;
    if (!ok) {
      setSaveError(true);
      return;
    }
    onClose();
  };

  const displayedEntries = (() => {
    let list = entries;
    if (filter.trim()) {
      const q = filter.trim().toLowerCase();
      list = list.filter(e => e.term.toLowerCase().includes(q) || e.reading.toLowerCase().includes(q));
    }
    if (sortOrder === 'term') {
      list = [...list].sort((a, b) => a.term.localeCompare(b.term, 'ja'));
    } else if (sortOrder === 'reading') {
      list = [...list].sort((a, b) => a.reading.localeCompare(b.reading, 'ja'));
    }
    return list;
  })();

  const filledCount = entries.filter(e => e.term.trim() !== '').length;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v && !isSavingRef.current) { setSaveError(false); onClose(); } }}>
      <DialogContent className="max-w-2xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>用語辞書（共有）</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-gray-500 shrink-0">
          正しく書き起こしたい社名・人名などを登録してください。DeepgramとOpenAIの両方に反映されます（最大{MAX_ENTRIES}件）。<br />
          <span className="text-blue-500">登録した内容はすべてのユーザーで共有されます。</span>
        </p>

        {saveError && (
          <p className="text-sm text-red-500 shrink-0 mt-1">
            サーバーへの保存に失敗しました。ネットワークを確認してください。
          </p>
        )}
        {importCount !== null && (
          <p className="text-sm text-green-600 shrink-0 mt-1">
            {importCount}件を読み込みました（重複除外済み）。
          </p>
        )}

        {/* Toolbar */}
        <div className="flex items-center gap-2 mt-2 shrink-0">
          <input
            type="text"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="フィルター..."
            className="flex-1 text-sm border border-gray-300 rounded px-2 h-8 focus:outline-none focus:border-blue-400"
          />
          <select
            value={sortOrder}
            onChange={e => setSortOrder(e.target.value as SortOrder)}
            className="text-sm border border-gray-300 rounded px-2 h-8 focus:outline-none focus:border-blue-400 bg-white"
          >
            <option value="none">並び順：デフォルト</option>
            <option value="term">用語順</option>
            <option value="reading">読み順</option>
          </select>
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="shrink-0">
            CSV読み込み
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleCSVImport}
            className="hidden"
          />
        </div>

        {/* Column headers */}
        <div className="flex items-center gap-2 mt-1 shrink-0 px-0.5">
          <div className="flex-1 text-xs text-gray-400 font-medium">用語</div>
          <div className="flex-1 text-xs text-gray-400 font-medium">読み（カタカナ・任意）</div>
          <div className="w-7" />
        </div>

        {/* Entry list */}
        <div className="overflow-y-auto flex-1 pr-0.5">
          {loading ? (
            <p className="text-sm text-gray-400 text-center py-8">読み込み中...</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {displayedEntries.map(entry => (
                <div key={entry.id} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={entry.term}
                    onChange={e => handleChange(entry.id, 'term', e.target.value)}
                    placeholder="社名・人名など"
                    className="flex-1 text-sm border border-gray-300 rounded px-2 h-8 focus:outline-none focus:border-blue-400"
                  />
                  <input
                    type="text"
                    value={entry.reading}
                    onChange={e => handleChange(entry.id, 'reading', e.target.value)}
                    placeholder="例：ミクシィ"
                    className="flex-1 text-sm border border-gray-300 rounded px-2 h-8 focus:outline-none focus:border-blue-400"
                  />
                  <button
                    onClick={() => handleDelete(entry.id)}
                    className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-red-500 rounded hover:bg-red-50 transition-colors shrink-0 text-base leading-none"
                    aria-label="削除"
                  >
                    ×
                  </button>
                </div>
              ))}
              {!filter.trim() && entries.length < MAX_ENTRIES && (
                <button
                  onClick={handleAdd}
                  className="mt-1 text-sm text-blue-500 hover:text-blue-700 text-left px-0.5 py-1"
                >
                  + 用語を追加
                </button>
              )}
              {entries.length >= MAX_ENTRIES && (
                <p className="text-xs text-gray-400 text-center py-2">最大{MAX_ENTRIES}件に達しました</p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 mt-4">
          <div className="flex items-center justify-between w-full">
            <span className="text-xs text-gray-400">{filledCount} / {MAX_ENTRIES} 件</span>
            <Button onClick={handleSave} disabled={loading || saving}>
              {saving ? '保存中...' : '保存して閉じる'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
