# framelab.dev

The Framelab website. An ordinary Next.js app — not part of the npm workspace,
so a root `npm install` doesn't touch it.

```sh
npm install
npm run dev      # http://localhost:3134
```

## Changelog

`/changelog` renders the repository's `CHANGELOG.md`, read at build time by
`lib/changelog.ts`. The file is the source of truth — it's what npm consumers
see on GitHub — so there is no second copy to drift.

That means **the site must be built with the repository as the deploy root**,
not `site/` in isolation, or `../CHANGELOG.md` won't resolve. On Vercel: set
the project's Root Directory to `site` (Vercel still checks out the whole
repo, so the parent path is present).

## Tests

```sh
npm test
```

Covers `lib/changelog.ts` — the only real logic here. A parser mistake still
renders a page, just with backticks showing through or a line quietly missing,
so it is worth asserting rather than eyeballing.

## Editing the site with Framelab

`babel.config.js` and `.env.development` are already wired, so:

```sh
npm run dev                                    # terminal 1
npx framelab --root . --app-url http://localhost:3134   # terminal 2
```
