# Issue pagination, search and labels

Ordinary startup reads the newest repository Issues page (`state=all`, `sort=created`,
`direction=desc`, `per_page=100`). It does not scan the entire repository or infer
that unseen Issues were deleted. Periodic synchronization still uses the incremental
`since` cursor. Explicit full scans remain available for uncertain-create and
uncertain-delete recovery; browsing never advances that recovery checkpoint.
`initialPageLoaded` records that startup has usable data without falsely marking a
partial cache as a complete repository backup. Pending purges still trigger a full
recovery scan. Uncertain creates follow the persisted discovery schedule in the
[sync protocol](protocol.md#持久化同步重试).

Each fetched page is ingested through `SyncEngine` in a single Dexie transaction.
The first 25 matching cards are rendered. Scrolling past about 65% of the displayed
content, or within 2.5 viewports of its bottom, prefetches a further 100 Issues when
the buffer is running low. Within one viewport of the bottom, another 25 cached
cards are revealed. The load-more button uses the same buffer. Slow requests show
three small placeholders below existing cards only when the display buffer is empty.
Offline mode continues browsing and searching the already cached notes.

Typing changes only the input draft. Blur submits the trimmed text; Enter blurs the
input (except during IME composition). Submitting the same text and conditions is a
no-op. Changing submitted text or filters cancels the old request and creates a fresh
pagination session. Online text searches use GitHub's Issues Search API, scoped to
the connected repository, Issues only, and title/body text. Metadata filters remain
local and pages are fetched until enough matching notes are available. Sidebar
counts and offline results describe the cached subset, not a repository-wide total.
Page and search requests share the sync engine's persisted server cooldown.

Search pages contain at most 100 results. Queries with more than 1,000 matches are
split recursively into non-overlapping `created` ranges, newest first, at second
precision. Results are deduplicated by Issue ID, and failed pages can be retried.
Incomplete API responses are surfaced as errors instead of being accepted as complete.
GitHub cannot time-split more than 1,000 matches created in one identical second;
that case explicitly asks for narrower search text rather than silently truncating.
See the [GitHub Search API documentation](https://docs.github.com/en/rest/search/search)
for the 1,000-result ceiling.

Pagination and search preserve `current` when a note is being edited, has an Outbox
entry, is not synced, or differs from its base. They still record the remote snapshot
for existing merge/conflict recovery. Older remote snapshots cannot replace a newer
one. Cancelled or expired sessions cannot commit a page transaction.

Label creation first compares trimmed names case-insensitively against local labels,
then a refreshed repository list. An existing label is reused and cached without
POSTing a repository label. A 422 during creation triggers one further list refresh
and same-name lookup, with the original error preserved if no match exists.
Adding/removing a note label uses Issue label associations through the Outbox.
Only the explicit label-management delete operation deletes the repository label.
Its confirmation states that all using notes lose the label while the notes remain.
Deletion clears local note label IDs, baselines and queued snapshots, invalidates
the HTTP cache, and prevents in-flight page responses from restoring the deleted ID.

Editor changes use a short IndexedDB debounce only. The open editor is marked in the
sync engine, so background polling and online retry skip its pending Outbox entry.
The retry scheduler also excludes these writes until the editor closes; read-only
discovery of an uncertain creation remains allowed. Closing rebuilds the wakeup
from the existing retry deadline rather than resetting the wait.
Closing the editor or moving to the previous/next note persists the final document
and calls `flushNote(localId)`, which writes only that note. The editor save button
and Ctrl/Cmd+S use the same immediate per-note path. An unchanged note has no Outbox
intent; if an edit is undone to its remote baseline before closing, the pending update
is removed without a PATCH. Browser close and offline transitions persist local data
but do not force a GitHub request. The Outbox remains available for the next online
retry or an explicit workspace sync.
