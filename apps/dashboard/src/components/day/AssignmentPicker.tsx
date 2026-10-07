'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { filterAssignmentGroups, type AssignmentGroup } from '../../lib/entry-form';

type Option = AssignmentGroup['options'][number];

const NO_PROJECT: Option = { value: '', label: 'No project' };

/** The label with each searched word marked, so it is clear why a row matched. */
function highlight(label: string, query: string) {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return label;
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const parts = label.split(new RegExp(`(${escaped.join('|')})`, 'gi'));
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="text-text rounded-sm bg-transparent font-semibold">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

/**
 * The "Assign to" field as a searchable list instead of a native <select>.
 *
 * Every project expands into its subprojects and their tasks, so the flat list runs long; a
 * native select cannot be searched. This keeps the same contract — one hidden input named
 * `assignment` carrying the encoded value — so the Server Action and its validation are
 * untouched. The filtering itself lives in `filterAssignmentGroups`, where it is unit-tested.
 *
 * Escape while the list is open closes only the list (see the effect below), so the
 * surrounding form, which collapses on Escape, stays open.
 */
export function AssignmentPicker({
  groups,
  recent,
  defaultValue,
}: {
  groups: AssignmentGroup[];
  /** Shown above everything else while the search is empty. */
  recent: Option[];
  defaultValue: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const sections = useMemo(() => {
    const filtered = filterAssignmentGroups(groups, query);
    const list: { label: string | null; options: Option[] }[] = [];
    if (query.trim() === '') {
      list.push({ label: null, options: [NO_PROJECT] });
      if (recent.length > 0) list.push({ label: 'Recent', options: recent });
    }
    for (const g of filtered) list.push({ label: g.label, options: g.options });
    return list;
  }, [groups, recent, query]);

  // One flat sequence for the arrow keys. A recent appears twice (Recent + its project), so
  // positions — not values — identify the highlighted row.
  const flat = useMemo(() => sections.flatMap((s) => s.options), [sections]);

  const selectedLabel = useMemo(() => {
    if (value === '') return NO_PROJECT.label;
    for (const g of groups) {
      const o = g.options.find((opt) => opt.value === value);
      if (o) return `${g.label} › ${o.label}`;
    }
    return 'Current assignment';
  }, [groups, value]);

  // Escape closes only the list. Bound natively on the search box rather than through React's
  // onKeyDown: Next mounts React on `document`, the same node the enclosing form's own
  // Escape listener sits on, so a React-level stopPropagation cannot keep the form from
  // collapsing too. Stopping it here, below document, does.
  useEffect(() => {
    const search = searchRef.current;
    if (!open || !search) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    search.addEventListener('keydown', onKey);
    return () => search.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  // Keep the highlighted row in view as the arrow keys move it.
  useEffect(() => {
    if (!open) return;
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open, listId]);

  function openList() {
    setQuery('');
    setActive(0);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function choose(option: Option) {
    setValue(option.value);
    close();
  }

  function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      // Never submit the form from the search box.
      e.preventDefault();
      const option = flat[active];
      if (option) choose(option);
    }
  }

  let index = -1;

  return (
    <div
      ref={rootRef}
      className="relative flex flex-col gap-1"
      // Tabbing out of the search box closes the list rather than leaving it over the Note field.
      onBlur={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <span className="text-caption text-text-secondary" id={`${listId}-label`}>
        Assign to
      </span>
      <input type="hidden" name="assignment" value={value} />
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${listId}-label ${listId}-value`}
        onClick={() => (open ? setOpen(false) : openList())}
        className="border-separator bg-surface text-text flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left text-[13px]"
      >
        <span id={`${listId}-value`} className="truncate">
          {selectedLabel}
        </span>
        <span aria-hidden className="text-text-secondary">
          ▾
        </span>
      </button>

      {open ? (
        <div className="border-separator bg-surface-raised absolute top-full right-0 left-0 z-20 mt-1 flex flex-col rounded-md border shadow-lg">
          <input
            ref={searchRef}
            type="text"
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={flat.length > 0 ? `${listId}-${active}` : undefined}
            aria-label="Search projects"
            placeholder="Search projects, work types, tasks…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onSearchKey}
            className="border-separator bg-surface text-text m-1.5 rounded-md border px-2.5 py-1.5 text-[13px]"
          />
          <ul
            id={listId}
            role="listbox"
            // Not a Tab stop: Chrome makes a scrollable box focusable, which would trap Tab inside
            // the picker. The search box owns the keyboard (arrows + aria-activedescendant).
            tabIndex={-1}
            className="max-h-64 overflow-y-auto pb-1.5"
          >
            {flat.length === 0 ? (
              <li className="text-caption text-text-secondary px-3 py-2">No matches</li>
            ) : (
              sections.map((s, si) => (
                <li key={`${s.label ?? ''}-${si}`} role="presentation">
                  {s.label ? (
                    <div className="text-caption text-text-secondary px-3 pt-2 pb-1 font-medium">
                      {s.label}
                    </div>
                  ) : null}
                  <ul role="group" aria-label={s.label ?? undefined}>
                    {s.options.map((o) => {
                      index += 1;
                      const i = index;
                      return (
                        <li
                          key={`${o.value}-${i}`}
                          id={`${listId}-${i}`}
                          role="option"
                          aria-selected={o.value === value}
                          // Keep focus in the search box; the click still selects.
                          onMouseDown={(e) => e.preventDefault()}
                          onMouseEnter={() => setActive(i)}
                          onClick={() => choose(o)}
                          className={`cursor-pointer px-3 py-1.5 text-[13px] ${
                            i === active ? 'bg-hover' : ''
                          } ${o.value === value ? 'text-accent font-medium' : 'text-text'}`}
                        >
                          {highlight(o.label, query)}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
