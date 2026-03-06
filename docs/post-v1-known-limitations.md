# Post-v1 Known Limitations

1. No Web UI. Interaction is TUI or programmatic API only.
2. Only local reference adapters are included. There are no remote task-source or result-store adapters yet.
3. Local suite discovery is filesystem-based only.
4. A selected task executes all of its runs serially. There is no cross-run parallel scheduler in v1.
5. The TUI supports selecting one task at a time. Multi-task selection is not implemented.
6. Observer support is best-effort console output only.
7. `llm-judge` is protocol-tested with mocks, but judge quality is not validated by the framework.
8. Results are stored as local JSON artifacts per run and per trial; there is no large-artifact split storage.
9. There are no dedicated CI reporters or hosted automation helpers.
