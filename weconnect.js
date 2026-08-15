/*
 * weconnect.js — VW EU Data Act portal client for MMM-WeConnect
 *
 * The old VW WeConnect portal (portal.volkswagen-we.com) was shut down.
 * This implementation uses the EU Data Act portal at
 * https://eu-data-act.drivesomethinggreater.com, which publishes 15-minute
 * vehicle snapshots (battery, range, charging, mileage, etc.) for all VW
 * Group brands.
 *
 * PREREQUISITE: You must activate continuous data once in a browser:
 *   1. Go to https://eu-data-act.drivesomethinggreater.com/
 *   2. Log in with your VW credentials (same email/password as the app)
 *   3. Connect your car under "Data clusters → Vehicle overview"
 *   4. Click "Get customised data" → select All data, frequency 15 minutes
 *
 * Ported from TA2k/ioBroker.vw-connect (lib/euDataAct.js).
 */

"use strict";

const zlib = require("zlib");

// ─── Constants ───────────────────────────────────────────────────────────────

const BASE_URL       = "https://eu-data-act.drivesomethinggreater.com";
const IDENTITY_BASE  = "https://identity.vwgroup.io";
const OIDC_CLIENT_ID = "9b58543e-1c15-4193-91d5-8a14145bebb0@apps_vw-dilab_com";
const OIDC_SCOPE     = "openid cars profile";
const OIDC_REDIRECT  = BASE_URL + "/login";
const OIDC_STATE     = "de__en__VOLKSWAGEN_PASSENGER_CARS";
const USER_AGENT     = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const NO_CONTENT_SUFFIX = "_no_content_found.zip";

/** Thrown when the portal is accessible but the user needs to do browser setup. */
class SetupRequiredError extends Error {
    constructor(msg) { super(msg); this.name = "SetupRequiredError"; }
}
exports.SetupRequiredError = SetupRequiredError;

const VEHICLES_PATH = "/proxy_api/consent/me/vehicles";
const METADATA_PATH = "/proxy_api/euda-apim/datarequest/vehicles/{vin}/metadata/partial";
const LIST_PATH     = "/proxy_api/euda-apim/datadelivery/vehicles/{vin}/{id}/list";
const DOWNLOAD_PATH = "/proxy_api/euda-apim/datadelivery/vehicles/{vin}/{id}/download";

// Sentinel values the portal emits when a sensor has no current reading
const GENERIC_INT_SENTINELS = new Set([65535, 2147483647, 4294967295]);
const MINUS_ONE_SENTINEL_FIELDS = new Set([
    "remaining_charging_time",
    "remaining_charging_time_to_complete",
    "battery_state_report.remaining_charging_time_complete",
    "battery_state_report.remaining_charging_time_bulk",
    "remaining_charging_time_target_soc",
]);
const MONOTONIC_FIELDS = new Set(["mileage.value", "mileage"]);
const FIELD_ALIASES = {
    remaining_climatisation_time:   "remaining_climate_time",
    charging_plug1_connectionstate: "plug_state",
};
const SUM_FALLBACKS = [{
    target:     "cruising_range_combined",
    components: ["cruising_range_primary_engine", "cruising_range_secondary_engine"],
}];

// ─── HTML helpers ────────────────────────────────────────────────────────────

