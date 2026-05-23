'use client';

import { useEffect, useRef, useState } from 'react';

type Props = {
  name: string | null;
  isCustom: boolean;
  onSave: (next: string) => void;
  onReset: () => void;
};

export default function GuestNameEditor({
  name,
  isCustom,
  onSave,
  onReset,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) {
      setDraft(name ?? '');
      // Focus + select-all happens after the input mounts.
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editing, name]);

  if (!name) {
    // Pre-hydration placeholder keeps layout from jumping.
    return <div className="h-9" aria-hidden />;
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="flex items-center gap-2 self-start rounded-full bg-zinc-900/60 px-3 py-1.5 text-xs text-zinc-300 active:bg-zinc-800"
        aria-label="Name ändern"
      >
        <span aria-hidden>👤</span>
        <span className="font-semibold text-zinc-100">{name}</span>
        <span className="text-zinc-500" aria-hidden>
          ✏️
        </span>
      </button>
    );
  }

  const commit = () => {
    onSave(draft);
    setEditing(false);
  };

  const cancel = () => {
    setEditing(false);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        commit();
      }}
      className="flex items-center gap-2 self-start rounded-full bg-zinc-900 px-3 py-1.5 text-xs ring-1 ring-purple-500/60"
    >
      <span aria-hidden>👤</span>
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') cancel();
        }}
        maxLength={24}
        placeholder="Dein Name"
        className="w-32 bg-transparent text-sm font-semibold text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
      />
      <button
        type="submit"
        className="rounded-full bg-purple-500 px-2 py-0.5 text-xs font-semibold text-white active:bg-purple-400"
      >
        OK
      </button>
      {isCustom && (
        <button
          type="button"
          onClick={() => {
            onReset();
            setEditing(false);
          }}
          className="rounded-full px-2 py-0.5 text-xs text-zinc-400 active:text-zinc-200"
          aria-label="Auf Spitznamen zurücksetzen"
        >
          ↺
        </button>
      )}
    </form>
  );
}
