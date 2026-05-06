# Options Snapshot

Use when the user asks for options volatility context.

1. Resolve the underlying symbol.
2. Fetch available options/IV endpoints exposed by the Worker.
3. If expiration is missing, ask for the expiration after listing available choices.
4. Summarize term structure, skew, and any missing access limitations.
