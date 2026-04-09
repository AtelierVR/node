# Scripts & Development

## Scripts

| Command | Description |
|---|---|
| `npm run start:dev` | Development mode with watch |
| `npm run build` | Compile TypeScript |
| `npm run start:prod` | Production mode |
| `npm run lint` | ESLint |
| `npx prisma migrate dev` | Apply DB migrations |
| `npx ts-node scripts/generate-openapi.ts` | Regenerate `_openapi.yaml` |

## Tests

```bash
npm run lint        # ESLint check
npm run test        # Unit tests
npm run test:e2e    # End-to-end tests
```
