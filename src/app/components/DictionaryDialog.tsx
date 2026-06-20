import React, { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';

export const DICTIONARY_STORAGE_KEY = 'speechflow-dictionary-terms';
const TERM_COUNT = 100;
const DEFAULT_TERMS = ['カミナシ', 'インフォバーン', 'MIXI', 'Muture', 'GMOメディア'];
const DICTIONARY_API = '/api/dictionary';

async function fetchTermsFromServer(): Promise<string[] | null> {
  try {
    const res = await fetch(DICTIONARY_API, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data.terms)) return null;
    const filled = (data.terms as unknown[]).filter((t): t is string => typeof t === 'string' && t.trim() !== '');
    return filled.length > 0 ? filled : null;
  } catch {
    return null;
  }
}

async function saveTermsToServer(terms: string[]): Promise<boolean> {
  try {
    const res = await fetch(DICTIONARY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ terms }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function loadDictionaryTerms(): Promise<string[]> {
  const serverTerms = await fetchTermsFromServer();
  if (serverTerms && serverTerms.length > 0) return serverTerms;
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(DICTIONARY_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const terms = (parsed as unknown[]).filter((t): t is string => typeof t === 'string' && t.trim() !== '');
          if (terms.length > 0) return terms;
        }
      }
    } catch { /* ignore */ }
  }
  return DEFAULT_TERMS;
}

function buildRawTerms(saved: string[]): string[] {
  const terms = saved.slice(0, TERM_COUNT).map(t => (typeof t === 'string' ? t : ''));
  while (terms.length < TERM_COUNT) terms.push('');
  return terms;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function DictionaryDialog({ open, onClose }: Props) {
  const [terms, setTerms] = useState<string[]>(() => Array(TERM_COUNT).fill(''));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const isSavingRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setSaveError(false);
    setLoading(true);
    fetchTermsFromServer().then(serverTerms => {
      if (serverTerms && serverTerms.length > 0) {
        setTerms(buildRawTerms(serverTerms));
      } else {
        if (typeof window !== 'undefined') {
          try {
            const stored = localStorage.getItem(DICTIONARY_STORAGE_KEY);
            if (stored) {
              const parsed = JSON.parse(stored) as unknown[];
              if (Array.isArray(parsed)) {
                const filtered = parsed.filter((t): t is string => typeof t === 'string' && t.trim() !== '');
                if (filtered.length > 0) {
                  setTerms(buildRawTerms(filtered));
                  return;
                }
              }
            }
          } catch { /* ignore */ }
        }
        setTerms(buildRawTerms(DEFAULT_TERMS));
      }
    }).finally(() => setLoading(false));
  }, [open]);

  const handleChange = (index: number, value: string) => {
    setTerms(prev => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const handleSave = async () => {
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    setSaving(true);
    setSaveError(false);
    const trimmed = terms.map(t => t.trim());
    localStorage.setItem(DICTIONARY_STORAGE_KEY, JSON.stringify(trimmed));
    const ok = await saveTermsToServer(trimmed);
    setSaving(false);
    isSavingRef.current = false;
    if (!ok) {
      setSaveError(true);
      return;
    }
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v && !isSavingRef.current) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>用語辞書（共有）</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-gray-500 shrink-0">
          正しく書き起こしたい社名・人名などを登録してください。DeepgramとOpenAIの両方に反映されます（最大{TERM_COUNT}件）。<br />
          <span className="text-blue-500">登録した内容はすべてのユーザーで共有されます。</span>
        </p>
        {saveError && (
          <p className="text-sm text-red-500 shrink-0 mt-1">
            サーバーへの保存に失敗しました。ネットワークを確認してください。
          </p>
        )}
        <div className="overflow-y-auto flex-1 mt-2">
          {loading ? (
            <p className="text-sm text-gray-400 text-center py-8">読み込み中...</p>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {terms.map((term, i) => (
                <input
                  key={i}
                  type="text"
                  value={term}
                  onChange={e => handleChange(i, e.target.value)}
                  placeholder={`用語 ${i + 1}`}
                  className="text-sm border border-gray-300 rounded px-2 h-8 focus:outline-none focus:border-blue-400"
                />
              ))}
            </div>
          )}
        </div>
        <DialogFooter className="shrink-0 mt-4">
          <Button onClick={handleSave} disabled={loading || saving}>
            {saving ? '保存中...' : '保存して閉じる'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
