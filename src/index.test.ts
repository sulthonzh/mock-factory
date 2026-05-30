import { describe, it, expect } from 'vitest';
import {
  parseOpenAPI,
  generateMockData,
  DataStore,
  MockResource,
} from './index';

describe('parseOpenAPI', () => {
  it('parses a simple OpenAPI 3.0 spec with array response', () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      paths: {
        '/users': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'integer' },
                          name: { type: 'string' },
                          email: { type: 'string', format: 'email' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    const resources = parseOpenAPI(spec);
    expect(resources).toHaveLength(1);
    expect(resources[0].name).toBe('users');
    expect(resources[0].schema.properties).toBeDefined();
    expect(resources[0].schema.properties.email.format).toBe('email');
  });

  it('parses YAML format', () => {
    const yaml = `
openapi: "3.0.0"
paths:
  /pets:
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
                    status:
                      type: string
                      enum: [available, pending, sold]
`;
    const resources = parseOpenAPI(yaml);
    expect(resources).toHaveLength(1);
    expect(resources[0].name).toBe('pets');
  });

  it('handles $ref references', () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      paths: {
        '/posts': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Post' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Post: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              body: { type: 'string' },
            },
          },
        },
      },
    });

    const resources = parseOpenAPI(spec);
    expect(resources).toHaveLength(1);
    expect(resources[0].schema.properties.title).toBeDefined();
  });

  it('throws on invalid input', () => {
    expect(() => parseOpenAPI('not valid {')).toThrow();
  });

  it('returns empty for spec with no paths', () => {
    const spec = JSON.stringify({ openapi: '3.0.0', paths: {} });
    expect(parseOpenAPI(spec)).toEqual([]);
  });
});

describe('generateMockData', () => {
  it('generates data from schema properties', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'integer' },
        active: { type: 'boolean' },
      },
    };

    const data = generateMockData(schema);
    expect(data).toHaveProperty('name');
    expect(data).toHaveProperty('age');
    expect(data).toHaveProperty('active');
    expect(typeof data.name).toBe('string');
    expect(typeof data.age).toBe('number');
    expect(typeof data.active).toBe('boolean');
  });

  it('respects enum values', () => {
    const schema = {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['active', 'inactive', 'banned'] },
      },
    };

    for (let i = 0; i < 20; i++) {
      const data = generateMockData(schema);
      expect(['active', 'inactive', 'banned']).toContain(data.status);
    }
  });

  it('generates format-specific data', () => {
    const schema = {
      type: 'object',
      properties: {
        email: { type: 'string', format: 'email' },
        created: { type: 'string', format: 'date-time' },
        website: { type: 'string', format: 'uri' },
      },
    };

    const data = generateMockData(schema);
    expect(data.email).toContain('@');
    expect(data.created).toContain('T');
    expect(data.website).toMatch(/^https?:\/\//);
  });

  it('generates key-aware data', () => {
    const schema = {
      type: 'object',
      properties: {
        firstName: { type: 'string' },
        description: { type: 'string' },
        price: { type: 'number' },
      },
    };

    const data = generateMockData(schema);
    expect(typeof data.firstName).toBe('string');
    expect(data.description.length).toBeGreaterThan(10);
    expect(typeof data.price).toBe('number');
  });
});

describe('DataStore', () => {
  const resources: MockResource[] = [
    {
      name: 'users',
      schema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
        },
      },
    },
  ];

  it('seeds data with correct count', () => {
    const store = new DataStore();
    store.seed(resources, 5);
    expect(store.getAll('users')).toHaveLength(5);
  });

  it('assigns auto-incrementing ids', () => {
    const store = new DataStore();
    store.seed(resources, 3);
    const users = store.getAll('users');
    expect(users[0].id).toBe(1);
    expect(users[1].id).toBe(2);
    expect(users[2].id).toBe(3);
  });

  it('gets item by id', () => {
    const store = new DataStore();
    store.seed(resources, 3);
    const user = store.getById('users', 2);
    expect(user).toBeDefined();
    expect(user.id).toBe(2);
  });

  it('creates new items', () => {
    const store = new DataStore();
    store.seed(resources, 2);
    const created = store.create('users', { name: 'Test', email: 'test@test.com' });
    expect(created.id).toBe(3);
    expect(store.getAll('users')).toHaveLength(3);
  });

  it('updates existing items', () => {
    const store = new DataStore();
    store.seed(resources, 2);
    const updated = store.update('users', 1, { name: 'Updated' });
    expect(updated.name).toBe('Updated');
    expect(updated.id).toBe(1); // id preserved
  });

  it('deletes items', () => {
    const store = new DataStore();
    store.seed(resources, 3);
    expect(store.delete('users', 2)).toBe(true);
    expect(store.getAll('users')).toHaveLength(2);
    expect(store.getById('users', 2)).toBeUndefined();
  });

  it('exports and imports data', () => {
    const store = new DataStore();
    store.seed(resources, 3);
    const exported = store.export();

    const store2 = new DataStore();
    store2.import(exported);
    expect(store2.getAll('users')).toHaveLength(3);
  });

  it('returns empty array for unknown resource', () => {
    const store = new DataStore();
    expect(store.getAll('unknown')).toEqual([]);
  });

  it('returns undefined for unknown id', () => {
    const store = new DataStore();
    store.seed(resources, 2);
    expect(store.getById('users', 999)).toBeUndefined();
  });
});
