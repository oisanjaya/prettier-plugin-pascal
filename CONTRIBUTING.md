# Contributing to prettier-plugin-pascal

First off, **thank you** for considering contributing!  
This plugin exists because people like you believe that Pascal code deserves the same love and consistency as any modern language. Whether you're fixing a bug, adding a new syntax feature, or improving the documentation – every bit helps.

---

## Where to start?

- Check the [open issues](https://github.com/oisanjaya/prettier-plugin-pascal/issues).
- If you have an idea for a new feature, open a discussion first – we'd love to hear it.
- Found a formatting bug? Please open an issue with a minimal code sample that reproduces the problem.

---

## Development Setup

We use **Node.js** (>= 22) and **npm** (or pnpm/yarn). Here's how to get started:

```bash
git clone https://github.com/oisanjaya/prettier-plugin-pascal.git
cd prettier-plugin-pascal
npm install          # or pnpm install / yarn install
```

## Submitting your changes

Fork the repo and create your branch from main. Write tests for your changes (if applicable). Ensure all tests pass locally, run `npm run test`.

Commit messages: use the Conventional Commits format (e.g., feat: support generic type parameters). Push to your fork and open a pull request – describe what you did and why.

We'll review as soon as possible. Feedback is always constructive and friendly.

## Coding Style

Use TypeScript with strict types. Avoid unnecessary state – favour pure functions. Use descriptive variable names (no single letters except in loops). Format your code using Prettier, we are developing Prettier plugin aren't we?

## If you're passionate about Pascal, this is your chance to make it shine again!
