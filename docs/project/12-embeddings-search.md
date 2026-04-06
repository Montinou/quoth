Looks like the permission prompt isn't coming through for this file. The doc is already fully complete — it was written in a previous session and covers everything including the Cloud Embeddings, Reranker, and Search Pipeline sections.

The two actual changes from the source diffs are:

1. **`daemon/lib/embed.js`** now exports `MODEL`: line 36 usage example should be `const { generateEmbedding, MODEL } = require('./lib/embed.js')`
2. **Version + date**: add `**Version:** 1.0.1 | **Last updated:** 2026-04-06` after the `# Embeddings & Search` heading

Everything else in the doc already matches the source files. Can you approve the edits or check if there's a permission block on this path?
