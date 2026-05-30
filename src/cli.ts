#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { parseOpenAPI, DataStore, MockResource, generateMockData } from './index';

const program = new Command();

program
  .name('mock-factory')
  .description('Spin up a realistic mock API server from OpenAPI specs in 5 seconds')
  .version('1.0.0')
  .argument('[spec]', 'Path to OpenAPI spec (YAML or JSON)')
  .option('-p, --port <port>', 'Port to serve on', '3001')
  .option('-c, --count <count>', 'Number of items to generate per resource', '10')
  .option('-d, --delay <ms>', 'Simulated response delay in ms', '0')
  .option('-e, --error-rate <rate>', 'Random error rate (0-1)', '0')
  .option('--persist <file>', 'Persist data to a JSON file')
  .option('--seed <number>', 'Seed for data generation')
  .action(async (specPath: string | undefined, opts: any) => {
    const port = parseInt(opts.port, 10);
    const count = parseInt(opts.count, 10);
    const delay = parseInt(opts.delay, 10);
    const errorRate = parseFloat(opts.errorRate);
    const persistFile = opts.persist;

    let resources: MockResource[] = [];

    if (specPath) {
      const fullPath = path.resolve(specPath);
      if (!fs.existsSync(fullPath)) {
        console.error(`Spec file not found: ${fullPath}`);
        process.exit(1);
      }

      const raw = fs.readFileSync(fullPath, 'utf-8');

      try {
        resources = parseOpenAPI(raw);
      } catch (err: any) {
        console.error(`Failed to parse spec: ${err.message}`);
        process.exit(1);
      }

      if (resources.length === 0) {
        console.error('No resources found in spec. Make sure your spec has paths with response schemas.');
        process.exit(1);
      }
    } else {
      // Demo mode: generate a sample pet store
      resources = [
        {
          name: 'users',
          schema: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              email: { type: 'string', format: 'email' },
              username: { type: 'string' },
              avatar: { type: 'string' },
            },
          },
        },
        {
          name: 'posts',
          schema: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              body: { type: 'string' },
              userId: { type: 'integer' },
            },
          },
        },
      ];
      console.log('No spec provided — running demo mode with sample data');
    }

    // Init store
    const store = new DataStore();

    // Load persisted data if exists
    if (persistFile && fs.existsSync(persistFile)) {
      const data = JSON.parse(fs.readFileSync(persistFile, 'utf-8'));
      store.import(data);
      console.log(`Loaded persisted data from ${persistFile}`);
    } else {
      store.seed(resources, count);
    }

    // Save helper
    function savePersist() {
      if (persistFile) {
        fs.writeFileSync(persistFile, JSON.stringify(store.export(), null, 2));
      }
    }

    // Build Hono app
    const app = new Hono();

    app.use('*', logger());
    app.use('*', cors());

    // Delay middleware
    app.use('*', async (_c, next) => {
      if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      await next();
    });

    // Error simulation middleware
    app.use('*', async (_c, next) => {
      if (errorRate > 0 && Math.random() < errorRate) {
        const codes = [400, 404, 500, 502, 503];
        const code = codes[Math.floor(Math.random() * codes.length)];
        return _c.json({ error: 'Simulated server error', status: code }, code as any);
      }
      await next();
    });

    // Index
    app.get('/', (c) => {
      return c.json({
        mockFactory: '1.0.0',
        resources: resources.map(r => ({
          name: r.name,
          endpoints: [
            `GET /${r.name}`,
            `GET /${r.name}/:id`,
            `POST /${r.name}`,
            `PUT /${r.name}/:id`,
            `PATCH /${r.name}/:id`,
            `DELETE /${r.name}/:id`,
          ],
          count: store.getAll(r.name).length,
        })),
      });
    });

    // CRUD routes for each resource
    for (const resource of resources) {
      const base = `/${resource.name}`;

      // List with basic filtering & pagination
      app.get(base, (c) => {
        let items = store.getAll(resource.name);
        const query = c.req.query();

        // Filtering
        for (const [key, val] of Object.entries(query)) {
          if (key === '_limit' || key === '_page' || key === '_sort') continue;
          items = items.filter(item => {
            const itemVal = String(item[key]).toLowerCase();
            return itemVal === (val as string).toLowerCase();
          });
        }

        // Pagination
        const limit = parseInt(query._limit || '0', 10);
        const page = parseInt(query._page || '1', 10);
        if (limit > 0) {
          const start = (page - 1) * limit;
          items = items.slice(start, start + limit);
        }

        return c.json(items);
      });

      // Get by ID
      app.get(`${base}/:id`, (c) => {
        const item = store.getById(resource.name, c.req.param('id'));
        if (!item) return c.json({ error: 'Not found' }, 404);
        return c.json(item);
      });

      // Create
      app.post(base, async (c) => {
        const body = await c.req.json();
        const item = store.create(resource.name, body);
        savePersist();
        return c.json(item, 201);
      });

      // Update (full)
      app.put(`${base}/:id`, async (c) => {
        const body = await c.req.json();
        const item = store.update(resource.name, c.req.param('id'), body);
        if (!item) return c.json({ error: 'Not found' }, 404);
        savePersist();
        return c.json(item);
      });

      // Patch (partial)
      app.patch(`${base}/:id`, async (c) => {
        const body = await c.req.json();
        const item = store.update(resource.name, c.req.param('id'), body);
        if (!item) return c.json({ error: 'Not found' }, 404);
        savePersist();
        return c.json(item);
      });

      // Delete
      app.delete(`${base}/:id`, (c) => {
        const ok = store.delete(resource.name, c.req.param('id'));
        if (!ok) return c.json({ error: 'Not found' }, 404);
        savePersist();
        return c.json({ deleted: true });
      });
    }

    // Start server
    serve({ fetch: app.fetch, port }, (info) => {
      console.log(`\n  mock-factory running on http://localhost:${info.port}\n`);
      console.log('  Resources:');
      for (const r of resources) {
        const cnt = store.getAll(r.name).length;
        console.log(`    /${r.name} (${cnt} items)`);
      }
      console.log('\n  Endpoints:');
      for (const r of resources) {
        console.log(`    GET    /${r.name}`);
        console.log(`    GET    /${r.name}/:id`);
        console.log(`    POST   /${r.name}`);
        console.log(`    PUT    /${r.name}/:id`);
        console.log(`    DELETE /${r.name}/:id`);
      }
      console.log(`\n  Open http://localhost:${port} for API index\n`);
    });
  });

program.parse();
