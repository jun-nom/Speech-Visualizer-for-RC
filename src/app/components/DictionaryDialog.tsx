import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';

export const DICTIONARY_STORAGE_KEY = 'speechflow-dictionary-terms';
const TERM_COUNT = 100;
const DEFAULT_TERMS = ['カミナシ', 'インフォバーン', 'MIXI', 'Muture', 'GMOメディア'];

export function loadDictionaryTerms(): string[] {
  if (typeof window === 'undefined') return DEFAULT_TERMS;
  try {
    const stored = localStorage.getItem(DICTIONARY_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        const terms = (parsed as unknown[]).filter((t): t is string => typeof t === 'string' && t.trim() !== '');
        return terms.length > 0 ? terms : DEFAULT_TERMS;
      }
    }
  } catch { /* ignore */ }
  return DEFAULT_TERMS;
}

function loadRawTerms(): string[] {
  const base: string[] = [...DEFAULT_TERMS];
  while (base.length < TERM_COUNT) base.push('');

  if (typeof window === 'undefined') return base;
  try {
    const stored = localStorage.getItem(DICTIONARY_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as unknown[];
      if (Array.isArray(parsed)) {
        const terms = parsed.slice(0, TERM_COUNT).map(t => (typeof t === 'string' ? t : ''));
        while (terms.length < TERM_COUNT) terms.push('');
        return terms;
      }
    }
  } catch { /* ignore */ }
  return base;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function DictionaryDialog({ open, onClose }: Props) {
  const [terms, setTerms] = useState<string[]>(() => Array(TERM_COUNT).fill(''));

  useEffect(() => {
    if (open) setTerms(loadRawTerms());
  }, [open]);

  const handleChange = (index: number, value: string) => {
    setTerms(prev => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const handleSave = () => {
    localStorage.setItem(DICTIONARY_STORAGE_KEY, JSON.stringify(terms.map(t => t.trim())));
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleSave(); }}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>用語辞書</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-gray-500 shrink-0">
          正しく書き起こしたい社名・人名などを登録してください。DeepgramとOpenAIの両方に反映されます（最大{TERM_COUNT}件）。
        </p>
        <div className="overflow-y-auto flex-1 mt-2">
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
        </div>
        <DialogFooter className="shrink-0 mt-4">
          <Button onClick={handleSave}>保存して閉じる</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
