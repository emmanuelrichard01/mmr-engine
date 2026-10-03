'use client';

import { Dialog } from '@/components/dialog';
import { NAV_ITEMS } from '@/lib/nav';
import { useModKey } from './mod-key';

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {keys.map((k, i) =>
        k === 'then' ? (
          <span key={i} className="text-[12px] text-fg-subtle">
            then
          </span>
        ) : (
          <kbd key={i} className="kbd">
            {k}
          </kbd>
        ),
      )}
    </span>
  );
}

function Group({ title, rows }: { title: string; rows: [string, string[]][] }) {
  return (
    <section>
      <h3 className="mb-1 text-[12.5px] font-semibold text-fg">{title}</h3>
      <dl>
        {rows.map(([label, keys]) => (
          <div key={label} className="flex items-center justify-between gap-4 py-1.5">
            <dt className="text-[13px] text-fg-muted">{label}</dt>
            <dd>
              <Keys keys={keys} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const mod = useModKey();
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts" className="max-w-[680px]">
      <div className="grid max-h-[70vh] gap-x-10 gap-y-6 overflow-y-auto px-6 pb-6 pt-4 sm:grid-cols-2">
        <div className="space-y-6">
          <Group
            title="Everywhere"
            rows={[
              ['Command palette and search', [mod, 'K']],
              ['This list', ['?']],
              ['Close a panel or dialog', ['Esc']],
            ]}
          />
          <Group title="Go to" rows={NAV_ITEMS.map((n) => [n.label, ['G', 'then', n.key.toUpperCase()]])} />
        </div>
        <div className="space-y-6">
          <Group
            title="Inbox"
            rows={[
              ['Next / previous discrepancy', ['J', 'K']],
              ['Open in the detail pane', ['Enter']],
              ['Select / deselect', ['X']],
              ['Select all on this page', ['Shift', 'X']],
              ['Resolve', ['E']],
              ['Mark as false positive', ['Shift', 'E']],
              ['Clear selection, close detail', ['Esc']],
            ]}
          />
          <Group
            title="Tables"
            rows={[
              ['Focus the search field', ['/']],
              ['Next / previous row', ['J', 'K']],
              ['Open the row', ['Enter']],
            ]}
          />
        </div>
      </div>
    </Dialog>
  );
}
