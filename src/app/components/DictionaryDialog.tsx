import React, { useState, useEffect, useRef, useCallback, ChangeEvent } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';

export const DICTIONARY_STORAGE_KEY = 'speechflow-dictionary-terms';
const MAX_ENTRIES = 100;
const DICTIONARY_API = '/api/dictionary';
const READING_API = '/api/reading';

export interface StoredEntry {
  term: string;
  reading: string;
}

interface Entry extends StoredEntry {
  id: string;
  insertIndex: number; // for restoring "追加した順": negative = newer (sorts to top)
}

type SortColumn = 'term' | 'reading';
type SortDir = 'desc' | 'asc';

const DEFAULT_ENTRIES: StoredEntry[] = [
  { term: 'カミナシ', reading: 'かみなし' },
  { term: 'インフォバーン', reading: 'いんふぉばーん' },
  { term: 'MIXI', reading: 'みくしぃ' },
  { term: 'Muture', reading: 'みゅーちゃー' },
  { term: 'GMOメディア', reading: 'じーえむおーめでぃあ' },
];

let _nextId = 0;
const nextId = () => String(_nextId++);

// New entries get decreasing (negative) insertIndex so they sort before loaded entries
let _newEntryIdx = -1;
const nextNewIdx = () => _newEntryIdx--;

function katakanaToHiragana(str: string): string {
  return str.replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

function toEntries(stored: StoredEntry[]): Entry[] {
  return stored.map((e, i) => ({
    ...e,
    reading: katakanaToHiragana(e.reading),
    id: nextId(),
    insertIndex: i, // 0-based, ascending = original server order
  }));
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

async function generateReading(term: string): Promise<string> {
  const systemMsg = 'あなたは日本語の専門家です。与えられた用語のひらがな読みのみを返してください。読み仮名以外の文字は一切含めないでください。アルファベットや記号はそのまま読みに変換してください。例：「MIXI」→「みくしぃ」、「富士通」→「ふじつう」';
  const userMsg = `次の用語のひらがな読みを返してください：${term}`;
  const localApiKey = typeof window !== 'undefined' ? (localStorage.getItem('speechflow-openai-key') ?? '') : '';

  if (localApiKey) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${localApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: systemMsg }, { role: 'user', content: userMsg }],
        max_tokens: 60,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error('OpenAI error');
    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message?.content?.trim() ?? '';
  }

  const res = await fetch(READING_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ term }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error('reading API error');
  const data = await res.json() as { reading: string };
  return data.reading;
}

export async function loadDictionaryTerms(): Promise<string[]> {
  const entries = await loadDictionaryEntries();
  return entries.map(e => e.term);
}

export async function loadDictionaryEntries(): Promise<StoredEntry[]> {
  const serverEntries = await fetchEntriesFromServer();
  if (serverEntries && serverEntries.length > 0) return serverEntries;
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(DICTIONARY_STORAGE_KEY);
      if (stored) {
        const entries = normalizeData(JSON.parse(stored));
        if (entries && entries.length > 0) return entries;
      }
    } catch { /* ignore */ }
  }
  return DEFAULT_ENTRIES;
}

