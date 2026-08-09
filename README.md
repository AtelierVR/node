<div align="center">
  <img src=".github/header.png" width="640" alt="NoxVR" />
  <h1>Node</h1>
  <p>Backend API server for the NoxVR federated social VR platform.</p>

  ![NestJS](https://img.shields.io/badge/NestJS-11-e0234e?logo=nestjs&logoColor=white)
  ![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)
  ![Prisma](https://img.shields.io/badge/Prisma-ORM-2d3748?logo=prisma&logoColor=white)
  ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169e1?logo=postgresql&logoColor=white)
  ![Docker](https://img.shields.io/badge/Docker-ready-2496ed?logo=docker&logoColor=white)
  ![License](https://img.shields.io/badge/License-AGPL--3.0-22c55e)

  <p>Part of the <a href="https://github.com/AtelierVR"><strong>NoxVR</strong></a> ecosystem</p>
</div>

---

## Overview

**NoxVR Node** is the central server of the NoxVR platform. It handles authentication, user accounts, worlds, avatars, instances, and server-to-server federation. It exposes a REST API consumed by the frontend and relay clients.

## Features

- **Authentication** — session-based auth with device tracking and server-as-user support
- **Users** — profiles, tags, bio, avatar, banner, follow/unfollow, activity feeds
- **Worlds** — CRUD, thumbnail, asset upload/processing (AssetBundle), tags, contributors
- **Avatars** — CRUD, thumbnail, asset upload/processing per platform
- **Instances** — relay-backed game instances with player tracking
- **Relay Management** — register/control relay servers, send commands, stream logs
- **Storage** — local file provider for thumbnails, banners and asset bundles
- **Fediverse** — NodeInfo, WebFinger, `.well-known/nox` federation endpoints
- **OpenAPI** — auto-generated Swagger spec (`_openapi.yaml`)

## Documentation

- [Getting Started](docs/getting-started.md) — installation, Docker, configuration
- [Scripts & Development](docs/scripts.md) — commands and tests

---

<div align="center">
  <p>Made with ♥ by <a href="https://github.com/AtelierVR">AtelierVR</a> &nbsp;·&nbsp; <a href="https://www.gnu.org/licenses/agpl-3.0">AGPL-3.0</a></p>
  <p>Part of the <strong>NoxVR</strong> project — a federated social VR platform</p>
</div>
