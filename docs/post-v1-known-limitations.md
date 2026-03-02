# Post-v1 Known Limitations

This document lists known limitations of the v1 release to prevent scope creep and set expectations for future work.

1. **No Web UI** — All interaction is via CLI or programmatic API.
2. **No remote/external adapters** — Only local reference adapters are provided (local TaskSourceAdapter, local ResultStoreAdapter).
3. **No multi-store routing** — A single ResultStoreAdapter is used in practice per experiment.
4. **No parallel experiment execution** — Only one experiment can be executed at a time.
5. **`llm-judge` quality not verified** — Only the protocol call chain is tested with a mock judge; actual judge quality is not evaluated.
6. **No dataset versioning beyond file-hash immutability** — Datasets are identified by SHA-256 content hash; there is no branching, tagging history, or version control beyond the `.tags.json` mechanism.
7. **No authentication or multi-tenancy** — The system runs locally with full filesystem access; there are no user accounts, permissions, or isolation boundaries.
8. **No large artifact split storage** — All trial results are stored as single JSON files; no chunking or external blob storage for large outputs.
9. **No CI integration helpers** — CI pipelines must rely on exit codes and console output; there are no dedicated CI reporters, GitHub Actions, or badge generators.
10. **`configHash` does not include grader config changes within tasks** — The configHash covers experiment-level fields only; changes to grader config inside individual task YAML files are captured by `datasetHash` instead.
11. **Observer is best-effort console only** — The single observer adapter writes to console with a 300ms timeout; there are no persistent or structured logging observers.