function parseFirstForm(html) {
    const m = /<form\b[^>]*\baction=("[^"]*"|'[^']*'|[^\s>]+)[^>]*>([\s\S]*?)<\/form>/i.exec(html);
    if (!m) return { action: null, fields: {} };
    const action = m[1].replace(/^['"]|['"]$/g, "");
    const fields = {};
    const re = /<input\b[^>]*>/gi;
    let t;
    while ((t = re.exec(m[2])) !== null) {
        const nm = /\bname=("[^"]*"|'[^']*'|[^\s>]+)/i.exec(t[0]);
        if (!nm) continue;
        const name = nm[1].replace(/^['"]|['"]$/g, "");
        const val  = /\bvalue=("[^"]*"|'[^']*'|[^\s>]+)/i.exec(t[0]);
        fields[name] = val ? val[1].replace(/^['"]|['"]$/g, "") : "";
    }
    return { action, fields };
}

function extractTemplateModel(html) {
    const idx = html.indexOf("templateModel");
    if (idx < 0) return null;
    const brace = html.indexOf("{", idx);
    if (brace < 0) return null;
    let depth = 0;
    for (let i = brace; i < html.length; i++) {
        if (html[i] === "{") depth++;
        else if (html[i] === "}") {
            if (--depth === 0) {
                try { return JSON.parse(html.substring(brace, i + 1)); } catch { return null; }
            }
        }
    }
    return null;
}

function extractCsrf(html) {
    const m = /csrf_token\s*[:=]\s*['"]([^'"]+)['"]/.exec(html);
    return m ? m[1] : null;
}

function loginFields(html) {
    const form   = parseFirstForm(html);
    const fields = { ...form.fields };
    const model  = extractTemplateModel(html) || {};
    for (const key of ["hmac", "relayState"]) {
        if (model[key]) fields[key] = model[key];
    }
    const email = (model.emailPasswordForm || {}).email;
    if (email && fields.email == null) fields.email = email;
    const csrf = extractCsrf(html);
    if (csrf && fields._csrf == null) fields._csrf = csrf;
    return { fields, action: form.action };
}

// ─── ZIP parser (built-in zlib, no external deps) ────────────────────────────

function unzipFirstJson(buf, name) {
    let off = 0;
    while (off + 30 <= buf.length) {
        if (buf.readUInt32LE(off) !== 0x04034b50) break;
        const flags    = buf.readUInt16LE(off + 6);
        const method   = buf.readUInt16LE(off + 8);
        const compSize = buf.readUInt32LE(off + 18);
        const nameLen  = buf.readUInt16LE(off + 26);
        const extraLen = buf.readUInt16LE(off + 28);
        const fileName = buf.slice(off + 30, off + 30 + nameLen).toString("utf-8");
        const dataStart = off + 30 + nameLen + extraLen;
        let entrySize = compSize;
        if ((flags & 0x08) && compSize === 0) {
            let scan = dataStart;
            while (scan + 4 <= buf.length) { if (buf.readUInt32LE(scan) === 0x08074b50) break; scan++; }
            entrySize = scan - dataStart;
        }
        const compressed = buf.slice(dataStart, dataStart + entrySize);
        if (fileName.toLowerCase().endsWith(".json")) {
            let raw;
            if      (method === 0) raw = compressed;
            else if (method === 8) raw = zlib.inflateRawSync(compressed);
            else throw new Error(`Unsupported zip method ${method}`);
            let text = raw.toString("utf-8");
            if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
            return { fileName, json: JSON.parse(text) };
        }
        off = dataStart + entrySize;
        if (flags & 0x08) off += (buf.readUInt32LE(off) === 0x08074b50) ? 16 : 12;
    }
    throw new Error(`No JSON entry found inside ${name}`);
}

// ─── Data normalisation ──────────────────────────────────────────────────────

function isSentinel(value, fieldName) {
    if (value === null || value === undefined) return true;
    if (typeof value === "string" && value.trim() === "") return true;
    const num = typeof value === "number" ? value : parseFloat(value);
    if (!Number.isFinite(num)) return false;
    if (GENERIC_INT_SENTINELS.has(num)) return true;
    if (MINUS_ONE_SENTINEL_FIELDS.has(fieldName) && num === -1) return true;
    if (fieldName && fieldName.includes("tyre_pressure") && (num === 0 || num === 1)) return true;
    return false;
}

function coerceValue(raw) {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === "number" || typeof raw === "boolean") return raw;
    const n = Number(raw);
    return (!isNaN(n) && String(raw).trim() !== "") ? n : raw;
}

function setNested(obj, dottedKey, value) {
    const parts = dottedKey.split(".");
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        if (cur[parts[i]] == null || typeof cur[parts[i]] !== "object") cur[parts[i]] = {};
        cur = cur[parts[i]];
    }
    const leaf = parts[parts.length - 1];
    if (cur[leaf] != null && typeof cur[leaf] === "object" && typeof value !== "object") {
        cur[leaf]._value = value;
    } else {
        cur[leaf] = value;
    }
}

function normalizeDataset(payload) {
    const points = {};
    let seq = 0;
    for (const item of payload.Data || []) {
        if (!item || !item.key) continue;
        let field = item.dataFieldName || item.key;
        if (!field) continue;
        if (FIELD_ALIASES[field]) field = FIELD_ALIASES[field];
        const s = isSentinel(item.value, field);
        const cur = points[field];
        if (!cur) { points[field] = { item, seq: seq++, s }; continue; }
        if (cur.s && !s) { cur.item = item; cur.seq = seq++; cur.s = false; continue; }
        if (!cur.s && s) continue;
        if (MONOTONIC_FIELDS.has(field)) {
            const a = parseFloat(item.value), b = parseFloat(cur.item.value);
            if (Number.isFinite(a) && (!Number.isFinite(b) || a > b)) { cur.item = item; cur.seq = seq++; cur.s = s; }
        } else if (seq > cur.seq) {
            cur.item = item; cur.seq = seq++; cur.s = s;
        } else { seq++; }
    }
    const out = {};
    for (const [field, { item, s }] of Object.entries(points)) {
        if (!s) setNested(out, field, coerceValue(item.value));
    }
    for (const { target, components } of SUM_FALLBACKS) {
        if (points[target] && !points[target].s) continue;
        let sum = 0, any = false;
        for (const c of components) {
            const p = points[c];
            if (!p || p.s) continue;
            const n = parseFloat(p.item.value);
            if (Number.isFinite(n)) { sum += n; any = true; }
        }
        if (any) setNested(out, target, sum);
    }
    out._meta = { vin: payload.vin || null, points: (payload.Data || []).length };
    return out;
}

// ─── HTTP client ─────────────────────────────────────────────────────────────

// Minimal cookie jar: stores cookies per hostname, handles redirect chains.
class CookieJar {
    constructor() { this._store = {}; }

    set(url, setCookieHeaders) {
        const h = new URL(url).hostname;
        if (!this._store[h]) this._store[h] = {};
        for (const hdr of (setCookieHeaders || [])) {
            const [kv] = hdr.split(";");
            const eq = kv.indexOf("=");
            if (eq < 0) continue;
            this._store[h][kv.slice(0, eq).trim()] = kv.slice(eq + 1).trim();
        }
    }

    header(url) {
        const h = new URL(url).hostname;
        const jar = this._store[h] || {};
        return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
    }

    reset() { this._store = {}; }
}

class VwEuDataActClient {
    constructor(email, password, log) {
        this.email    = email;
        this.password = password;
        this.log      = log || (() => {});
        this.jar      = new CookieJar();
        this._loggedIn = false;
    }

    // Fetch with manual redirect following so cookies are sent per-domain.
    async _fetch(method, url, opts = {}) {
        let currentUrl = url;
        let currentMethod = method;
        let body = opts.body;

        for (let i = 0; i <= 10; i++) {
            const cookieHdr = this.jar.header(currentUrl);
            const headers = {
                "User-Agent": USER_AGENT,
                ...(cookieHdr ? { Cookie: cookieHdr } : {}),
                ...(opts.headers || {}),
            };
            if (body && currentMethod === "POST") {
                headers["Content-Type"] = "application/x-www-form-urlencoded";
            }

            const resp = await fetch(currentUrl, {
                method: currentMethod,
                headers,
                body: currentMethod === "POST" ? body : undefined,
                redirect: "manual",
            });

            // Collect Set-Cookie headers from this hop
            const setCookies = resp.headers.getSetCookie
                ? resp.headers.getSetCookie()
                : [resp.headers.get("set-cookie")].filter(Boolean);
            this.jar.set(currentUrl, setCookies);

            // Follow redirect manually
            if (resp.status >= 301 && resp.status <= 308 && resp.headers.has("location")) {
                currentUrl = new URL(resp.headers.get("location"), currentUrl).toString();
                if (resp.status === 301 || resp.status === 302 || resp.status === 303) {
                    currentMethod = "GET";
                    body = undefined;
                }
                continue;
            }

            return { resp, finalUrl: currentUrl };
        }
        throw new Error(`Too many redirects from ${url}`);
    }

    async _getText(url, headers) {
        const { resp, finalUrl } = await this._fetch("GET", url, { headers });
        const text = await resp.text();
        this.log(`[weconnect] GET ${url} → ${resp.status} (${text.length}B)`);
        return { status: resp.status, url: finalUrl, body: text };
    }

    async _postForm(url, form, extra) {
        const body = new URLSearchParams(form).toString();
        const { resp, finalUrl } = await this._fetch("POST", url, {
            body,
            headers: extra || {},
        });
        const text = await resp.text();
        this.log(`[weconnect] POST ${url} → ${resp.status} (${text.length}B) landed=${finalUrl}`);
        return { status: resp.status, url: finalUrl, body: text };
    }

    async _getBuffer(url, headers) {
        const { resp } = await this._fetch("GET", url, {
            headers: { Accept: "application/zip,application/octet-stream,*/*", ...(headers || {}) },
        });
        const buf = Buffer.from(await resp.arrayBuffer());
        this.log(`[weconnect] GET ${url} (binary) → ${resp.status} (${buf.length}B)`);
        return { status: resp.status, body: buf };
    }

    async _getJson(url, headers, _retry = false) {
        const r = await this._getText(url, { Accept: "application/json", ...(headers || {}) });
        const aemHtml = r.status >= 500 && r.body && r.body.trimStart().startsWith("<");
        if ((r.status === 401 || r.status === 403 || aemHtml) && !_retry) {
            this.log(`[weconnect] Session expired (${r.status}), re-logging in`);
            this._loggedIn = false;
            this.jar = new CookieJar();
            await this.login();
            return this._getJson(url, headers, true);
        }
        if (r.status === 401 || r.status === 403) {
            throw new Error(
                `HTTP ${r.status} from portal API — login session not established. ` +
                `Please complete one-time setup at ${BASE_URL}/ in a browser first ` +
                `(log in with your VW credentials, connect your car, and set up continuous data).`
            );
        }
        if (r.status >= 400) throw new Error(`GET ${url} → HTTP ${r.status}: ${r.body.substring(0, 200)}`);
        try {
            return JSON.parse(r.body);
        } catch (e) {
            throw new Error(`Invalid JSON from ${url}: ${r.body.substring(0, 200)}`);
        }
    }

    async login() {
        this.log("[weconnect] Starting EU Data Act portal login");

        // Prime portal session cookies
        try { await this._getText(BASE_URL + "/"); } catch (_) { /* ignore */ }

        // Build OIDC authorize URL with required state parameter
        const params = new URLSearchParams({
            client_id:     OIDC_CLIENT_ID,
            response_type: "code",
            scope:         OIDC_SCOPE,
            state:         OIDC_STATE,
            redirect_uri:  OIDC_REDIRECT,
            prompt:        "login",
        });
        const authUrl = `${IDENTITY_BASE}/oidc/v1/authorize?${params.toString()}`;
        const signin  = await this._getText(authUrl);
        if (signin.status !== 200) throw new Error(`VW identity authorize returned HTTP ${signin.status}`);

        // Step 1: POST email (identifier step)
        let { fields, action } = loginFields(signin.body);
        if (!fields.hmac || !fields._csrf) throw new Error("Could not parse VW sign-in form – portal layout may have changed");
        fields.email = this.email;
        const idAction = new URL(action || "", signin.url).toString();
        this.log(`[weconnect] Submitting email to ${idAction}`);
        const pwPage   = await this._postForm(idAction, fields, { Referer: signin.url });

        // Step 2: POST password (authenticate step)
        ({ fields, action } = loginFields(pwPage.body));
        if (!fields.hmac || !fields._csrf) {
            const model = extractTemplateModel(pwPage.body) || {};
            const msg   = (model.error && (model.error.text || model.error)) || "Identity portal did not return password form – check your email address";
            throw new Error(msg);
        }
        fields.email    = this.email;
        fields.password = this.password;
        const authAction = action ? new URL(action, pwPage.url).toString() : pwPage.url.split("?", 1)[0];
        this.log(`[weconnect] Submitting password to ${authAction}`);
        const landing    = await this._postForm(authAction, fields, { Referer: pwPage.url });

        this.log(`[weconnect] Login landed at: ${landing.url} (status ${landing.status})`);

        if (landing.status >= 400) throw new Error(`VW login rejected (HTTP ${landing.status})`);
        if (landing.url.includes("signin-service") || landing.url.includes("/error")) {
            const model   = extractTemplateModel(landing.body) || {};
            const errCode = model.error || new URL(landing.url).searchParams.get("error") || "unknown";
            throw new Error(`VW login failed: ${errCode} – check your credentials`);
        }
        if (new URL(landing.url).host !== new URL(BASE_URL).host) {
            throw new Error(
                `Login did not complete (landed at ${landing.url}). ` +
                `Please log in once at ${BASE_URL}/ in a browser to accept the EU Data Act portal consent.`
            );
        }
        this.log("[weconnect] Login successful");
        this._loggedIn = true;
    }

    async ensureLogin() {
        if (!this._loggedIn) await this.login();
    }

    /** Returns array of VIN strings for all vehicles linked to the account. */
    async listVehicles() {
        await this.ensureLogin();
        const payload = await this._getJson(`${BASE_URL}${VEHICLES_PATH}?viewPosition=FRONT_LEFT`);
        const list    = Array.isArray(payload) ? payload : (payload && payload.vehicles) || [];
        return list.map(v => (typeof v === "string" ? v : v.vin)).filter(Boolean);
    }

    /** Fetch the latest available dataset for the given VIN. */
    async getLatestDataset(vin) {
        await this.ensureLogin();

        // Get the data-request Identifier for this VIN
        const metaUrl = `${BASE_URL}${METADATA_PATH.replace("{vin}", vin)}`;
        let meta;
        try {
            meta = await this._getJson(metaUrl);
        } catch (err) {
            if (err.message && err.message.includes("404")) {
                throw new SetupRequiredError(
                    `No continuous data request found for VIN ${vin}.\n` +
                    `  → Open ${BASE_URL}/ in a browser and log in with your VW credentials.\n` +
                    `  → Go to: Data clusters → Vehicle overview → Connect your car\n` +
                    `  → Click "Get customised data" → All data → Frequency: 15 minutes\n` +
                    `  Once done, data will start appearing within ~15 minutes.`
                );
            }
            throw err;
        }
        if (!meta || !meta.Identifier) {
            throw new SetupRequiredError(
                `No active continuous data request for VIN ${vin}. ` +
                `Please set up data at ${BASE_URL}/ → Data clusters → Vehicle overview → Get customised data.`
            );
        }
        const id = meta.Identifier;

        // List available datasets, skip empty "no content" entries
        const listUrl  = `${BASE_URL}${LIST_PATH.replace("{vin}", vin).replace("{id}", id)}`;
        let datasets;
        try {
            datasets = await this._getJson(listUrl, { type: "partial" });
        } catch (err) {
            // 404 "No files available" is normal when the car hasn't been active yet
            if (err.message && err.message.includes("404")) {
                throw new SetupRequiredError(
                    `No data files available yet for VIN ${vin}.\n` +
                    `  The portal generates snapshots every ~15 min when the car is active.\n` +
                    `  → Open the VW app and trigger a sync, OR drive/charge the car.\n` +
                    `  The module will automatically pick up data once it appears.`
                );
            }
            throw err;
        }
        const files    = (Array.isArray(datasets) ? datasets : datasets.files || [])
            .filter(d => d && d.name && !d.name.endsWith(NO_CONTENT_SUFFIX));

        if (!files.length) {
            throw new Error(
                "No data available yet. The portal generates datasets every ~15 minutes when the car is active. " +
                "Try driving or charging the car to trigger data collection."
            );
        }

        // Sort by createdOn descending, take the newest
        const newest = files.slice().sort(
            (a, b) => String(b.createdOn || b.name).localeCompare(String(a.createdOn || a.name))
        )[0];

        // Download and parse the ZIP
        const dlUrl = `${BASE_URL}${DOWNLOAD_PATH.replace("{vin}", vin).replace("{id}", id)}`;
        const buf   = await this._getBuffer(dlUrl, { filename: newest.name, type: "partial" });
        if (buf.status >= 400) throw new Error(`Dataset download failed: HTTP ${buf.status}`);

        const { json } = unzipFirstJson(buf.body, newest.name);
        const normalized = normalizeDataset(json);
        normalized._datasetName = newest.name;
        normalized._createdOn   = newest.createdOn || null;
        return normalized;
    }
}

// ─── Module exports ──────────────────────────────────────────────────────────

exports.login = function (email, password, log) {
    const instance = new VwEuDataActClient(email, password, log);
    return {
        listVehicles:      () => instance.listVehicles(),
        getLatestDataset:  (vin) => instance.getLatestDataset(vin),
    };
};

/*
*/
