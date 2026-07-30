import jsYaml from 'js-yaml';
import { faker } from '@faker-js/faker/locale/en';

export interface MockResource {
  name: string;
  schema: Record<string, any>;
}

export interface MockConfig {
  port: number;
  delay: number;
  errorRate: number;
  persist: boolean;
  persistFile?: string;
}

const DEFAULT_CONFIG: MockConfig = {
  port: 3001,
  delay: 0,
  errorRate: 0,
  persist: false,
};

// ─── OpenAPI Parser ──────────────────────────────────────────────

export function parseOpenAPI(raw: string): MockResource[] {
  let spec: any;
  try {
    spec = jsYaml.load(raw) as any;
  } catch {
    spec = JSON.parse(raw);
  }

  if (!spec.paths) throw new Error('No paths found in OpenAPI spec');

  const resources: MockResource[] = [];

  for (const [path, methods] of Object.entries(spec.paths)) {
    // Extract resource name from path like /users, /users/{id}, /users/{id}/posts
    const segments = path.split('/').filter(Boolean);
    const resourceName = segments[0];

    if (!resourceName) continue;

    // Find GET collection or POST to infer schema
    const getMethod = (methods as any)?.get;
    const postMethod = (methods as any)?.post;

    const responseSchema =
      postMethod?.requestBody?.content?.['application/json']?.schema ||
      getMethod?.responses?.['200']?.content?.['application/json']?.schema;

    if (responseSchema) {
      const resolved = resolveRef(responseSchema, spec);
      // Check if it's an array response
      if (resolved.type === 'array' && resolved.items) {
        const itemSchema = resolveRef(resolved.items, spec);
        resources.push({ name: resourceName, schema: itemSchema });
      } else if (resolved.properties || resolved.type === 'object') {
        // Check for wrapper patterns like { data: [...] }
        if (resolved.properties?.data?.type === 'array' && resolved.properties?.data?.items) {
          const itemSchema = resolveRef(resolved.properties.data.items, spec);
          resources.push({ name: resourceName, schema: itemSchema });
        } else {
          resources.push({ name: resourceName, schema: resolved });
        }
      }
    }
  }

  // Deduplicate by name
  const seen = new Set<string>();
  return resources.filter(r => {
    if (seen.has(r.name)) return false;
    seen.add(r.name);
    return true;
  });
}

function resolveRef(obj: any, spec: any): any {
  if (!obj) return obj;
  if (obj.$ref) {
    const path = obj.$ref.replace('#/', '').split('/');
    let resolved = spec;
    for (const seg of path) {
      resolved = resolved?.[seg];
    }
    return resolveRef(resolved, spec);
  }
  if (obj.properties) {
    const resolved: Record<string, any> = { ...obj };
    resolved.properties = {};
    for (const [key, val] of Object.entries(obj.properties)) {
      resolved.properties[key] = resolveRef(val, spec);
    }
    return resolved;
  }
  if (obj.items) {
    return { ...obj, items: resolveRef(obj.items, spec) };
  }
  return obj;
}

// ─── Data Generator ──────────────────────────────────────────────

export function generateMockData(schema: Record<string, any>): any {
  if (!schema || !schema.properties) {
    return generateByType(schema?.type || 'object', schema);
  }

  const result: Record<string, any> = {};
  for (const [key, prop] of Object.entries(schema.properties)) {
    result[key] = generateProperty(key, prop as Record<string, any>);
  }
  return result;
}

function generateProperty(key: string, prop: Record<string, any>): any {
  // Handle enum
  if (prop.enum && prop.enum.length > 0) {
    return faker.helpers.arrayElement(prop.enum);
  }

  // Handle examples
  if (prop.example !== undefined) return prop.example;

  // Handle format
  if (prop.format) {
    return generateFromFormat(prop.format, key);
  }

  // Handle type
  return generateByType(prop.type, prop, key);
}

function generateFromFormat(format: string, key: string): any {
  const formatMap: Record<string, () => any> = {
    'date-time': () => faker.date.recent({ days: 30 }).toISOString(),
    date: () => faker.date.recent({ days: 365 }).toISOString().split('T')[0],
    email: () => faker.internet.email({}),
    uri: () => faker.internet.url(),
    url: () => faker.internet.url(),
    uuid: () => faker.string.uuid(),
    ipv4: () => faker.internet.ipv4(),
    ipv6: () => faker.internet.ipv6(),
    phone: () => faker.phone.number(),
    hostname: () => faker.internet.domainName(),
    password: () => faker.internet.password({ length: 12 }),
  };
  return (formatMap[format] || (() => faker.lorem.word()))();
}