function parseCSV(text: string): StoredEntry[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [term = '', reading = ''] = line.split(',').map(s => s.trim());
      return { term, reading: katakanaToHiragana(reading) };
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
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null);
  const [sortDir, setSortDir] = useState<SortDir | null>(null);
  const [importCount, setImportCount] = useState<number | null>(null);
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  const isSavingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setSaveError(false);
    setFilter('');
    setSortColumn(null);
    setSortDir(null);
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

  const handleHeaderClick = useCallback((col: SortColumn) => {
    let newCol: SortColumn | null;
    let newDir: SortDir | null;

    if (sortColumn !== col) {
      newCol = col; newDir = 'desc';
    } else if (sortDir === 'desc') {
      newCol = col; newDir = 'asc';
    } else {
      newCol = null; newDir = null; // clear
    }

    setSortColumn(newCol);
    setSortDir(newDir);
    setEntries(prev => [...prev].sort((a, b) => {
      if (!newCol) return a.insertIndex - b.insertIndex; // restore 追加した順
      const cmp = a[newCol].localeCompare(b[newCol], 'ja');
      return newDir === 'desc' ? -cmp : cmp;
    }));
  }, [sortColumn, sortDir]);

  const handleChange = useCallback((id: string, field: 'term' | 'reading', value: string) => {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e));
  }, []);

  const handleTermBlur = useCallback(async (id: string, term: string, currentReading: string) => {
    if (!term.trim() || currentReading.trim()) return;
    setGeneratingIds(prev => new Set([...prev, id]));
    try {
      const reading = await generateReading(term.trim());
      if (reading) {
        setEntries(prev => prev.map(e =>
          e.id === id && !e.reading.trim() ? { ...e, reading } : e,
        ));
      }
    } catch { /* silently fail */ } finally {
      setGeneratingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, []);

  const handleDelete = useCallback((id: string) => {
    setEntries(prev => prev.filter(e => e.id !== id));
  }, []);

  const handleAdd = useCallback(() => {
    setEntries(prev => {
      if (prev.length >= MAX_ENTRIES) return prev;
      return [{ id: nextId(), term: '', reading: '', insertIndex: nextNewIdx() }, ...prev];
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
          .map(e => ({ ...e, id: nextId(), insertIndex: nextNewIdx() }));
        setImportCount(newEntries.length);
        return [...newEntries, ...prev];
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
    if (!ok) { setSaveError(true); return; }
    onClose();
  };

  const displayedEntries = filter.trim()
    ? entries.filter(e => {
        const q = filter.trim().toLowerCase();
        return e.term.toLowerCase().includes(q) || e.reading.toLowerCase().includes(q);
      })
    : entries;

  const filledCount = entries.filter(e => e.term.trim() !== '').length;

  const headerBtn = (col: SortColumn, label: string) => (
    <button
      onClick={() => handleHeaderClick(col)}
      className="flex items-center gap-1 text-xs text-gray-400 font-medium hover:text-gray-600 select-none"
    >
      {label}
      <span className="w-3 text-center">
        {sortColumn === col ? (sortDir === 'desc' ? '↓' : '↑') : ''}
      </span>
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={v => { if (!v && !isSavingRef.current) { setSaveError(false); onClose(); } }}>
      <DialogContent className="max-w-[63rem] h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>用語辞書（共有）</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-gray-500 shrink-0">
          正しく書き起こしたい社名・人名などを登録してください。DeepgramとOpenAIの両方に反映されます（最大{MAX_ENTRIES}件）。
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

        {/* Toolbar: [+追加] [CSV読み込み] [32px gap] [フィルター] */}
        <div className="flex items-center gap-2 mt-2 shrink-0">
          {entries.length < MAX_ENTRIES && (
            <Button variant="outline" size="sm" onClick={handleAdd} className="shrink-0">
              用語を追加
            </Button>
          )}
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
          <input
            type="text"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="フィルター..."
            className="flex-1 ml-6 text-sm border border-gray-300 rounded px-2 h-8 focus:outline-none focus:border-blue-400"
          />
        </div>

        {/* Column headers (clickable for sort) */}
        <div className="flex items-center gap-2 mt-2 shrink-0 px-0.5">
          <div className="flex-1">{headerBtn('term', '用語')}</div>
          <div className="flex-1">{headerBtn('reading', '読み（ひらがな・任意）')}</div>
          <div className="w-7" />
        </div>

        {/* Entry list */}
        <div className="overflow-y-auto flex-1 pr-0.5">
          {loading ? (
            <p className="text-sm text-gray-400 text-center py-8">読み込み中...</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {displayedEntries.map(entry => {
                const isGenerating = generatingIds.has(entry.id);
                return (
                  <div key={entry.id} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={entry.term}
                      onChange={e => handleChange(entry.id, 'term', e.target.value)}
                      onBlur={e => handleTermBlur(entry.id, e.target.value, entry.reading)}
                      placeholder="社名・人名など"
                      className="flex-1 text-sm border border-gray-300 rounded px-2 h-8 focus:outline-none focus:border-blue-400"
                    />
                    <input
                      type="text"
                      value={entry.reading}
                      onChange={e => handleChange(entry.id, 'reading', e.target.value)}
                      disabled={isGenerating}
                      placeholder={isGenerating ? '生成中...' : '例：みくしぃ'}
                      className="flex-1 text-sm border border-gray-300 rounded px-2 h-8 focus:outline-none focus:border-blue-400 disabled:bg-gray-50 disabled:text-gray-400"
                    />
                    <button
                      onClick={() => handleDelete(entry.id)}
                      className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-red-500 rounded hover:bg-red-50 transition-colors shrink-0 text-base leading-none"
                      aria-label="削除"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
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
