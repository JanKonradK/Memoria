import * as Dialog from '@radix-ui/react-dialog';
import { HeaderActions } from './HeaderActions';
import { Btn, Segmented, TextInput } from './ui';

export function TimelineTools({
  search,
  onSearch,
  view,
  onView,
  showFinished,
  onShowFinished,
}: {
  search: string;
  onSearch: (value: string) => void;
  view: string;
  onView: (value: string) => void;
  showFinished: boolean;
  onShowFinished: (value: boolean) => void;
}) {
  return (
    <HeaderActions>
      <div data-tour="timeline-tools" className="flex items-center gap-1">
        <Segmented
          ariaLabel="Event view"
          value={view}
          onChange={onView}
          options={[
            { value: 'lanes', label: 'Timeline' },
            { value: 'list', label: 'List' },
          ]}
        />
        <Dialog.Root>
          <Dialog.Trigger asChild>
            <button
              className="shell-control relative"
              aria-label="Find events"
              title={search ? `Filter: ${search}` : 'Find events'}
            >
              <svg className="icon h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
                <circle cx="8.5" cy="8.5" r="5.5" />
                <path d="m13 13 4 4" />
              </svg>
              {search && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-ui-full bg-accent" />}
            </button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-50 bg-scrim/30" />
            <Dialog.Content className="popover-motion fixed right-3 top-[calc(var(--app-bar-h)+8px)] z-50 w-[min(22rem,calc(100vw-24px))] rounded-ui-lg bg-popover p-3 shadow-float ring-1 ring-line-strong">
              <Dialog.Title className="mb-2 text-body font-semibold">Find events</Dialog.Title>
              <Dialog.Description className="sr-only">
                Filter the timeline by event name. The filter stays active when you close this panel.
              </Dialog.Description>
              <TextInput
                aria-label="Search events"
                placeholder="Event name…"
                value={search}
                onChange={(event) => onSearch(event.target.value)}
              />
              <div className="mt-3 flex justify-end gap-2">
                <Btn disabled={!search} onClick={() => onSearch('')}>
                  Clear
                </Btn>
                <Dialog.Close asChild>
                  <Btn>Done</Btn>
                </Dialog.Close>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
        <button
          className={`shell-control ${showFinished ? 'bg-fill-2 !text-fg' : ''}`}
          aria-label="Show finished events"
          aria-pressed={showFinished}
          title={showFinished ? 'Hide finished events' : 'Show finished events'}
          onClick={() => onShowFinished(!showFinished)}
        >
          <svg className="icon h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
            <path d="M3 8a7 7 0 1 1 1 7M3 3v5h5M10 6v4l3 2" />
          </svg>
        </button>
      </div>
    </HeaderActions>
  );
}
