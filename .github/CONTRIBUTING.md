# Contributing

Flint is a desktop app. The window is the product. The site in `site/` is the page at [kolan51.github.io/flint](https://kolan51.github.io/flint/).

## Run it

```bash
npm install
npm run desktop
```

`npm test` runs the server checks in `server/gaps.test.js`.

## What not to commit

`data/*.json` is your machine: model addresses, agents, chats. It is gitignored. Leave it that way. Do not paste a settings file into an issue. A model address or a Brave key does not belong on the issue tracker.

## Releases

A `v*` tag builds Windows, macOS, and Ubuntu, then publishes the installers. Do not attach a binary you built by hand and call it the Mac or Ubuntu release. Those files come from the runners.
