# BookNote-Offline v7.10.138 — Zero-Miss Search Audit Core

## Hard acceptance standard
- Every search phrase occurrence that exists in the authoritative shelf book正文 must be found.
- No occurrence that does not exist may be produced.
- `Missing = 0` and `Extra = 0` are the correctness gate.

## Changes
1. Search no longer applies a book-result limit; the compatibility `limit` argument is ignored for completeness.
2. All occurrences are retained, including overlapping occurrences.
3. Added an independent `referenceScan()` implementation using a separate full-text scan path.
4. Added `verifySearch()` to compare independent expected occurrences against actual search occurrences and report `missing` / `extra`.
5. Final paragraph extraction remains based on authoritative `BookLibraryDB` content.
6. Export and saved summary use the same grouped formatter core.
7. Final text format is:

《书名》
章节：章节名
段落……
              《书名》

8. No separator lines, no numbering, no search metadata.
9. Shelf remains the v7.10.128 behavior baseline; no Reader entry, no Reader opening, and no Reader dependency.

## Validation gate
The package is statically checked and the search/reference harness must pass before a release is considered correctness-complete. A real user's full shelf corpus still requires an in-browser `verifySearch(query)` run to establish empirical zero-miss for that corpus.
