# AI-assisted development guidelines

How to use coding agents on vouch without drifting from the product or leaking private data.

## Working agreement

- Read the relevant file in `docs/` before changing behavior.
- If a change contradicts a written decision, update the doc in the same change or stop and ask.
- Prefer the existing package (`frontend`, `backend`, or `extension`) over inventing a new one.
- Do not invent API routes, schema, or stack choices that are not already in the repo. Record new decisions in `docs/` first.

## Privacy

- Do not paste interview content, credentials, tokens, or real user data into prompts.
- Do not add logging of verification payloads unless [API and database documentation](05-api-and-database-documentation.md) says that data may be stored.

## Reviews

- A generated change still needs a human review against the feature spec.
- Tests or a manual check should cover the path that changed.
- Leave the repository runnable. Do not commit secrets or local environment files.
