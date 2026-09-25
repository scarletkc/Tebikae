import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { NOTE_COLORS, type Label, type NoteFilters } from '../../domain/types';
import { defaultFilters } from '../../domain/filters';
import { Button, Dialog } from '../../ui';
import { LabelBadge, LabelDot, labelStyle } from '../labels';

export function filterCount(f: NoteFilters) {
  return (
    f.labelIds.length +
    f.colors.length +
    f.kinds.length +
    Number(f.unlabeledOnly) +
    Number(f.pinned !== 'all') +
    Number(f.unsyncedOnly) +
    Number(!!f.createdFrom) +
    Number(!!f.createdTo) +
    Number(!!f.updatedFrom) +
    Number(!!f.updatedTo)
  );
}
export function FilterChips({
  filters: f,
  setFilters,
  labels,
}: {
  filters: NoteFilters;
  setFilters(f: NoteFilters): void;
  labels: Label[];
}) {
  const { t } = useTranslation();
  const chips: { name: string; color?: string; clear(): void }[] = [
    ...f.labelIds.map((id) => ({
      name: labels.find((l) => l.id === id)?.name || `#${id}`,
      color: labels.find((l) => l.id === id)?.color,
      clear: () => setFilters({ ...f, labelIds: f.labelIds.filter((x) => x !== id) }),
    })),
    ...f.colors.map((color) => ({
      name: t(`color.${color}`),
      clear: () => setFilters({ ...f, colors: f.colors.filter((x) => x !== color) }),
    })),
    ...f.kinds.map((kind) => ({
      name: t(`filter.${kind}`),
      clear: () => setFilters({ ...f, kinds: f.kinds.filter((x) => x !== kind) }),
    })),
  ];
  if (f.unlabeledOnly)
    chips.push({ name: t('filter.unlabeled'), clear: () => setFilters({ ...f, unlabeledOnly: false }) });
  if (f.unsyncedOnly)
    chips.push({ name: t('filter.unsynced'), clear: () => setFilters({ ...f, unsyncedOnly: false }) });
  if (f.pinned !== 'all')
    chips.push({
      name: t(`filter.${f.pinned === 'pinned' ? 'pinnedOnly' : 'unpinnedOnly'}`),
      clear: () => setFilters({ ...f, pinned: 'all' }),
    });
  for (const key of ['createdFrom', 'createdTo', 'updatedFrom', 'updatedTo'] as const)
    if (f[key])
      chips.push({
        name: `${t(key.startsWith('created') ? 'filter.created' : 'filter.updated')} ${t(key.endsWith('From') ? 'filter.from' : 'filter.to')}: ${f[key]}`,
        clear: () => setFilters({ ...f, [key]: undefined }),
      });
  return chips.length ? (
    <div className="filter-chips">
      {chips.map((chip, i) => {
        const label = chip.color === undefined ? undefined : { name: chip.name, color: chip.color };
        return (
          <button
            key={i}
            className={label ? 'chip chip-label' : 'chip'}
            style={labelStyle(chip.color)}
            onClick={chip.clear}
            aria-label={t('filter.remove', { name: chip.name })}
          >
            {label && <LabelDot color={chip.color} />}
            {chip.name}
            <X size={12} />
          </button>
        );
      })}
    </div>
  ) : null;
}
export function FiltersDialog({
  filters: f,
  setFilters,
  labels,
  onClose,
}: {
  filters: NoteFilters;
  setFilters(f: NoteFilters): void;
  labels: Label[];
  onClose(): void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog title={t('action.filter')} onClose={onClose} className="filters-dialog">
      <div className="filter-fields">
        <fieldset>
          <legend>{t('filter.labels')}</legend>
          <select
            aria-label={t('filter.labels')}
            value={f.labelMatch}
            onChange={(e) => setFilters({ ...f, labelMatch: e.target.value as 'all' | 'any' })}
          >
            <option value="all">{t('filter.allLabels')}</option>
            <option value="any">{t('filter.anyLabels')}</option>
          </select>
          <div className="choices">
            {labels.map((label) => (
              <label key={label.id}>
                <input
                  type="checkbox"
                  checked={f.labelIds.includes(label.id)}
                  onChange={() =>
                    setFilters({
                      ...f,
                      unlabeledOnly: false,
                      labelIds: f.labelIds.includes(label.id)
                        ? f.labelIds.filter((id) => id !== label.id)
                        : [...f.labelIds, label.id],
                    })
                  }
                />
                <LabelBadge label={label} />
              </label>
            ))}
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={f.unlabeledOnly}
              onChange={(e) => setFilters({ ...f, unlabeledOnly: e.target.checked, labelIds: [] })}
            />
            {t('filter.unlabeled')}
          </label>
        </fieldset>
        <fieldset>
          <legend>{t('filter.colors')}</legend>
          <div className="choices">
            {NOTE_COLORS.map((color) => (
              <label key={color} className={`color-choice note-${color}`}>
                <input
                  type="checkbox"
                  checked={f.colors.includes(color)}
                  onChange={() =>
                    setFilters({
                      ...f,
                      colors: f.colors.includes(color)
                        ? f.colors.filter((x) => x !== color)
                        : [...f.colors, color],
                    })
                  }
                />
                {t(`color.${color}`)}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>{t('filter.kinds')}</legend>
          <div className="choices">
            {(['markdown', 'checklist'] as const).map((kind) => (
              <label key={kind}>
                <input
                  type="checkbox"
                  checked={f.kinds.includes(kind)}
                  onChange={() =>
                    setFilters({
                      ...f,
                      kinds: f.kinds.includes(kind) ? f.kinds.filter((x) => x !== kind) : [...f.kinds, kind],
                    })
                  }
                />
                {t(`filter.${kind}`)}
              </label>
            ))}
          </div>
        </fieldset>
        <label>
          {t('filter.pinned')}
          <select
            value={f.pinned}
            onChange={(e) => setFilters({ ...f, pinned: e.target.value as NoteFilters['pinned'] })}
          >
            <option value="all">{t('filter.any')}</option>
            <option value="pinned">{t('filter.pinnedOnly')}</option>
            <option value="unpinned">{t('filter.unpinnedOnly')}</option>
          </select>
        </label>
        {(['created', 'updated'] as const).map((field) => (
          <fieldset key={field}>
            <legend>{t(`filter.${field}`)}</legend>
            <div className="date-fields">
              <label>
                {t('filter.from')}
                <input
                  type="date"
                  aria-label={`${t(`filter.${field}`)} ${t('filter.from')}`}
                  value={f[`${field}From`] || ''}
                  max={f[`${field}To`]}
                  onChange={(e) => setFilters({ ...f, [`${field}From`]: e.target.value || undefined })}
                />
              </label>
              <label>
                {t('filter.to')}
                <input
                  type="date"
                  aria-label={`${t(`filter.${field}`)} ${t('filter.to')}`}
                  value={f[`${field}To`] || ''}
                  min={f[`${field}From`]}
                  onChange={(e) => setFilters({ ...f, [`${field}To`]: e.target.value || undefined })}
                />
              </label>
            </div>
          </fieldset>
        ))}
        <label className="check-label">
          <input
            type="checkbox"
            checked={f.unsyncedOnly}
            onChange={(e) => setFilters({ ...f, unsyncedOnly: e.target.checked })}
          />
          {t('filter.unsynced')}
        </label>
        <Button onClick={() => setFilters({ ...defaultFilters, view: f.view })}>{t('action.clear')}</Button>
      </div>
    </Dialog>
  );
}
