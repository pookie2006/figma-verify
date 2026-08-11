# Contributing

Thanks for your interest in improving Figma Verify.

## Getting set up

```bash
cd figma-verify
npm install
npx playwright install chromium
```

Copy `figma-verify/.env.example` to `figma-verify/.env` and add your Figma
personal access token if you want to run against the live Figma API. The
test suite and the demo run entirely offline from recorded fixtures, so no
token is needed for development.

## Running tests

```bash
cd figma-verify
npm test
```

Please make sure tests pass before opening a pull request, and add a test
when you fix a bug or add behavior.

## Guidelines

- Keep changes focused; one topic per pull request.
- Follow the existing TypeScript style in `src/`.
- Never commit real tokens — `.env` is gitignored, and `.cursor/mcp.json`
  must only ever contain the placeholder value.
