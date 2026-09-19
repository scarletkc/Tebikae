import { Archive, NotebookPen, Search, Settings, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Command, CommandDialog, CommandInput, CommandItem, CommandList } from '../components/ui/command';

export default function CommandPalette({
  open,
  onOpenChange,
  onNewNote,
  onNavigate,
  onSearch,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onNewNote(): void;
  onNavigate(path: string): void;
  onSearch(query: string): void;
}) {
  const { t } = useTranslation();
  const run = (action: () => void) => {
    action();
    onOpenChange(false);
  };
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title={t('home.search')}>
      <Command>
        <CommandInput
          autoFocus
          placeholder={t('home.search')}
          aria-label={t('home.search')}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              const target = event.currentTarget as HTMLInputElement;
              run(() => onSearch(target.value));
            }
          }}
        />
        <CommandList>
          <CommandItem onClick={() => run(onNewNote)}>
            <NotebookPen size={17} />
            {t('action.new')}
            <kbd>⌘/Ctrl N</kbd>
          </CommandItem>
          <CommandItem onClick={() => run(() => onSearch(''))}>
            <Search size={17} />
            {t('home.search')}
            <kbd>Enter</kbd>
          </CommandItem>
          <CommandItem onClick={() => run(() => onNavigate('/notes'))}>
            <NotebookPen size={17} />
            {t('nav.notes')}
          </CommandItem>
          <CommandItem onClick={() => run(() => onNavigate('/archive'))}>
            <Archive size={17} />
            {t('nav.archive')}
          </CommandItem>
          <CommandItem onClick={() => run(() => onNavigate('/trash'))}>
            <Trash2 size={17} />
            {t('nav.trash')}
          </CommandItem>
          <CommandItem onClick={() => run(() => onNavigate('/settings'))}>
            <Settings size={17} />
            {t('nav.settings')}
          </CommandItem>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
