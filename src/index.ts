import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const guidesDir = path.join(__dirname, "..", "guides");
const pokeapiDataDir = path.join(__dirname, "..", "resources", "pokeapi-data");
const pokeapiV2Dir = path.join(pokeapiDataDir, "v2");
const pokeapiCacheDir = path.join(__dirname, "..", "resources", "pokeapi-cache");
const pokeapiCacheV2Dir = path.join(pokeapiCacheDir, "v2");

type GuideSpec = {
  id: string;
  title: string;
  fileName: string;
  description: string;
};

type PortfolioResource = {
  id: string;
  title: string;
  fileName: string;
  description: string;
};

type PortfolioTool = {
  name: string;
  title: string;
  description: string;
  schema: Record<string, unknown>;
};

type PortfolioPrompt = {
  name: string;
  title: string;
  description: string;
  args: string[];
};

type PortfolioEndpoint = {
  id: string;
  title: string;
  method?: string;
  url: string;
  description?: string;
  transport?: string;
  contentType?: string;
};

const PORTFOLIO_SERVER_ID = "mrdj-pokemon-mcp";
const PUBLIC_MCP_BASE_URL = "https://davidjgrimsley.com/public-facing/mcp";
const PUBLIC_MCP_SERVER_BASE_URL = `${PUBLIC_MCP_BASE_URL}/${PORTFOLIO_SERVER_ID}`;
const PUBLIC_MCP_SERVER_PATH = `/public-facing/mcp/${PORTFOLIO_SERVER_ID}`;
const PORTFOLIO_MCP_ENDPOINT_URL = `${PUBLIC_MCP_SERVER_BASE_URL}/mcp`;
const PORTFOLIO_SSE_MESSAGES_URL = `${PUBLIC_MCP_SERVER_BASE_URL}/messages`;
const PORTFOLIO_HEALTH_URL = `${PUBLIC_MCP_SERVER_BASE_URL}/health`;
const PORTFOLIO_PORTFOLIO_URL = `${PUBLIC_MCP_SERVER_BASE_URL}/portfolio.json`;
const PORTFOLIO_INFO_PAGE_URL = `https://davidjgrimsley.com/mcp/${PORTFOLIO_SERVER_ID}`;
const PORTFOLIO_GITHUB_REPO_URL = "https://github.com/DavidJGrimsley/mrdj-pokemon-mcp";
const SERVER_STARTED_AT = new Date().toISOString();

const PORTFOLIO_TOOLS: PortfolioTool[] = [
  {
    name: "list-guides",
    title: "List Strategy Guides",
    description: "Return the available strategy guides as resource links",
    schema: {}
  },
  {
    name: "get_strategy",
    title: "Get Strategy Guide",
    description: "Return the full Markdown for one of the built-in strategy guides",
    schema: {
      guideId: "string"
    }
  },
  {
    name: "get_pokemon",
    title: "Get Pokemon",
    description:
      "Lookup Pokemon data by name or National Dex id from local PokeAPI api-data sync (falls back to live PokeAPI when missing, cached locally)",
    schema: {
      nameOrId: "string"
    }
  },
  {
    name: "search_pokemon",
    title: "Search Pokemon",
    description: "Search Pokemon names using local PokeAPI api-data index",
    schema: {
      query: "string",
      limit: "number (optional)"
    }
  },
  {
    name: "type_effectiveness",
    title: "Type Effectiveness",
    description: "Calculate damage multiplier for an attacking type against 1-2 defending types",
    schema: {
      attackingType: "string",
      defendingTypes: "string[] (1-2 items)"
    }
  },
  {
    name: "counter_pokemon",
    title: "Counter Pokemon",
    description: "Suggest best attacking types (and example Pokemon when local data exists) to counter a target Pokemon",
    schema: {
      targetNameOrId: "string",
      topTypes: "number (optional)",
      samplePokemonPerType: "number (optional)"
    }
  },
  {
    name: "suggest_team",
    title: "Suggest Team",
    description: "Analyze a team (by Pokemon names/ids) and suggest defensive coverage improvements",
    schema: {
      team: "string[] (1-6 items)",
      topWeaknesses: "number (optional)",
      suggestedDefensiveTypes: "number (optional)"
    }
  }
];

const PORTFOLIO_PROMPTS: PortfolioPrompt[] = [];

const PORTFOLIO_ENDPOINTS: PortfolioEndpoint[] = [
  {
    id: "mcp-endpoint",
    title: "MCP Endpoint",
    method: "GET",
    url: PORTFOLIO_MCP_ENDPOINT_URL,
    description: "Primary MCP endpoint (Streamable HTTP + legacy SSE fallback).",
    transport: "streamable-http",
    contentType: "application/json"
  },
  {
    id: "sse-messages",
    title: "SSE Messages (POST)",
    method: "POST",
    url: PORTFOLIO_SSE_MESSAGES_URL,
    description: "SSE transport message endpoint (used by legacy SSE MCP clients).",
    transport: "sse",
    contentType: "application/json"
  },
  {
    id: "portfolio-json",
    title: "Portfolio Metadata (portfolio.json)",
    method: "GET",
    url: PORTFOLIO_PORTFOLIO_URL,
    description: "Metadata used by the portfolio UI (resources/tools/prompts).",
    contentType: "application/json"
  },
  {
    id: "health",
    title: "Health Check",
    method: "GET",
    url: PORTFOLIO_HEALTH_URL,
    description: "Server health status endpoint.",
    contentType: "application/json"
  },
  {
    id: "info-page",
    title: "Info Page",
    method: "GET",
    url: PORTFOLIO_INFO_PAGE_URL,
    description: "Human-readable MCP server overview page."
  },
  {
    id: "github-repo",
    title: "GitHub Repository",
    method: "GET",
    url: PORTFOLIO_GITHUB_REPO_URL,
    description: "Source code for the MCP server."
  }
];

