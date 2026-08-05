# Search Capability for AI Thread Kanban Board

Introduce a powerful search capability to the AI thread Kanban board that allows searching for specific text, concepts, and technical areas (like "hubspot stages" or "website structure") within thread metadata and their full transcript logs.

To ensure fast page loads and responsive performance, we will implement an **incremental background search indexer** in the server. This indexer scans the transcript files, extracts raw conversation text, and caches them in `search-index.json`.

---

## Proposed Technical Design

1. **Incremental Search Indexer (`search-index.json`)**:
   - The server maintains a JSON index on disk mapping `thread_id` to its cached `mtime` (modification time), `size` (byte size), and cleaned `transcriptText`.
   - On server startup and during every board `/refresh`, the server asynchronously checks each active thread.
   - If a transcript's size or `mtime` changes (or it's new), we read and parse it using the existing `readTranscript` function, updating the index cache.
   - The index is written back to `search-index.json` under the registry directory. This makes subsequent startups instant!

2. **Search Querying & Multi-word Match**:
   - The user inputs a search string (e.g. `hubspot stages`).
   - The query is tokenized into lowercase terms: `["hubspot", "stages"]`.
   - A thread matches only if **all** terms are present in the unified text (Title + Display Title + Outcome Intent + Notes + Where it Stands + Next Step + Intent Area + Transcript). This allows searching across metadata and transcripts seamlessly in any word order.

3. **Polished Search UI**:
   - Add a premium, modern search bar in the header of both **List View** (`/`) and **Kanban View** (`/kanban`).
   - Support dark mode and glassmorphism styling to wow the user.
   - Retain current filters (Area, Harness, Machine) when searching, and retain the active search when switching views or filtering!

---

## User Review Required

> [!NOTE]
> The search indexer uses the existing `readTranscript` parser. Transcripts can be large, but because of incremental indexing (using `mtime` and file `size`), the disk reading overhead only happens once per transcript update. Startup and standard board refreshes will be extremely fast!

---

## Open Questions

There are no major open questions. The design is straightforward and builds upon the existing board architecture perfectly.

---

## Proposed Changes

### Kanban Board Server

#### [MODIFY] [serve-thread-board.mjs](file:///Users/yuvalyeret/Github/ai-threads-kanban/scripts/serve-thread-board.mjs)

- **Search Indexer state**: Add `_searchIndex` in-memory and write helper logic to load/save `search-index.json`.
- **`rebuildSearchIndex()`**: Async function that performs incremental updates by comparing file stats (`mtime` and `size`).
- **`filterThreads()`**: Update to support tokenized search queries (`q`) over both thread metadata and indexed transcript text.
- **`nav()` & `queryPath()`**: Update to preserve the `q` search parameter across views and refreshes.
- **`renderBoard()` & `renderKanban()`**: Retrieve `q` from search params, pass it to chip bars, and render the premium search bar form.
- **Page Layout & Styles**: Add clean, harmonized CSS styles in the `page()` template for the search input, submit button, clear button, and focus transitions.
- **Client Script**: Add a simple DOM listener to clear search input instantly when clicking the clear button and auto-submit the clean view.

---

## Verification Plan

### Automated Tests
We will verify that the code compiles, parses without syntax errors, and standard tests still pass:
```bash
npm run test
```

### Manual Verification
1. Start the server using `npm run serve` (or `node scripts/serve-thread-board.mjs --dev`).
2. Open `http://127.0.0.1:7878` in a browser.
3. Test searching for "hubspot" or "website structure" and verify that relevant threads are filtered correctly.
4. Verify that active chips (area, harness, machine) are preserved when searching.
5. Verify that clicking the "Kanban view" link preserves the active search query.
6. Verify that clicking the `×` button clears the search query and reloads the board.
