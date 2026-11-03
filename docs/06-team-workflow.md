# Team workflow

How changes move from idea to the vouch repository.

## Branches

- `main` is the shared branch.
- Use a short-lived branch per change.

## Changes

- Keep commits focused.
- Open a pull request for review before merging to `main`.
- Update the matching doc in `docs/` when behavior, API, or setup changes.

## Secrets

Do not commit credentials, tokens, or `.env` files. Document variable names in [technical stack and setup](03-technical-stack-and-setup.md).
