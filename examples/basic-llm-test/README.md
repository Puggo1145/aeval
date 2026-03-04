# basic-llm-test

This example shows how to treat `youeval` core as a package and wire your own business provider.

## 1) Prepare env file

```bash
cp examples/basic-llm-test/.env.example examples/basic-llm-test/.env
```

Then edit `examples/basic-llm-test/.env` and set your real `OPENAI_API_KEY`.

## 2) Run

```bash
pnpm example:basic-llm
```

It starts TUI with this example's custom core. In TUI, choose the experiment file in this folder (for example `experiments/smoke.yaml`).
