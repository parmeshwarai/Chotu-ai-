import React, { useState } from 'react';
import { deleteDoc, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { Brain, Plus, Power, Trash2 } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { UserMemory, UserProfile } from '../types';

interface Props {
  profile: UserProfile;
  memories: UserMemory[];
}

export function MemoryManager({ profile, memories }: Props) {
  const [content, setContent] = useState('');
  const [category, setCategory] = useState<UserMemory['category']>('preference');
  const [saving, setSaving] = useState(false);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    setSaving(true);
    const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    try {
      await setDoc(doc(db, 'memories', id), {
        id,
        userId: profile.uid,
        content: content.trim().slice(0, 1000),
        category,
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setContent('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `memories/${id}`);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (mem: UserMemory) => {
    try {
      await updateDoc(doc(db, 'memories', mem.id), {
        active: !mem.active,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `memories/${mem.id}`);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'memories', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `memories/${id}`);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-4">
        <div className="flex items-center gap-3">
          <Brain className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          <div>
            <h1 className="font-display text-xl font-semibold">AI Memory Control</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Active memories are included as context in your Chhotu AI conversations. Pause or delete anytime.
            </p>
          </div>
        </div>

        <form onSubmit={handleAdd} className="grid sm:grid-cols-12 gap-3 pt-2">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as UserMemory['category'])}
            className="sm:col-span-3 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
          >
            <option value="preference">Preference</option>
            <option value="fact">Personal Fact</option>
            <option value="project">Project Context</option>
            <option value="style">Tone & Style</option>
          </select>
          <input
            type="text"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="e.g., Always explain TypeScript examples in simple Hindi + English..."
            className="sm:col-span-7 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
          <button
            type="submit"
            disabled={saving}
            className="sm:col-span-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            Save
          </button>
        </form>
      </div>

      <div className="space-y-3">
        {memories.length === 0 ? (
          <div className="p-8 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] text-center text-sm text-slate-500 dark:text-slate-400">
            No memories saved yet. Add your first preference or project fact above.
          </div>
        ) : (
          memories.map((mem) => (
            <div
              key={mem.id}
              className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] flex items-center justify-between gap-4"
            >
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 capitalize">
                  <span>{mem.category}</span>
                  <span aria-hidden="true">·</span>
                  <span>{mem.active ? 'Active in prompts' : 'Paused'}</span>
                </div>
                <p className="text-sm text-slate-900 dark:text-slate-100 break-words">{mem.content}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => void toggleActive(mem)}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 ${
                    mem.active
                      ? 'border-emerald-600 text-emerald-700 dark:text-emerald-300'
                      : 'border-slate-300 dark:border-slate-700 text-slate-500'
                  }`}
                >
                  <Power className="w-3.5 h-3.5" />
                  {mem.active ? 'Active' : 'Paused'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(mem.id)}
                  aria-label="Delete memory"
                  className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-rose-50 dark:hover:bg-rose-950/50 text-rose-600"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