let cachedPackageVersion: string | null = null;

async function getPackageVersion(): Promise<string> {
  if (cachedPackageVersion) return cachedPackageVersion;

  const packageJsonPath = path.join(__dirname, "..", "package.json");
  const raw = await readFile(packageJsonPath, "utf8");
  const parsed = JSON.parse(raw) as { version?: unknown };
  const version = typeof parsed.version === "string" ? parsed.version : "0.0.0";
  cachedPackageVersion = version;
  return version;
}

const guides: GuideSpec[] = [
  { id: "index", title: "Index", fileName: "index.md", description: "Entry point for all strategy guides." },
  { id: "general", title: "General", fileName: "general.md", description: "General Pokemon tips and best practices." },
  { id: "tera-raid", title: "Tera Raids", fileName: "tera-raid.md", description: "Strategies for tough Tera Raid battles." }
];

const guideMap = new Map(guides.map((g) => [g.id, g]));

type NamedApiResource = {
  name: string;
  url: string;
};

type NamedApiResourceList = {
  results?: NamedApiResource[];
};

function parseDexIdFromPokeApiUrl(url: string): number | null {
  const match = url.match(/\/(\d+)\/?$/);
  if (!match?.[1]) return null;
  const id = Number.parseInt(match[1], 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

async function loadLocalJson<T>(absolutePath: string): Promise<T> {
  const raw = await readFile(absolutePath, "utf8");
  return JSON.parse(raw) as T;
}

async function loadPokemonIndex(): Promise<NamedApiResource[]> {
  const indexPath = path.join(pokeapiV2Dir, "pokemon", "index.json");
  const parsed = await loadLocalJson<NamedApiResourceList>(indexPath);
  return Array.isArray(parsed.results) ? parsed.results : [];
}

async function resolvePokemonId(nameOrId: string): Promise<{ id: number; name?: string } | null> {
  const trimmed = nameOrId.trim();
  if (!trimmed) return null;

  const asNumber = Number(trimmed);
  if (Number.isInteger(asNumber) && asNumber > 0) return { id: asNumber };

  const target = trimmed.toLowerCase();
  const results = await loadPokemonIndex();
  const exact = results.find((r) => r.name.toLowerCase() === target);
  if (!exact) return null;

  const id = parseDexIdFromPokeApiUrl(exact.url);
  if (!id) return null;
  return { id, name: exact.name };
}

async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    await stat(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function fetchPokemonFromPokeApi(nameOrId: string): Promise<Record<string, unknown>> {
  const trimmed = nameOrId.trim();
  const asNumber = Number(trimmed);

  const { PokemonClient } = await import("pokenode-ts");
  const client = new PokemonClient();

  if (Number.isInteger(asNumber) && asNumber > 0) {
    return (await client.getPokemonById(asNumber)) as unknown as Record<string, unknown>;
  }

  return (await client.getPokemonByName(trimmed.toLowerCase())) as unknown as Record<string, unknown>;
}

const CANONICAL_TYPE_NAMES = [
  "normal",
  "fire",
  "water",
  "electric",
  "grass",
  "ice",
  "fighting",
  "poison",
  "ground",
  "flying",
  "psychic",
  "bug",
  "rock",
  "ghost",
  "dragon",
  "dark",
  "steel",
  "fairy"
] as const;

type TypeName = (typeof CANONICAL_TYPE_NAMES)[number];

type TypeDamageRelations = {
  double_damage_from: string[];
  half_damage_from: string[];
  no_damage_from: string[];
  double_damage_to: string[];
  half_damage_to: string[];
  no_damage_to: string[];
};

type TypeApiData = {
  id?: number;
  name?: string;
  damage_relations?: {
    double_damage_from?: NamedApiResource[];
    half_damage_from?: NamedApiResource[];
    no_damage_from?: NamedApiResource[];
    double_damage_to?: NamedApiResource[];
    half_damage_to?: NamedApiResource[];
    no_damage_to?: NamedApiResource[];
  };
};

function normalizeTypeName(value: string): string {
  return value.trim().toLowerCase();
}

function asTypeName(value: string): TypeName | null {
  const n = normalizeTypeName(value);
  return (CANONICAL_TYPE_NAMES as readonly string[]).includes(n) ? (n as TypeName) : null;
}

function toNameList(list: NamedApiResource[] | undefined): string[] {
  if (!Array.isArray(list)) return [];
  return list.map((x) => x?.name).filter((x): x is string => typeof x === "string").map(normalizeTypeName);
}

async function loadTypeIndex(): Promise<NamedApiResource[]> {
  const indexPath = path.join(pokeapiV2Dir, "type", "index.json");
  const parsed = await loadLocalJson<NamedApiResourceList>(indexPath);
  return Array.isArray(parsed.results) ? parsed.results : [];
}

async function resolveTypeNameOrId(typeNameOrId: string): Promise<{ id?: number; name: string } | null> {
  const trimmed = typeNameOrId.trim();
  if (!trimmed) return null;

  const maybeType = asTypeName(trimmed);
  const asNumber = Number(trimmed);

  if (Number.isInteger(asNumber) && asNumber > 0) {
    return { id: asNumber, name: maybeType ?? String(asNumber) };
  }

  if (maybeType) return { name: maybeType };

  // If api-data is present, allow resolving via type index (covers future expansions / naming).
  try {
    const index = await loadTypeIndex();
    const target = normalizeTypeName(trimmed);
    const hit = index.find((r) => normalizeTypeName(r.name) === target);
    if (hit) {
      const id = parseDexIdFromPokeApiUrl(hit.url);
      return { id: id ?? undefined, name: normalizeTypeName(hit.name) };
    }
  } catch {
    // ignore
  }

  return null;
}

const typeRelationsCache = new Map<string, TypeDamageRelations>();

async function fetchTypeFromPokeApi(typeNameOrId: string): Promise<TypeApiData> {
  const { PokemonClient } = await import("pokenode-ts");
  const client = new PokemonClient();
  const trimmed = typeNameOrId.trim();
  const asNumber = Number(trimmed);
  if (Number.isInteger(asNumber) && asNumber > 0) {
    return (await client.getTypeById(asNumber)) as unknown as TypeApiData;
  }
  return (await client.getTypeByName(trimmed.toLowerCase())) as unknown as TypeApiData;
}

async function loadTypeDamageRelations(typeName: string): Promise<TypeDamageRelations> {
  const normalized = normalizeTypeName(typeName);
  const cached = typeRelationsCache.get(normalized);
  if (cached) return cached;

  const resolved = await resolveTypeNameOrId(normalized);
  const localPath = resolved?.id
    ? path.join(pokeapiV2Dir, "type", String(resolved.id), "index.json")
    : path.join(pokeapiCacheV2Dir, "type", `${normalized}.json`);

  // Prefer local api-data by id when possible.
  if (resolved?.id) {
    const localApiDataPath = path.join(pokeapiV2Dir, "type", String(resolved.id), "index.json");
    if (await fileExists(localApiDataPath)) {
      const data = await loadLocalJson<TypeApiData>(localApiDataPath);
      const rel = data.damage_relations ?? {};
      const out: TypeDamageRelations = {
        double_damage_from: toNameList(rel.double_damage_from),
        half_damage_from: toNameList(rel.half_damage_from),
        no_damage_from: toNameList(rel.no_damage_from),
        double_damage_to: toNameList(rel.double_damage_to),
        half_damage_to: toNameList(rel.half_damage_to),
        no_damage_to: toNameList(rel.no_damage_to)
      };
      typeRelationsCache.set(normalized, out);
      return out;
    }
  }

  // Then check local cache.
  const cachePath = path.join(pokeapiCacheV2Dir, "type", `${normalized}.json`);
  if (await fileExists(cachePath)) {
    const data = await loadLocalJson<TypeApiData>(cachePath);
    const rel = data.damage_relations ?? {};
    const out: TypeDamageRelations = {
      double_damage_from: toNameList(rel.double_damage_from),
      half_damage_from: toNameList(rel.half_damage_from),
      no_damage_from: toNameList(rel.no_damage_from),
      double_damage_to: toNameList(rel.double_damage_to),
      half_damage_to: toNameList(rel.half_damage_to),
      no_damage_to: toNameList(rel.no_damage_to)
    };
    typeRelationsCache.set(normalized, out);
    return out;
  }

  // Finally, fetch live and cache.
  const fetched = await fetchTypeFromPokeApi(normalized);
  await mkdir(path.join(pokeapiCacheV2Dir, "type"), { recursive: true });
  await writeFile(cachePath, JSON.stringify(fetched, null, 2), "utf8");
  const rel = fetched.damage_relations ?? {};
  const out: TypeDamageRelations = {
    double_damage_from: toNameList(rel.double_damage_from),
    half_damage_from: toNameList(rel.half_damage_from),
    no_damage_from: toNameList(rel.no_damage_from),
    double_damage_to: toNameList(rel.double_damage_to),
    half_damage_to: toNameList(rel.half_damage_to),
    no_damage_to: toNameList(rel.no_damage_to)
  };
  typeRelationsCache.set(normalized, out);
  return out;
}

async function computeDefensiveMultiplier(attackingType: TypeName, defendingTypes: TypeName[]): Promise<number> {
  let multiplier = 1;
  for (const defType of defendingTypes) {
    const rel = await loadTypeDamageRelations(defType);
    if (rel.no_damage_from.includes(attackingType)) multiplier *= 0;
    else if (rel.double_damage_from.includes(attackingType)) multiplier *= 2;
    else if (rel.half_damage_from.includes(attackingType)) multiplier *= 0.5;
  }
  return multiplier;
}

async function computeAllDefensiveMultipliers(defendingTypes: TypeName[]): Promise<Record<TypeName, number>> {
  const out = {} as Record<TypeName, number>;
  for (const atk of CANONICAL_TYPE_NAMES) {
    out[atk] = await computeDefensiveMultiplier(atk, defendingTypes);
  }
  return out;
}

function extractPokemonTypeNames(pokemonData: Record<string, unknown>): TypeName[] {
  const types = (pokemonData as { types?: unknown }).types;
  if (!Array.isArray(types)) return [];
  const names: TypeName[] = [];
  for (const t of types) {
    const name = (t as { type?: { name?: unknown } }).type?.name;
    if (typeof name !== "string") continue;
    const asType = asTypeName(name);
    if (asType) names.push(asType);
  }
  // Deduplicate, preserve order
  return names.filter((n, i) => names.indexOf(n) === i);
}

function toFileUri(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  return `file:///${normalized}`;
}

async function loadGuide(fileName: string): Promise<{ uri: string; text: string }> {
  const filePath = path.join(guidesDir, fileName);
  const text = await readFile(filePath, "utf8");
  return { uri: toFileUri(filePath), text };
}

const server = new McpServer(
  {
    name: "mrdj-pokemon-mcp",
    version: "0.1.0",
    description: "Pokemon data (local PokeAPI api-data sync) + strategy guides exposed as MCP resources and tools."
  },
  {
    capabilities: {
      resources: {},
      prompts: {},
      tools: {}
    }
  }
);

guides.forEach((guide) => {
  server.registerResource(
    guide.id,
    toFileUri(path.join(guidesDir, guide.fileName)),
    {
      title: guide.title,
      description: guide.description,
      mimeType: "text/markdown"
    },
    async () => {
      const { uri, text } = await loadGuide(guide.fileName);
      return {
        contents: [
          {
            uri,
            text
          }
        ]
      };
    }
  );
});

server.registerTool(
  "list-guides",
  {
    title: "List Strategy Guides",
    description: "Return the available strategy guides as resource links",
    inputSchema: {}
  },
  async () => {
    const listText = guides
      .map((guide) => {
        const filePath = path.join(guidesDir, guide.fileName);
        return `- ${guide.title} (${guide.description}) -> ${toFileUri(filePath)}`;
      })
      .join("\n");

    return {
      content: [
        {
          type: "text",
          text: `Available strategy guides (open with readResource):\n${listText}`
        }
      ]
    };
  }
);
server.registerTool(
  "get_strategy",
  {
    title: "Get Strategy Guide",
    description: "Return the full Markdown for one of the built-in strategy guides.",
    inputSchema: z.object({
      guideId: z.string().min(1).describe("Guide id (run list-guides to see options)")
    })
  },
  async (input: unknown) => {
    const parsed = z.object({ guideId: z.string().min(1) }).parse(input);
    const guide = guideMap.get(parsed.guideId);
    if (!guide) {
      return {
        content: [
          {
            type: "text",
            text: `Unknown guideId: ${parsed.guideId}. Run list-guides to see available ids.`
          }
        ]
      };
    }

    const { uri, text } = await loadGuide(guide.fileName);
    return {
      content: [
        {
          type: "text",
          text: `Guide: ${guide.title} (${guide.id})\nSource: ${uri}\n\n${text}`
        }
      ]
    };
  }
);

server.registerTool(
  "search_pokemon",
  {
    title: "Search Pokemon",
    description: "Search Pokemon names using the local PokeAPI api-data index.",
    inputSchema: z.object({
      query: z.string().min(1).describe("Case-insensitive substring search"),
      limit: z.number().int().min(1).max(50).optional().describe("Max results (default 10, max 50)")
    })
  },
  async (input: unknown) => {
    try {
      const parsed = z
        .object({
          query: z.string().min(1),
          limit: z.number().int().min(1).max(50).optional()
        })
        .parse(input);

      const results = await loadPokemonIndex();
      const q = parsed.query.toLowerCase();
      const limit = parsed.limit ?? 10;

      const matches = results
        .filter((r) => r.name.toLowerCase().includes(q))
        .slice(0, limit)
        .map((r) => ({ name: r.name, id: parseDexIdFromPokeApiUrl(r.url) }))
        .filter((r) => typeof r.id === "number");

      if (matches.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No Pokemon matched "${parsed.query}". (Data source: ${path.join(pokeapiV2Dir, "pokemon", "index.json")})`
            }
          ]
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ query: parsed.query, matches }, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text:
              `Pokemon search failed. Ensure PokeAPI api-data is synced into ${pokeapiDataDir}. ` +
              `Expected: ${path.join(pokeapiV2Dir, "pokemon", "index.json")}.\n\n` +
              `Error: ${String(error)}`
          }
        ]
      };
    }
  }
);

server.registerTool(
  "get_pokemon",
  {
    title: "Get Pokemon",
    description: "Lookup Pokemon data by name or National Dex id from local PokeAPI api-data sync.",
    inputSchema: z.object({
      nameOrId: z.string().min(1).describe("Pokemon name (e.g. garchomp) or National Dex id (e.g. 445)")
    })
  },
  async (input: unknown) => {
    try {
      const parsed = z.object({ nameOrId: z.string().min(1) }).parse(input);
      let resolved: { id: number; name?: string } | null = null;
      try {
        resolved = await resolvePokemonId(parsed.nameOrId);
      } catch {
        // If local index isn't present yet, we can still fall back to live PokeAPI.
      }

      if (resolved) {
        const pokemonPath = path.join(pokeapiV2Dir, "pokemon", String(resolved.id), "index.json");
        if (await fileExists(pokemonPath)) {
          const data = await loadLocalJson<Record<string, unknown>>(pokemonPath);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    input: parsed.nameOrId,
                    resolved,
                    source: pokemonPath,
                    origin: "local-sync",
                    pokemon: data
                  },
                  null,
                  2
                )
              }
            ]
          };
        }

        const cachePath = path.join(pokeapiCacheV2Dir, "pokemon", `${resolved.id}.json`);
        if (await fileExists(cachePath)) {
          const data = await loadLocalJson<Record<string, unknown>>(cachePath);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    input: parsed.nameOrId,
                    resolved,
                    source: cachePath,
                    origin: "cache",
                    pokemon: data
                  },
                  null,
                  2
                )
              }
            ]
          };
        }
      }

      // Fallback: fetch from live PokeAPI and cache locally to avoid repeated calls.
      const data = await fetchPokemonFromPokeApi(parsed.nameOrId);
      const pokemonId = typeof data.id === "number" ? data.id : resolved?.id;
      const pokemonName = typeof data.name === "string" ? data.name : resolved?.name;

      if (typeof pokemonId === "number" && pokemonId > 0) {
        const cacheDir = path.join(pokeapiCacheV2Dir, "pokemon");
        await mkdir(cacheDir, { recursive: true });
        const cachePath = path.join(cacheDir, `${pokemonId}.json`);
        await writeFile(cachePath, JSON.stringify(data, null, 2), "utf8");

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  input: parsed.nameOrId,
                  resolved: { id: pokemonId, name: pokemonName },
                  source: cachePath,
                  origin: "pokeapi-cached",
                  pokemon: data
                },
                null,
                2
              )
            }
          ]
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                input: parsed.nameOrId,
                resolved: pokemonId ? { id: pokemonId, name: pokemonName } : null,
                source: "pokeapi",
                origin: "pokeapi",
                pokemon: data
              },
              null,
              2
            )
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text:
              `Pokemon lookup failed. This tool prefers local PokeAPI api-data sync, and can fall back to live PokeAPI when missing.\n\n` +
              `Local expected: ${path.join(pokeapiV2Dir, "pokemon", "index.json")} and per-Pokemon JSON under ${path.join(
                pokeapiV2Dir,
                "pokemon",
                "<id>",
                "index.json"
              )}.\n` +
              `Cache dir: ${path.join(pokeapiCacheV2Dir, "pokemon")}.\n\n` +
              `Error: ${String(error)}`
          }
        ]
      };
    }
  }
);

server.registerTool(
  "type_effectiveness",
  {
    title: "Type Effectiveness",
    description: "Calculate damage multiplier for an attacking type against 1-2 defending types.",
    inputSchema: z.object({
      attackingType: z.string().min(1).describe("Attacking type name (e.g. fire)"),
      defendingTypes: z
        .array(z.string().min(1))
        .min(1)
        .max(2)
        .describe("Defending type names (1-2 types, e.g. [grass, steel])")
    })
  },
  async (input: unknown) => {
    try {
      const parsed = z
        .object({
          attackingType: z.string().min(1),
          defendingTypes: z.array(z.string().min(1)).min(1).max(2)
        })
        .parse(input);

      const atk = asTypeName(parsed.attackingType);
      if (!atk) {
        return {
          content: [{ type: "text", text: `Unknown attackingType: ${parsed.attackingType}. Use one of: ${CANONICAL_TYPE_NAMES.join(", ")}` }]
        };
      }

      const defs: TypeName[] = [];
      for (const d of parsed.defendingTypes) {
        const dt = asTypeName(d);
        if (!dt) {
          return {
            content: [{ type: "text", text: `Unknown defending type: ${d}. Use one of: ${CANONICAL_TYPE_NAMES.join(", ")}` }]
          };
        }
        defs.push(dt);
      }

      const perType: Array<{ defendingType: TypeName; multiplier: number; reason: string }> = [];
      for (const def of defs) {
        const rel = await loadTypeDamageRelations(def);
        let mult = 1;
        let reason = "neutral";
        if (rel.no_damage_from.includes(atk)) {
          mult = 0;
          reason = "immune";
        } else if (rel.double_damage_from.includes(atk)) {
          mult = 2;
          reason = "super-effective";
        } else if (rel.half_damage_from.includes(atk)) {
          mult = 0.5;
          reason = "resisted";
        }
        perType.push({ defendingType: def, multiplier: mult, reason });
      }

      const total = perType.reduce((acc, x) => acc * x.multiplier, 1);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                attackingType: atk,
                defendingTypes: defs,
                multiplier: total,
                breakdown: perType
              },
              null,
              2
            )
          }
        ]
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `type_effectiveness failed: ${String(error)}` }]
      };
    }
  }
);

server.registerTool(
  "counter_pokemon",
  {
    title: "Counter Pokemon",
    description:
      "Suggest best attacking types (and example Pokemon when local api-data exists) to counter a target Pokemon.",
    inputSchema: z.object({
      targetNameOrId: z.string().min(1).describe("Target Pokemon name or National Dex id"),
      topTypes: z.number().int().min(1).max(10).optional().describe("How many attacking types to return (default 5)") ,
      samplePokemonPerType: z
        .number()
        .int()
        .min(0)
        .max(20)
        .optional()
        .describe("How many example Pokemon to return per type if local data exists (default 5)")
    })
  },
  async (input: unknown) => {
    try {
      const parsed = z
        .object({
          targetNameOrId: z.string().min(1),
          topTypes: z.number().int().min(1).max(10).optional(),
          samplePokemonPerType: z.number().int().min(0).max(20).optional()
        })
        .parse(input);

      // Get target Pokemon types (local-first via existing logic).
      let pokemonData: Record<string, unknown> | null = null;
      try {
        const resolved = await resolvePokemonId(parsed.targetNameOrId);
        if (resolved) {
          const localPath = path.join(pokeapiV2Dir, "pokemon", String(resolved.id), "index.json");
          if (await fileExists(localPath)) pokemonData = await loadLocalJson<Record<string, unknown>>(localPath);
          else {
            const cachePath = path.join(pokeapiCacheV2Dir, "pokemon", `${resolved.id}.json`);
            if (await fileExists(cachePath)) pokemonData = await loadLocalJson<Record<string, unknown>>(cachePath);
          }
        }
      } catch {
        // ignore
      }
      if (!pokemonData) pokemonData = await fetchPokemonFromPokeApi(parsed.targetNameOrId);

      const targetTypes = extractPokemonTypeNames(pokemonData);
      if (targetTypes.length === 0) {
        return {
          content: [{ type: "text", text: `Could not determine types for ${parsed.targetNameOrId}.` }]
        };
      }

      const mults = await computeAllDefensiveMultipliers(targetTypes);
      const sorted = Object.entries(mults)
        .map(([type, multiplier]) => ({ type: type as TypeName, multiplier }))
        .filter((x) => x.multiplier > 1)
        .sort((a, b) => b.multiplier - a.multiplier);

      const top = sorted.slice(0, parsed.topTypes ?? 5);

      // Optional: gather example Pokemon per attacking type (only if local sync is present).
      const samplePerType = parsed.samplePokemonPerType ?? 5;
      const examples: Record<string, Array<{ id: number; name: string }>> = {};
      const pokemonIndexPath = path.join(pokeapiV2Dir, "pokemon", "index.json");
      const haveLocalIndex = samplePerType > 0 && (await fileExists(pokemonIndexPath));

      if (haveLocalIndex) {
        const index = await loadPokemonIndex();
        for (const entry of top) {
          examples[entry.type] = [];
        }

        for (const r of index) {
          const id = parseDexIdFromPokeApiUrl(r.url);
          if (!id) continue;

          // Stop early when all types have enough examples.
          const remaining = top.some((t) => (examples[t.type]?.length ?? 0) < samplePerType);
          if (!remaining) break;

          const pokemonPath = path.join(pokeapiV2Dir, "pokemon", String(id), "index.json");
          if (!(await fileExists(pokemonPath))) continue;
          const data = await loadLocalJson<Record<string, unknown>>(pokemonPath);
          const types = extractPokemonTypeNames(data);
          for (const t of top) {
            if ((examples[t.type]?.length ?? 0) >= samplePerType) continue;
            if (types.includes(t.type)) {
              examples[t.type].push({ id, name: r.name });
            }
          }
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                target: {
                  input: parsed.targetNameOrId,
                  name: typeof pokemonData.name === "string" ? pokemonData.name : undefined,
                  id: typeof pokemonData.id === "number" ? pokemonData.id : undefined,
                  types: targetTypes
                },
                bestAttackingTypes: top,
                examples: haveLocalIndex ? examples : undefined,
                note: haveLocalIndex
                  ? "Examples derived from local api-data; not based on movesets."
                  : "Local api-data index not found; returning types only."
              },
              null,
              2
            )
          }
        ]
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `counter_pokemon failed: ${String(error)}` }]
      };
    }
  }
);

server.registerTool(
  "suggest_team",
  {
    title: "Suggest Team",
    description: "Analyze a team and suggest defensive coverage improvements (type-based, not moveset-based).",
    inputSchema: z.object({
      team: z.array(z.string().min(1)).min(1).max(6).describe("Pokemon names/ids, 1-6 members"),
      topWeaknesses: z.number().int().min(1).max(10).optional().describe("How many top weakness types to return (default 6)"),
      suggestedDefensiveTypes: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("How many defensive types to suggest adding (default 5)")
    })
  },
  async (input: unknown) => {
    try {
      const parsed = z
        .object({
          team: z.array(z.string().min(1)).min(1).max(6),
          topWeaknesses: z.number().int().min(1).max(10).optional(),
          suggestedDefensiveTypes: z.number().int().min(1).max(10).optional()
        })
        .parse(input);

      const members: Array<{ input: string; id?: number; name?: string; types: TypeName[] }> = [];

      for (const entry of parsed.team) {
        let data: Record<string, unknown> | null = null;
        try {
          const resolved = await resolvePokemonId(entry);
          if (resolved?.id) {
            const localPath = path.join(pokeapiV2Dir, "pokemon", String(resolved.id), "index.json");
            if (await fileExists(localPath)) data = await loadLocalJson<Record<string, unknown>>(localPath);
            else {
              const cachePath = path.join(pokeapiCacheV2Dir, "pokemon", `${resolved.id}.json`);
              if (await fileExists(cachePath)) data = await loadLocalJson<Record<string, unknown>>(cachePath);
            }
          }
        } catch {
          // ignore
        }
        if (!data) data = await fetchPokemonFromPokeApi(entry);
        members.push({
          input: entry,
          id: typeof data.id === "number" ? data.id : undefined,
          name: typeof data.name === "string" ? data.name : undefined,
          types: extractPokemonTypeNames(data)
        });
      }

      // Aggregate team defensive multipliers
      const perTypeStats: Record<
        TypeName,
        { weak: number; resist: number; immune: number; neutral: number; multipliers: number[] }
      > = {} as any;
      for (const t of CANONICAL_TYPE_NAMES) {
        perTypeStats[t] = { weak: 0, resist: 0, immune: 0, neutral: 0, multipliers: [] };
      }

      for (const m of members) {
        const mults = await computeAllDefensiveMultipliers(m.types.length ? m.types : ([] as TypeName[]));
        for (const t of CANONICAL_TYPE_NAMES) {
          const v = mults[t];
          perTypeStats[t].multipliers.push(v);
          if (v === 0) perTypeStats[t].immune += 1;
          else if (v >= 2) perTypeStats[t].weak += 1;
          else if (v <= 0.5) perTypeStats[t].resist += 1;
          else perTypeStats[t].neutral += 1;
        }
      }

      const weaknessRanking = CANONICAL_TYPE_NAMES.map((t) => {
        const s = perTypeStats[t];
        const score = s.weak * 2 + (s.resist * -1) + (s.immune * -2);
        return { type: t, score, ...s };
      })
        .sort((a, b) => b.score - a.score)
        .slice(0, parsed.topWeaknesses ?? 6);

      // Suggest defensive type(s) to add based on resisting the top weakness types.
      const weaknessTypes = weaknessRanking.map((w) => w.type);
      const defensiveSuggestions = CANONICAL_TYPE_NAMES.map((candidate) => candidate).map((candidate) => ({
        type: candidate,
        score: 0,
        resists: [] as TypeName[],
        immunes: [] as TypeName[]
      }));

      for (const sug of defensiveSuggestions) {
        // Candidate as a single-type defender: check what it resists among weaknessTypes.
        for (const atk of weaknessTypes) {
          const mult = await computeDefensiveMultiplier(atk, [sug.type]);
          if (mult === 0) {
            sug.score += 3;
            sug.immunes.push(atk);
          } else if (mult <= 0.5) {
            sug.score += 2;
            sug.resists.push(atk);
          }
        }
      }

      const suggested = defensiveSuggestions
        .sort((a, b) => b.score - a.score)
        .slice(0, parsed.suggestedDefensiveTypes ?? 5);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                team: members,
                topWeaknesses: weaknessRanking,
                suggestedDefensiveTypes: suggested,
                note: "This is type-based only (no movesets/abilities/items)."
              },
              null,
              2
            )
          }
        ]
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `suggest_team failed: ${String(error)}` }]
      };
    }
  }
);

async function main() {
  // Check for --http-port flag
  const args = process.argv.slice(2);
  const httpPortIndex = args.indexOf("--http-port");
  const useHttp = httpPortIndex !== -1 && args[httpPortIndex + 1];
  
  if (useHttp) {
    const port = parseInt(args[httpPortIndex + 1], 10);
    if (isNaN(port)) {
      console.error("Invalid port number");
      process.exit(1);
    }
    
    // HTTP/SSE mode
    const app = express();
    
    // Enable CORS for open access
    app.use(cors({
      origin: "*", // Allow all origins for open access
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"]
    }));
    
    // External path clients will POST to (through nginx)
    const sseMessagesPathExternal = `${PUBLIC_MCP_SERVER_PATH}/messages`;
    // Internal path nginx proxies to
    const sseMessagesPathInternal = "/mcp/messages";
    
    // Apply JSON body parsing only to non-SSE message routes
    // SSE transport needs raw stream access
    app.use((req, res, next) => {
      if (req.path === sseMessagesPathExternal || req.path === sseMessagesPathInternal) {
        // Skip body parsing for SSE message endpoints
        next();
      } else {
        express.json()(req, res, next);
      }
    });
    
    // Store transports by session ID (for both Streamable HTTP and SSE)
    const transports: Record<string, StreamableHTTPServerTransport> = {};
    const sseTransports: Record<string, SSEServerTransport> = {};
    
    // Health check endpoint
    app.get("/health", (_req, res) => {
      res.set("Cache-Control", "no-store");
      res.json({ status: "ok", service: "mrdj-pokemon-mcp", version: "0.1.0" });
    });

    // Portfolio metadata endpoint (public REST; not MCP; not SSE)
    // Supports CORS preflight (OPTIONS) and conditional requests (If-None-Match)
    app.options("/portfolio.json", (_req, res) => {
      res.set("Access-Control-Allow-Origin", "*");
      res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.set("Access-Control-Allow-Headers", "Content-Type");
      res.status(204).end();
    });

    app.get("/portfolio.json", async (req, res) => {
      try {
        const version = await getPackageVersion();
        const payload = {
          server: {
            id: PORTFOLIO_SERVER_ID,
            name: PORTFOLIO_SERVER_ID,
            version,
            mcpEndpointUrl: PORTFOLIO_MCP_ENDPOINT_URL,
            githubRepoUrl: PORTFOLIO_GITHUB_REPO_URL
          },
          resources: guides.map((guide) => ({
            id: guide.id,
            title: guide.title,
            fileName: guide.fileName,
            description: guide.description
          })),
          tools: PORTFOLIO_TOOLS,
          prompts: PORTFOLIO_PROMPTS,
          endpoints: PORTFOLIO_ENDPOINTS,
          updatedAt: SERVER_STARTED_AT
        };

        // Compute ETag for conditional requests
        const payloadStr = JSON.stringify(payload);
        const hash = createHash("sha1").update(payloadStr, "utf8").digest("hex");
        const etag = `"${hash.slice(0, 16)}"`;

        // Set caching headers
        res.set("Cache-Control", "public, max-age=300");
        res.set("ETag", etag);

        // Check If-None-Match for conditional request (304)
        const clientEtag = req.headers["if-none-match"];
        if (clientEtag === etag) {
          return res.status(304).end();
        }

        // Return 200 with JSON payload
        res.json(payload);
      } catch (error) {
        console.error("Error building /portfolio.json response:", error);
        res.status(500).json({ error: "portfolio_meta_failed" });
      }
    });

    // Store heartbeat intervals for cleanup
    const sseHeartbeats: Record<string, NodeJS.Timeout> = {};

    // MCP endpoint (Streamable HTTP + SSE fallback). VS Code should point here.
    app.all("/mcp", async (req, res) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      const acceptHeader = req.headers.accept || "";
      const isSseRequest = req.method === "GET" && acceptHeader.includes("text/event-stream") && !sessionId;

      if (isSseRequest) {
        console.error("Handling legacy SSE MCP request");
        // Use external path so client POSTs to the right nginx location
        const transport = new SSEServerTransport(sseMessagesPathExternal, res);
        
        // Store the SSE transport by its actual session ID (set by the transport)
        // The transport's sessionId is available after construction
        const actualSessionId = transport.sessionId;
        sseTransports[actualSessionId] = transport;
        console.error(`SSE session created with transport sessionId: ${actualSessionId}`);
        
        // Send SSE heartbeat every 30 seconds to keep connection alive
        const heartbeatInterval = setInterval(() => {
          try {
            if (!res.writableEnded) {
              res.write(`:heartbeat\n\n`);
            } else {
              clearInterval(heartbeatInterval);
              delete sseHeartbeats[actualSessionId];
            }
          } catch (error) {
            console.error(`Heartbeat error for session ${actualSessionId}:`, error);
            clearInterval(heartbeatInterval);
            delete sseHeartbeats[actualSessionId];
          }
        }, 30000);
        sseHeartbeats[actualSessionId] = heartbeatInterval;
        
        transport.onclose = () => {
          console.error(`SSE session closed: ${actualSessionId}`);
          if (sseHeartbeats[actualSessionId]) {
            clearInterval(sseHeartbeats[actualSessionId]);
            delete sseHeartbeats[actualSessionId];
          }
          delete sseTransports[actualSessionId];
        };
        
        // Also handle response close event
        res.on('close', () => {
          if (sseHeartbeats[actualSessionId]) {
            clearInterval(sseHeartbeats[actualSessionId]);
            delete sseHeartbeats[actualSessionId];
          }
        });
        
        try {
          await server.connect(transport);
        } catch (error) {
          console.error("Error handling SSE MCP request:", error);
          if (sseHeartbeats[actualSessionId]) {
            clearInterval(sseHeartbeats[actualSessionId]);
            delete sseHeartbeats[actualSessionId];
          }
          delete sseTransports[actualSessionId];
          if (!res.headersSent) {
            res.status(500).json({ error: "Internal server error" });
          }
        }
        return;
      }

      console.error(`${req.method} /mcp session: ${sessionId || 'new'} Accept: ${acceptHeader}`);

      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports[sessionId]) {
        transport = transports[sessionId];
        console.error(`Reusing transport for session ${sessionId}`);
      } else {
        console.error('Creating new transport');
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId) => {
            console.error(`New MCP session initialized: ${newSessionId}`);
            transports[newSessionId] = transport;
          }
        });

        transport.onclose = () => {
          const sid = Object.keys(transports).find(k => transports[k] === transport);
          if (sid) {
            console.error(`MCP session closed: ${sid}`);
            delete transports[sid];
          }
        };

        console.error('Connecting server to transport');
        await server.connect(transport);
        console.error('Server connected to transport');
      }

      try {
        await transport.handleRequest(req, res);
      } catch (error) {
        console.error('Error handling MCP request:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    });

    // SSE Messages endpoint - handle both internal path (nginx proxied) and external path
    const handleSseMessage = async (req: express.Request, res: express.Response) => {
      const sessionId = req.query.sessionId as string;
      console.error(`SSE POST message received, sessionId: ${sessionId}`);
      
      const transport = sseTransports[sessionId];
      if (transport) {
        try {
          await transport.handlePostMessage(req, res);
        } catch (error) {
          console.error("Error handling SSE message:", error);
          if (!res.headersSent) {
            res.status(500).json({ error: "Internal server error" });
          }
        }
      } else {
        console.error(`No SSE transport found for session: ${sessionId}`);
        res.status(404).json({ error: "Session not found" });
      }
    };
    
    // Register both paths for SSE messages (internal for nginx proxy, external for direct)
    app.post(sseMessagesPathInternal, handleSseMessage);
    app.post(sseMessagesPathExternal, handleSseMessage);
    
    const httpServer = app.listen(port, () => {
      console.error(`mrdj-pokemon-mcp MCP server running on http://localhost:${port}`);
      console.error(`Health check: http://localhost:${port}/health`);
      console.error(`MCP endpoint: http://localhost:${port}/mcp`);
    });
    
    // Keep server alive
    process.on("SIGTERM", () => {
      console.error("SIGTERM received, closing server");
      httpServer.close();
    });
  } else {
    // Stdio mode (default)
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("mrdj-pokemon-mcp MCP server running on stdio");
    
    // Keep process alive - without this, Node may exit
    process.stdin.resume();
  }
}

main().catch((error) => {
  console.error("Fatal error in main()", error);
  process.exit(1);
});
