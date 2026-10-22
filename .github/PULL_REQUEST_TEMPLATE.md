**What and why**

**Checklist**

- [ ] `npm run check` passes (with a linked core, after `npm run build` in it)
- [ ] no S.I.R logic in the extension: anything about patches is asked of the core
- [ ] every failure is an exact place, a named approximation or a refusal with a next step
- [ ] a new `sir.*` setting has its `generate.*` config key (E1)
- [ ] the protocol range is compared as a range, never for equality (R9)
- [ ] `README.md` and `README.ru.md` (and `CONTRIBUTING*.md`) changed together, if at all
- [ ] a user-visible change has its line in `CHANGELOG.md` under *Unreleased*