function generateByType(
  type: string | undefined,
  prop: Record<string, any>,
  key?: string
): any {
  const lowerKey = (key || '').toLowerCase();

  // Smart key-based generation
  if (lowerKey.includes('name') && lowerKey.includes('first')) return faker.person.firstName();
  if (lowerKey.includes('name') && lowerKey.includes('last')) return faker.person.lastName();
  if (lowerKey.includes('name') && lowerKey !== 'username') return faker.person.fullName();
  if (lowerKey === 'username') return faker.internet.username();
  if (lowerKey === 'email') return faker.internet.email({});
  if (lowerKey === 'title' && type === 'string') return faker.lorem.sentence({ min: 2, max: 5 });
  if (lowerKey === 'description' || lowerKey === 'body') return faker.lorem.paragraph();
  if (lowerKey === 'avatar' || lowerKey === 'image' || lowerKey === 'photo') return faker.image.avatar();
  if (lowerKey === 'url' || lowerKey === 'website') return faker.internet.url();
  if (lowerKey === 'phone') return faker.phone.number();
  if (lowerKey === 'address' || lowerKey === 'street') return faker.location.streetAddress();
  if (lowerKey === 'city') return faker.location.city();
  if (lowerKey === 'country') return faker.location.country();
  if (lowerKey === 'zip' || lowerKey === 'zipcode') return faker.location.zipCode();
  if (lowerKey === 'company') return faker.company.name();
  if (lowerKey === 'price' || lowerKey === 'amount') return faker.number.float({ min: 1, max: 1000, fractionDigits: 2 });
  if (lowerKey.includes('color')) return faker.color.human();
  if (lowerKey === 'id' || lowerKey.endsWith('id')) return faker.number.int({ min: 1, max: 10000 });
  if (lowerKey === 'slug') return faker.lorem.slug({ min: 1, max: 3 });

  switch (type) {
    case 'string':
      return faker.lorem.word();
    case 'number':
    case 'integer':
      return faker.number.int({ min: prop.minimum || 0, max: prop.maximum || 100 });
    case 'boolean':
      return faker.datatype.boolean();
    case 'array':
      if (prop.items) {
        const len = faker.number.int({ min: 1, max: 5 });
        return Array.from({ length: len }, () =>
          generateProperty('item', prop.items as Record<string, any>)
        );
      }
      return [];
    case 'object':
      if (prop.properties) {
        return generateMockData(prop);
      }
      return {};
    default:
      return faker.lorem.word();
  }
}

// ─── Store ───────────────────────────────────────────────────────

export class DataStore {
  private data: Map<string, any[]> = new Map();
  private idCounters: Map<string, number> = new Map();

  seed(resources: MockResource[], count: number = 10): void {
    for (const resource of resources) {
      const items: any[] = [];
      const counter = this.idCounters.get(resource.name) || 1;

      for (let i = 0; i < count; i++) {
        const item = generateMockData(resource.schema);
        // Ensure an id field
        if (!item.id) item.id = counter + i;
        else if (typeof item.id === 'string') item.id = String(counter + i);
        items.push(item);
      }

      this.data.set(resource.name, items);
      this.idCounters.set(resource.name, counter + count);
    }
  }

  getAll(resource: string): any[] {
    return this.data.get(resource) || [];
  }

  getById(resource: string, id: string | number): any | undefined {
    const items = this.data.get(resource) || [];
    return items.find(item => String(item.id) === String(id));
  }

  create(resource: string, item: any): any {
    const items = this.data.get(resource) || [];
    const counter = this.idCounters.get(resource) || 1;
    item.id = item.id || counter;
    this.idCounters.set(resource, counter + 1);
    items.push(item);
    this.data.set(resource, items);
    return item;
  }

  update(resource: string, id: string | number, updates: any): any | undefined {
    const items = this.data.get(resource) || [];
    const idx = items.findIndex(item => String(item.id) === String(id));
    if (idx === -1) return undefined;
    items[idx] = { ...items[idx], ...updates, id: items[idx].id };
    return items[idx];
  }

  delete(resource: string, id: string | number): boolean {
    const items = this.data.get(resource) || [];
    const idx = items.findIndex(item => String(item.id) === String(id));
    if (idx === -1) return false;
    items.splice(idx, 1);
    return true;
  }

  export(): Record<string, any[]> {
    const result: Record<string, any[]> = {};
    for (const [key, val] of this.data) {
      result[key] = val;
    }
    return result;
  }

  import(data: Record<string, any[]>): void {
    for (const [key, val] of Object.entries(data)) {
      this.data.set(key, val);
      const maxId = val.reduce((max, item) => {
        const id = Number(item.id) || 0;
        return id > max ? id : max;
      }, 0);
      this.idCounters.set(key, maxId + 1);
    }
  }
}
