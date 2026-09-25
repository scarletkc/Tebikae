import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { NOTE_COLORS, type Label, type NoteFilters } from '../../domain/types';
import { defaultFilters } from '../../domain/filters';
import { Button, Checkbox, CheckboxLabel, Dialog, Field, Input, Select, cn } from '../../ui';
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
      <div className="filter-fields flex flex-col gap-6">
        <fieldset>
          <legend className="mb-3 text-xs font-medium text-muted">{t('filter.labels')}</legend>
          <Select
            className="mb-4"
            aria-label={t('filter.labels')}
            value={f.labelMatch}
            onChange={(e) => setFilters({ ...f, labelMatch: e.target.value as 'all' | 'any' })}
          >
            <option value="all">{t('filter.allLabels')}</option>
            <option value="any">{t('filter.anyLabels')}</option>
          </Select>
          <div className="choices flex flex-wrap gap-x-4 gap-y-2.5">
            {labels.map((label) => (
              <CheckboxLabel key={label.id}>
                <Checkbox
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
              </CheckboxLabel>
            ))}
          </div>
          <CheckboxLabel className="mt-2.5">
            <Checkbox
              checked={f.unlabeledOnly}
              onChange={(e) => setFilters({ ...f, unlabeledOnly: e.target.checked, labelIds: [] })}
            />
            {t('filter.unlabeled')}
          </CheckboxLabel>
        </fieldset>
        <fieldset>
          <legend className="mb-3 text-xs font-medium text-muted">{t('filter.colors')}</legend>
          <div className="choices flex flex-wrap gap-x-4 gap-y-2.5">
            {NOTE_COLORS.map((color) => (
              <label
                key={color}
                className={cn(
                  'color-choice flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs',
                  `note-${color}`,
                )}
              >
                <Checkbox
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
          <legend className="mb-3 text-xs font-medium text-muted">{t('filter.kinds')}</legend>
          <div className="choices flex flex-wrap gap-x-4 gap-y-2.5">
            {(['markdown', 'checklist'] as const).map((kind) => (
              <CheckboxLabel key={kind}>
                <Checkbox
                  checked={f.kinds.includes(kind)}
                  onChange={() =>
                    setFilters({
                      ...f,
                      kinds: f.kinds.includes(kind) ? f.kinds.filter((x) => x !== kind) : [...f.kinds, kind],
                    })
                  }
                />
                {t(`filter.${kind}`)}
              </CheckboxLabel>
            ))}
          </div>
        </fieldset>
        <Field label={t('filter.pinned')}>
          {(id) => (
            <Select
              id={id}
              value={f.pinned}
              onChange={(e) => setFilters({ ...f, pinned: e.target.value as NoteFilters['pinned'] })}
            >
              <option value="all">{t('filter.any')}</option>
              <option value="pinned">{t('filter.pinnedOnly')}</option>
              <option value="unpinned">{t('filter.unpinnedOnly')}</option>
            </Select>
          )}
        </Field>
        {(['created', 'updated'] as const).map((field) => (
          <fieldset key={field}>
            <legend className="mb-3 text-xs font-medium text-muted">{t(`filter.${field}`)}</legend>
            <div className="date-fields grid grid-cols-2 gap-3">
              <Field label={t('filter.from')}>
                {(id) => (
                  <Input
                    id={id}
                    type="date"
                    aria-label={`${t(`filter.${field}`)} ${t('filter.from')}`}
                    value={f[`${field}From`] || ''}
                    max={f[`${field}To`]}
                    onChange={(e) => setFilters({ ...f, [`${field}From`]: e.target.value || undefined })}
                  />
                )}
              </Field>
              <Field label={t('filter.to')}>
                {(id) => (
                  <Input
                    id={id}
                    type="date"
                    aria-label={`${t(`filter.${field}`)} ${t('filter.to')}`}
                    value={f[`${field}To`] || ''}
                    min={f[`${field}From`]}
                    onChange={(e) => setFilters({ ...f, [`${field}To`]: e.target.value || undefined })}
                  />
                )}
              </Field>
            </div>
          </fieldset>
        ))}
        <CheckboxLabel>
          <Checkbox
            checked={f.unsyncedOnly}
            onChange={(e) => setFilters({ ...f, unsyncedOnly: e.target.checked })}
          />
          {t('filter.unsynced')}
        </CheckboxLabel>
        <Button className="self-start" onClick={() => setFilters({ ...defaultFilters, view: f.view })}>
          {t('action.clear')}
        </Button>
      </div>
    </Dialog>
  );
}
