# TradingView API Model

**Generated from HAR Analysis**: December 25, 2025
**Total Requests Captured**: 126 entries
**Unique API Endpoints**: 22

---

## Table of Contents

1. [API Domains](#api-domains)
2. [Pine Script API](#pine-script-api)
3. [Symbol Search API](#symbol-search-api)
4. [User API](#user-api)
5. [Telemetry API](#telemetry-api)
6. [ProData API](#prodata-api)
7. [API Flows](#api-flows)
8. [Data Models](#data-models)
9. [Authentication](#authentication)

---

## API Domains

| Domain | Purpose | Auth Required |
|--------|---------|---------------|
| `pine-facade.tradingview.com` | Pine Script compilation, saving, library access | Session cookie |
| `symbol-search.tradingview.com` | Symbol autocomplete and search | No |
| `www.tradingview.com` | User profiles, settings, categories | Optional |
| `prodata.tradingview.com` | Real-time data connectivity checks | No |
| `telemetry.tradingview.com` | Analytics and error reporting | No |

---

## Pine Script API

**Base URL**: `https://pine-facade.tradingview.com/pine-facade`

### Endpoints Summary

| # | Method | Endpoint | Purpose | Auth |
|---|--------|----------|---------|------|
| 1 | GET | `/is_auth_to_write/{scriptId}` | Check write permission | Yes |
| 2 | GET | `/is_auth_to_get/{scriptId}/{version}` | Check read permission | Yes |
| 3 | GET | `/get/{scriptId}/{version}` | Get script source code | Optional |
| 4 | GET | `/list?filter={saved\|published}` | List user's scripts | Yes |
| 5 | POST | `/translate_light?user_name={user}&v=3` | Parse/validate script | Yes |
| 6 | GET | `/get_lib_export_data/{libId}/last?v=2` | Get library exports | No |
| 7 | POST | `/parse_title` | Extract script title | Yes |
| 8 | POST | `/save/new?name={name}&user_name={user}&allow_overwrite={bool}` | Create new script | Yes |
| 9 | POST | `/save/next/{scriptId}?user_name={user}&allow_create_new={bool}&name={name}` | Update existing script | Yes |

---

### 1. Check Write Permission

```http
GET /pine-facade/is_auth_to_write/{scriptId}
Host: pine-facade.tradingview.com
Cookie: sessionid={sessionId}; sessionid_sign={sessionSign}
```

**Path Parameters**:
- `scriptId` - URL-encoded script ID (e.g., `PUB%3B46a78fe6affb49499224459dc04614d9`)

**Response**:
```json
true | false
```

**Use Case**: Check if current user can edit a script before attempting modification.

---

### 2. Check Read Permission

```http
GET /pine-facade/is_auth_to_get/{scriptId}/{version}
Host: pine-facade.tradingview.com
Cookie: sessionid={sessionId}; sessionid_sign={sessionSign}
```

**Path Parameters**:
- `scriptId` - URL-encoded script ID
- `version` - Version string (e.g., `1.0`)

**Response**:
```json
true | false
```

**Use Case**: Verify read access before fetching invite-only or private scripts.

---

### 3. Get Script Source

```http
GET /pine-facade/get/{scriptId}/{version}
Host: pine-facade.tradingview.com
```

**Path Parameters**:
- `scriptId` - URL-encoded script ID
- `version` - Version number (e.g., `1`)

**Response Schema**: `PineScriptSource`
```json
{
  "created": "2023-02-06T11:08:10.969063Z",
  "extra": {
    "kind": "study",
    "sourceInputsCount": 0
  },
  "lastVersionMaj": "1.0",
  "scriptAccess": "open_no_auth",
  "scriptName": "Global Net Liquidity",
  "source": "// Pine Script source code...",
  "updated": "2023-02-06T11:08:10.969063Z",
  "version": "1.0"
}
```

**Script Access Types**:
- `open_no_auth` - Public, readable without authentication
- `closed_source` - Code hidden
- `invite_only` - Requires permission

---

### 4. List Scripts

```http
GET /pine-facade/list?filter={saved|published}
Host: pine-facade.tradingview.com
Cookie: sessionid={sessionId}; sessionid_sign={sessionSign}
```

**Query Parameters**:
- `filter` - `saved` (private drafts) or `published` (public scripts)

**Response Schema**: `PineScriptListResult`
```json
[
  {
    "scriptIdPart": "USER;0cbf0c1c0c2c4cf4b569485f0f6c4afb",
    "version": "13.0",
    "scriptName": "Algorganic",
    "scriptTitle": "Test Strategy Using External Buy/Sell Signals",
    "modified": 1753442449,
    "scriptSource": "",
    "isTVScriptBuiltIn": false,
    "extra": {
      "kind": "strategy",
      "sourceInputsCount": 2,
      "stats": {
        "alertcondition": 8,
        "plot": 1,
        "plotshape": 2
      }
    }
  }
]
```

**Script Kinds**:
- `study` - Indicator
- `strategy` - Trading strategy

---

### 5. Translate Light (Parse/Validate)

```http
POST /pine-facade/translate_light?user_name={username}&v=3
Host: pine-facade.tradingview.com
Content-Type: multipart/form-data; boundary=...
Cookie: sessionid={sessionId}; sessionid_sign={sessionSign}

------WebKitFormBoundary...
Content-Disposition: form-data; name="source"

//@version=6
indicator("My script")
plot(close)
------WebKitFormBoundary...--
```

**Query Parameters**:
- `user_name` - TradingView username
- `v` - API version (currently `3`)

**Request Body**: `multipart/form-data`
- `source` - Pine Script source code

**Response**: Parsed script structure with variables, functions, errors

**Use Case**: Real-time validation in Pine Editor, syntax checking, autocomplete support.

---

### 6. Get Library Exports

```http
GET /pine-facade/get_lib_export_data/{libId}/last?v=2
Host: pine-facade.tradingview.com
```

**Path Parameters**:
- `libId` - Library identifier (e.g., `TradingView/ta`, `PineCoders/Time`)

**Query Parameters**:
- `v` - API version (currently `2`)

**Response Schema**: `PineLibraryExports`
```json
{
  "libInfo": {
    "user": "TradingView",
    "userId": 123,
    "scriptIdPart": "TV;...",
    "version": "1.0",
    "isPublic": true,
    "lib": "ta",
    "libId": "TradingView/ta"
  },
  "exports": {
    "functions": [
      {
        "name": "sma",
        "desc": ["Simple Moving Average"],
        "args": [
          {"name": "source", "desc": ["Series to process"]},
          {"name": "length", "desc": ["Number of bars"]}
        ],
        "returnedTypes": ["float"],
        "returns": ["SMA of the source"],
        "syntax": ["ta.sma(source, length)"]
      }
    ],
    "types": []
  }
}
```

**Common Libraries**:
- `TradingView/ta` - Technical analysis functions
- `TradingView/Strategy` - Strategy functions
- `PineCoders/Time` - Time utilities
- `PineCoders/VisibleChart` - Chart visibility helpers

---

### 7. Parse Title

```http
POST /pine-facade/parse_title
Host: pine-facade.tradingview.com
Content-Type: multipart/form-data; boundary=...
Cookie: sessionid={sessionId}; sessionid_sign={sessionSign}

------WebKitFormBoundary...
Content-Disposition: form-data; name="user_name"

gwizz0
------WebKitFormBoundary...
Content-Disposition: form-data; name="source"

//@version=6
indicator("My Script Title")
plot(close)
------WebKitFormBoundary...--
```

**Request Body**: `multipart/form-data`
- `user_name` - TradingView username
- `source` - Pine Script source code

**Response**:
```json
{
  "success": true,
  "result": "My Script Title"
}
```

**Use Case**: Extract script name from `indicator()` or `strategy()` call for auto-filling save dialogs.

---

### 8. Save New Script

```http
POST /pine-facade/save/new?name={name}&user_name={user}&allow_overwrite={bool}
Host: pine-facade.tradingview.com
Content-Type: multipart/form-data; boundary=...
Cookie: sessionid={sessionId}; sessionid_sign={sessionSign}

------WebKitFormBoundary...
Content-Disposition: form-data; name="source"

//@version=6
indicator("My script")
plot(close)
------WebKitFormBoundary...--
```

**Query Parameters**:
- `name` - Script name (URL-encoded)
- `user_name` - TradingView username
- `allow_overwrite` - `true` or `false`

**Request Body**: `multipart/form-data`
- `source` - Pine Script source code

**Response Schema**: `PineScriptSaveResult`
```json
{
  "success": true,
  "result": {
    "IL": "bmI9Ks46_Wal+oDbY3HB6FS41nemHSA==_dGdkYn6S...",
    "ilTemplate": "bmI9Ks46_cNb21FDM25dNjS33432zhg==_98kD68jY...",
    "metaInfo": {
      "_metainfoVersion": 54,
      "behind_chart": true,
      "description": "My script",
      "id": "Script$USER;bc851e0221464caf9bfce177477fcfe5@tv-scripting-101",
      "isTVScript": true,
      "pine": {
        "digest": "a173244ed1bc248a33e5c33b76b870ce00749bd5",
        "version": "1.0"
      },
      "plots": [{"id": "plot_0", "type": "line"}],
      "inputs": [...],
      "defaults": {...}
    }
  }
}
```

**Important Notes**:
1. Server compiles the source code - you only send raw Pine Script
2. Response includes compiled IL (Intermediate Language) and metadata
3. `ilTemplate` is a base64-encoded compiled version

---

### 9. Save Next Version

```http
POST /pine-facade/save/next/{scriptId}?user_name={user}&allow_create_new={bool}&name={name}
Host: pine-facade.tradingview.com
Content-Type: multipart/form-data; boundary=...
Cookie: sessionid={sessionId}; sessionid_sign={sessionSign}

------WebKitFormBoundary...
Content-Disposition: form-data; name="source"

//@version=6
indicator("My script v2")
plot(close * 2)
------WebKitFormBoundary...--
```

**Path Parameters**:
- `scriptId` - URL-encoded existing script ID

**Query Parameters**:
- `user_name` - TradingView username
- `allow_create_new` - Create new script if ID doesn't exist (`true`/`false`)
- `name` - Script name (URL-encoded)

**Request Body**: `multipart/form-data`
- `source` - Pine Script source code

**Response**: Same as Save New (`PineScriptSaveResult`)

---

## Symbol Search API

**Base URL**: `https://symbol-search.tradingview.com`

### Symbol Search v3

```http
GET /symbol_search/v3/?text={query}&hl=1&exchange=&lang=en&search_type=undefined&domain=production&sort_by_country=US&promo=true
Host: symbol-search.tradingview.com
```

**Query Parameters**:
- `text` - Search query
- `hl` - Highlight matches (1 = yes)
- `exchange` - Filter by exchange (empty = all)
- `lang` - Language code
- `search_type` - Type filter
- `domain` - `production`
- `sort_by_country` - Country priority (e.g., `US`)
- `promo` - Include promotional results

**Response Schema**: `SymbolSearchResult`
```json
{
  "symbols_remaining": 9950,
  "symbols": [
    {
      "symbol": "<em>C</em>",
      "description": "Citigroup, Inc.",
      "type": "stock",
      "exchange": "NYSE",
      "found_by_isin": false,
      "found_by_cusip": false,
      "cusip": "172967424",
      "isin": "US1729674242",
      "cik_code": "0000831001",
      "currency_code": "USD",
      "logoid": "citigroup",
      "provider_id": "ice",
      "source_id": "NYSE",
      "country": "US",
      "is_primary_listing": true,
      "typespecs": ["common"]
    }
  ]
}
```

**Symbol Types**:
- `stock` - Equities
- `futures` - Futures contracts
- `crypto` - Cryptocurrencies
- `forex` - Currency pairs
- `index` - Market indices
- `cfd` - Contracts for difference

---

## User API

**Base URL**: `https://www.tradingview.com/api/v1`

### Get User Profile

```http
GET /user/profile/{username}/
Host: www.tradingview.com
```

**Response Schema**: `UserProfile`
```json
{
  "username": "gwizz0",
  "uri": "/u/gwizz0/",
  "id": 11023901,
  "is_broker": false,
  "avatars": {
    "small": "https://s3.tradingview.com/userpics/...",
    "mid": "...",
    "big": "...",
    "orig": "..."
  },
  "badges": [
    {"name": "pro:pro_premium", "verbose_name": "Premium"}
  ],
  "pro_plan": "pro_premium",
  "followers_count": 2,
  "is_online": true,
  "follow_status": false,
  "last_visit": 1766665480.0,
  "date_joined": "2020-08-19T15:26:20.226576+00:00",
  "socials": {"twitter": ""},
  "publications": {"ideas": 1, "scripts": 0}
}
```

**Pro Plan Values**:
- `null` - Free
- `pro` - Pro
- `pro_plus` - Pro+
- `pro_premium` - Premium

---

## Telemetry API

**Base URL**: `https://telemetry.tradingview.com`

### Report Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/pine/report` | Pine Editor events |
| POST | `/news/report` | News module events |
| POST | `/pro/report` | Premium feature usage |

**Request Format**: Analytics event payloads (JSON)

---

## ProData API

**Base URL**: `https://prodata.tradingview.com`

### Ping (Connectivity Check)

```http
GET /ping
Host: prodata.tradingview.com
```

**Response**: `200 OK` (empty body)

**Use Case**: Keep-alive for real-time data connections, latency monitoring.

---

## API Flows

### Flow 1: Create New Pine Script

```
┌─────────────────────────────────────────────────────────────────┐
│                    CREATE NEW SCRIPT FLOW                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. User writes code in Pine Editor                              │
│           │                                                      │
│           ▼                                                      │
│  2. POST /translate_light  ──────────────────────────────────┐  │
│     (Real-time validation, called on each keystroke)          │  │
│           │                                                   │  │
│           ▼                                                   │  │
│  3. POST /parse_title                                         │  │
│     (Extract title from indicator()/strategy() call)          │  │
│           │                                                   │  │
│           ▼                                                   │  │
│  4. POST /save/new?name={title}&user_name={user}              │  │
│     Body: FormData with source code                           │  │
│           │                                                   │  │
│           ▼                                                   │  │
│  5. Response: {success, IL, ilTemplate, metaInfo}             │  │
│     Contains compiled script + new scriptIdPart               │  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Flow 2: Edit Existing Script

```
┌─────────────────────────────────────────────────────────────────┐
│                    EDIT EXISTING SCRIPT FLOW                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. GET /is_auth_to_write/{scriptId}                            │
│     Check if user can edit                                       │
│           │                                                      │
│           ▼ (if true)                                            │
│  2. GET /get/{scriptId}/{version}                               │
│     Fetch current source code                                    │
│           │                                                      │
│           ▼                                                      │
│  3. User modifies code in editor                                │
│           │                                                      │
│           ▼                                                      │
│  4. POST /translate_light                                       │
│     (Real-time validation)                                       │
│           │                                                      │
│           ▼                                                      │
│  5. POST /save/next/{scriptId}?name={name}&user_name={user}     │
│     Body: FormData with updated source                           │
│           │                                                      │
│           ▼                                                      │
│  6. Response: {success, IL, ilTemplate, metaInfo}               │
│     Version incremented                                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Flow 3: Load Public Script

```
┌─────────────────────────────────────────────────────────────────┐
│                    LOAD PUBLIC SCRIPT FLOW                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. GET /is_auth_to_write/{scriptId}                            │
│     Check if user owns script (usually false for public)         │
│           │                                                      │
│           ▼                                                      │
│  2. GET /get/{scriptId}/{version}                               │
│     Fetch source (if scriptAccess != "closed_source")            │
│           │                                                      │
│           ▼                                                      │
│  3. Display in Pine Editor (read-only if not owner)             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Flow 4: Library Function Lookup

```
┌─────────────────────────────────────────────────────────────────┐
│                    LIBRARY LOOKUP FLOW                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. User types "ta." in editor                                  │
│           │                                                      │
│           ▼                                                      │
│  2. GET /get_lib_export_data/TradingView/ta/last?v=2            │
│           │                                                      │
│           ▼                                                      │
│  3. Response: {libInfo, exports: {functions, types}}            │
│     Populate autocomplete with ta.sma, ta.ema, etc.             │
│                                                                  │
│  Common libraries loaded:                                        │
│  - TradingView/ta (technical analysis)                          │
│  - TradingView/Strategy (strategy functions)                    │
│  - PineCoders/Time (time utilities)                             │
│  - PineCoders/VisibleChart (chart visibility)                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Flow 5: Browse User's Scripts

```
┌─────────────────────────────────────────────────────────────────┐
│                    LIST SCRIPTS FLOW                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. GET /list?filter=saved                                      │
│     Fetch all private/draft scripts                              │
│           │                                                      │
│           ▼                                                      │
│  2. Response: Array of script summaries                         │
│     {scriptIdPart, version, scriptName, scriptTitle, kind}      │
│           │                                                      │
│           ▼                                                      │
│  3. User selects script from list                               │
│           │                                                      │
│           ▼                                                      │
│  4. GET /get/{scriptIdPart}/{version}                           │
│     Load full source code                                        │
│                                                                  │
│  Also: GET /list?filter=published                               │
│     For published scripts only                                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Models

### TypeScript Interfaces

```typescript
// Script Source Response
interface PineScriptSource {
  created: string;              // ISO timestamp
  updated: string;              // ISO timestamp
  version: string;              // "1.0"
  lastVersionMaj: string;       // "1.0"
  scriptName: string;           // Display name
  scriptAccess: "open_no_auth" | "closed_source" | "invite_only";
  source: string;               // Pine Script code
  extra?: {
    kind: "study" | "strategy";
    sourceInputsCount: number;
    stats?: {
      alertcondition?: number;
      plot?: number;
      plotshape?: number;
    };
  };
}

// Script List Item
interface PineScriptListItem {
  scriptIdPart: string;         // "USER;abc123..."
  version: string;              // "13.0"
  scriptName: string;           // Internal name
  scriptTitle: string;          // Display title
  modified: number;             // Unix timestamp
  scriptSource: string;         // Empty in list
  isTVScriptBuiltIn: boolean;
  extra: {
    kind: "study" | "strategy";
    sourceInputsCount: number;
    stats?: object;
  };
}

// Save Result
interface PineScriptSaveResult {
  success: boolean;
  reason?: string;              // Error message if failed
  result?: {
    IL: string;                 // Compiled intermediate language
    ilTemplate: string;         // Base64 template
    metaInfo: PineMetaInfo;
  };
}

// Meta Info (from compilation)
interface PineMetaInfo {
  _metainfoVersion: number;     // 54
  behind_chart: boolean;
  description: string;
  docs: string;
  format: { type: string };
  id: string;                   // "Script$USER;xxx@tv-scripting-101"
  isTVScript: boolean;
  isTVScriptStub: boolean;
  is_hidden_study: boolean;
  is_price_study: boolean;
  pine: {
    digest: string;             // Hash
    version: string;            // "1.0"
  };
  plots: Array<{
    id: string;
    type: "line" | "circles" | "columns" | ...;
  }>;
  inputs: Array<{
    id: string;
    name: string;
    type: string;
    defval: any;
    isHidden?: boolean;
    isFake?: boolean;
  }>;
  defaults: {
    inputs: object;
    styles: object;
  };
}

// Library Exports
interface PineLibraryExports {
  libInfo: {
    user: string;
    userId: number;
    scriptIdPart: string;
    version: string;
    isPublic: boolean;
    lib: string;
    libId: string;
  };
  exports: {
    functions: Array<{
      name: string;
      desc: string[];
      args: Array<{name: string; desc: string[]}>;
      returnedTypes: string[];
      returns: string[];
      syntax: string[];
    }>;
    types: unknown[];
  };
}

// Symbol Search Result
interface SymbolSearchResult {
  symbols_remaining: number;
  symbols: Array<{
    symbol: string;
    description: string;
    type: "stock" | "futures" | "crypto" | "forex" | "index" | "cfd";
    exchange: string;
    currency_code: string;
    logoid: string;
    provider_id: string;
    source_id: string;
    country: string;
    is_primary_listing: boolean;
    typespecs: string[];
    cusip?: string;
    isin?: string;
    cik_code?: string;
  }>;
}

// User Profile
interface UserProfile {
  username: string;
  uri: string;
  id: number;
  is_broker: boolean;
  avatars: {
    small: string;
    mid: string;
    big: string;
    orig: string;
  };
  badges: Array<{name: string; verbose_name: string}>;
  pro_plan: null | "pro" | "pro_plus" | "pro_premium";
  followers_count: number;
  is_online: boolean;
  follow_status: boolean;
  last_visit: number;
  date_joined: string;
  socials: {twitter: string};
  publications: {ideas: number; scripts: number};
}
```

---

## Authentication

### Session Cookies

All authenticated requests require these cookies:

```
Cookie: sessionid={sessionId}; sessionid_sign={sessionSign}
```

**Cookie Details**:
- `sessionid` - Main session token (alphanumeric)
- `sessionid_sign` - HMAC signature for sessionid

**Session Lifetime**: ~2-4 weeks

**Headers Required**:
```http
Origin: https://www.tradingview.com
Referer: https://www.tradingview.com/
```

### Authentication Levels

| Level | Endpoints |
|-------|-----------|
| **No Auth** | `/get/{public}`, `/get_lib_export_data`, `/ping`, Symbol Search |
| **Optional** | `/get/{private}` (fails gracefully) |
| **Required** | `/save/*`, `/list`, `/translate_light`, `/parse_title`, `/is_auth_to_*` |

### Error Responses

**401 Unauthorized**:
```json
{"error": "Not authenticated"}
```

**403 Forbidden**:
```json
{"error": "Access denied"}
```

**429 Rate Limited**:
```json
{"error": "Too many requests"}
```

---

## Request Frequency Analysis

| Endpoint | Calls in HAR | Pattern |
|----------|--------------|---------|
| `/translate_light` | 14 | Called on every edit |
| `/save/next` | 8 | Multiple versions saved |
| `/get_lib_export_data` | 4 | One per library |
| `/save/new` | 2 | New scripts created |
| `/parse_title` | 2 | Before each save |
| `/list` | 2 | Tab switch (saved/published) |
| `/is_auth_to_get` | 2 | Permission checks |
| `/is_auth_to_write` | 1 | Initial check |
| `/get` | 1 | Load script |
| `prodata.tradingview.com/ping` | 68 | Keep-alive ~every 10s |

---

## Implementation Notes

### FormData for POST Requests

Pine Script save/parse endpoints use `multipart/form-data`, NOT JSON:

```javascript
const formData = new FormData();
formData.append("source", pineScriptCode);

await fetch(url, {
  method: "POST",
  headers: {
    // DO NOT set Content-Type - browser adds boundary
    "Cookie": `sessionid=${sessionId}; sessionid_sign=${sessionSign}`,
    "Origin": "https://www.tradingview.com"
  },
  body: formData
});
```

### Script ID Format

```
{TYPE};{hash}

Types:
- USER  - Private user script
- PUB   - Published public script
- TV    - TradingView built-in

Examples:
- USER;bc851e0221464caf9bfce177477fcfe5
- PUB;46a78fe6affb49499224459dc04614d9
- TV;strategy-tester
```

### URL Encoding

Script IDs must be URL-encoded when used in paths:

```
USER;abc123 → USER%3Babc123
```

### Version Numbering

- Major versions: `1.0`, `2.0`, `3.0`
- String format in API responses
- Auto-incremented on save

---

*Generated by HAR analysis tool - December 25, 2025*
