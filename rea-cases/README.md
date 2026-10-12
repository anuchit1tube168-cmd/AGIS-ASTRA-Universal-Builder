# REA Cases

This directory stores **sanitized analytical notes only** for authorized REA Scout cases.

Allowed content:
- authorization metadata
- evidence notes and hashes
- architecture models
- feature maps
- risk registers
- clean-room implementation plans
- extracted skills

Do not commit:
- raw binaries or application packages
- archives or memory captures
- credentials, tokens, cookies, keys, or session material
- personal data
- proprietary source code or private assets

Create a case with:

```bash
npm run rea:new-case -- <case-name> --authorized --type=<type> --target=<reference>
```

Run `npm run rea:guard` before committing any case updates.
