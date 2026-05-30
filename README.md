# mock-factory

Spin up a realistic mock API server from your OpenAPI spec in 5 seconds.

```bash
npx mock-factory ./openapi.yaml
```

That's it. You get a running API with realistic fake data, full CRUD, filtering, and pagination. Zero config.

## Why

You've got an OpenAPI spec and you need to build a frontend. But the API isn't ready yet. So you either:
- Hardcode fake data (breaks when the real API comes)
- Write manual mock handlers (tedious, always out of date)
- Use json-server (flat data, no relationships, boring values)

`mock-factory` reads your spec and generates a proper mock API with smart data — emails look like emails, names look like names, dates are ISO strings.

## Features

- **OpenAPI 3.0 parsing** — YAML or JSON, with `$ref` support
- **Smart data generation** — key-aware (fields named `email` get emails, `name` gets names, `price` gets numbers)
- **Format-aware** — respects `format: email`, `format: uri`, `format: date-time`, etc.
- **Enum support** — picks from your defined enum values
- **Full CRUD** — GET, POST, PUT, PATCH, DELETE out of the box
- **Filtering** — `GET /users?status=active`
- **Pagination** — `GET /users?_limit=10&_page=2`
- **CORS enabled** — works with any frontend
- **Delay simulation** — `--delay 500` to simulate slow APIs
- **Error simulation** — `--error-rate 0.1` for 10% random errors
- **Data persistence** — `--persist data.json` to save between restarts
- **Demo mode** — run without a spec for sample data

## Install

```bash
npm install -g mock-factory
```

Or use without installing:

```bash
npx mock-factory ./api-spec.yaml
```

## Usage

### Basic

```bash
mock-factory ./openapi.yaml
```

### With options

```bash
mock-factory ./openapi.yaml --port 8080 --count 25 --delay 200
```

### Persist data between restarts

```bash
mock-factory ./openapi.yaml --persist mock-data.json
```

### Simulate real-world conditions

```bash
mock-factory ./openapi.yaml --delay 300 --error-rate 0.05
```

### Demo mode (no spec needed)

```bash
mock-factory
```

## API

### Auto-generated endpoints

For each resource in your spec, you get:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | API index with all resources |
| GET | `/users` | List all users |
| GET | `/users/:id` | Get user by ID |
| POST | `/users` | Create user |
| PUT | `/users/:id` | Replace user |
| PATCH | `/users/:id` | Partial update |
| DELETE | `/users/:id` | Delete user |

### Query parameters

```bash
# Filter by field
GET /users?role=admin

# Paginate
GET /users?_limit=10&_page=2
```

## How it works

1. Parses your OpenAPI spec (YAML or JSON)
2. Resolves `$ref` references
3. Extracts resource schemas from path responses
4. Generates realistic fake data based on field names, types, and formats
5. Creates full CRUD routes with Hono
6. Serves it up with CORS, logging, and optional delay/errors

## Example OpenAPI spec

```yaml
openapi: "3.0.0"
info:
  title: Blog API
  version: "1.0"
paths:
  /users:
    get:
      responses:
        "200":
          content:
            application/json:
              schema:
                type: array
                items:
                  type: object
                  properties:
                    name:
                      type: string
                    email:
                      type: string
                      format: email
                    role:
                      type: string
                      enum: [admin, editor, viewer]
  /posts:
    get:
      responses:
        "200":
          content:
            application/json:
              schema:
                type: array
                items:
                  type: object
                  properties:
                    title:
                      type: string
                    body:
                      type: string
                    userId:
                      type: integer
```

## CLI Options

| Flag | Default | Description |
|------|---------|-------------|
| `-p, --port` | 3001 | Server port |
| `-c, --count` | 10 | Items per resource |
| `-d, --delay` | 0 | Response delay (ms) |
| `-e, --error-rate` | 0 | Random error rate (0-1) |
| `--persist` | - | Save data to JSON file |

## License

MIT
