# Getting Started

## Prerequisites

- Node.js 20+
- PostgreSQL 16
- Docker (optional)

## Installation

```bash
# Install dependencies
npm install

# Configure
cp config.yaml.example config.yaml   # edit database, secret, etc.

# Run migrations
npx prisma migrate dev

# Start development server
npm run start:dev
```

- API: [http://localhost:3042](http://localhost:3042)
- Swagger UI: [http://localhost:3042/api](http://localhost:3042/api)

## Docker

```bash
docker-compose up -d
```

Starts the node server alongside PostgreSQL automatically.

## Configuration

Edit `config.yaml`:

```yaml
server:
  port: 3042
  secret: "change-me"
database:
  url: "postgresql://user:password@localhost:5432/nox"
storage:
  path: "./assets"
```
