# Checklist: Add Search Capability to Kanban Board

- [x] Define search index paths and memory state
- [x] Implement `rebuildSearchIndex()` incremental indexing function
- [x] Integrate background indexing into registry reload and startup
- [x] Update query filtering in `filterThreads()` to support tokenized search queries (`q`)
- [x] Update chip bars, `queryPath()`, and `nav()` to preserve search query parameters
- [x] Add the search form to List and Kanban views
- [x] Implement clear-button JavaScript for instant search reset
- [x] Add premium responsive styling for search forms and clear buttons
- [x] Verify execution by running unit tests and starting the server
