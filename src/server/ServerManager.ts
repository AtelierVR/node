import { IRServer, ServerAPIWeb } from "./ServerAPIWeb";
import { join } from "node:path";
import { cwd } from "node:process";
import Reileta from "../Main";
import { isValidURL, isValidWSURL } from "../utils/Utils";
import { Dispatcher, request } from "undici";
import { arch, platform } from "os";
import NetServer from "./NetServer";
import Env from "../utils/Environment";
import Debug from "../utils/Debug";
import { Security } from "../utils/Security";
import User from "../users/User";
import { ErrorCode, ErrorCodes } from "../utils/Constants";
import { JSONSchemaType } from "ajv/dist/types/json-schema";
import { Schema } from "ajv/dist/types";
import Schemas from "../utils/Schemas";
import Ajv, { ErrorObject } from "ajv/dist/core";

export interface IApiResponse<T> {
    data: T | null;
    error: IApiError | undefined;
    time: number;
    request: string;
}

export interface IApiError {
    code: ErrorCode["code"];
    message: string;
    status: ErrorCode["status"];
}

export interface IApiResponseSuccess<T> extends IApiResponse<T> {
    data: T;
    error: undefined;
}

export interface IApiResponseError<T> extends IApiResponse<T> {
    data: T | null;
    error: IApiError;
}

export interface ValidateResponseResult<T> {
    valid: boolean;
    errors: ErrorObject[] | null;
    data: T;
}

export class ServerManager {

    api_web: ServerAPIWeb;


    static isValidId(server: number) {
        return server >= 0n;
    }

    /**
     * Get the package.json
     */
    static get package() {
        return require(join(cwd(), "package.json"));
    }

    /**
     * Get the version
     */
    static get version() {
        return this.package.version;
    }

    constructor(private readonly app: Reileta) {
        this.api_web = new ServerAPIWeb(this.app, this);

        this.app.http.socket.addSubscriber('server_logs', async (socket) => {
            if (!socket.data.isBearer()) return false;
            const user = await socket.data.getData() as User | null;
            if (!user) return false;
            return user.isAdmin();
        });

        // Listen to Debug logs and emit to subscribers
        Debug.onLog((log) => this.app.http.socket.emitSubscriber('server_logs', {
            timestamp: log.timestamp.getTime(),
            level: log.level,
            message: log.message
        }));
    }

    /**
     * Get the server info
     */
    getInfos(): IServer {
        return {
            id: Security.compactPublicKey(Security.publicKeyToPem(Security.publicKey)).slice(0, 24),
            title: Env.getName(),
            description: Env.getDescription(),
            address: Env.getPreferedAddress(),
            gateways: {
                http: new URL(`http${Env.isSecure() ? 's' : ''}://` + Env.getBaseGateway()),
                ws: new URL('/api/ws', `ws${Env.isSecure() ? 's' : ''}://` + Env.getBaseGateway()),
                web: new URL(Env.getWebGateway())
            },
            features: [
                'world',
                'instance',
                'server',
                'user',
                'avatar'
            ],
            version: ServerManager.version,
            ready_at: this.app.ready_at || new Date(),
            icon: Env.getIcon(),
            certificate: Security.compactCertificate(Security.certificateToPem(Security.publicCertificate))
        }
    }

    static async validate<T>(data: any, schema: Schema | JSONSchemaType<T> | string): Promise<ValidateResponseResult<T>> {
        if (typeof schema === 'string') {
            let sch = await Schemas.load(schema);
            if (!sch) {
                Debug.error(`Schema ${schema} not found`);
                return {
                    valid: false,
                    errors: null,
                    data: data
                };
            }
            schema = sch;
        }

        const ajv = new Ajv({ allErrors: true, strict: false });
        const validate = ajv.compile<T>(schema);
        const valid = validate(data);

        if (!valid) {
            let errors = validate.errors || [];
            Debug.dir(data, { depth: null, colors: true });
            Debug.error(errors);
            return {
                valid: false,
                errors,
                data
            };
        }

        return {
            valid: true,
            errors: null,
            data: data as T
        };
    }


    async fetch<T>(endpoint: string | URL, schema: Schema | JSONSchemaType<T> | string, server: NetServer | string, options?: RequestInit & { method?: Dispatcher.HttpMethod }): Promise<IApiResponse<T>> {
        try {
            let url: URL;

            if (typeof server === 'string') {
                if (isValidURL(server)) {
                    url = new URL(server);
                } else {
                    let fmg = await this.findGatewayMaster(server);
                    if (!fmg)
                        throw new Error("Error to resolve the server");
                    url = fmg;
                }
            } else {
                if (isValidURL(server.address)) {
                    url = new URL(server.address);
                } else {
                    let fmg = await this.findGatewayMaster(server.address);
                    if (!fmg)
                        throw new Error("Error to resolve the server");
                    url = fmg;
                }
            }

            if (!url)
                throw new Error("URL is not valid");

            url = ServerManager.mergeURL(url, endpoint);

            const req = await request(url, {
                method: options?.method || 'GET',
                headers: {
                    ...this.defaultHeaders,
                    ...(server && typeof server !== 'string' ? await server.requestHeaders() : {}),
                    ...options?.headers
                },
                body: options?.body
                    ? JSON.stringify(options.body)
                    : undefined,
            });

            const body = await req.body.json() as IApiResponse<T>;
            const validation = await ServerManager.validate<T>(body.data, schema);
            if (!validation.valid) {
                return {
                    data: null,
                    error: {
                        code: ErrorCodes.InvalidField.code,
                        message: "Invalid response from server",
                        status: ErrorCodes.InvalidField.status
                    },
                    time: body.time,
                    request: url.toString()
                }
            }

            return {
                data: body.data,
                error: body.error,
                time: body.time,
                request: url.toString()
            }
        } catch (e: any) {
            return {
                data: null,
                error: {
                    code: ErrorCodes.ServerNotReachable.code,
                    message: e.message,
                    status: ErrorCodes.ServerNotReachable.status
                },
                time: Date.now(),
                request: endpoint instanceof URL ? endpoint.pathname : endpoint
            }
        }
    }

    static mergeURL(base: URL, endpoint: string | URL): URL {
        if (endpoint instanceof URL) 
            return new URL(endpoint.pathname + endpoint.search + endpoint.hash, base);
        return new URL(endpoint, base);
    }

    async fetchServer(address: string, server?: NetServer): Promise<IServer | Error> {
        const res = await this.fetch<IServer>('/api/server', 'servers/info_response', server || address);
        if (res.error) return new Error(res.error.message);
        if (!res.data) return new Error("No data received");
        return res.data;
    }

    get defaultHeaders() {
        return {
            'User-Agent': `NoxServer/${ServerManager.version} (${platform()}; ${arch()}) Node.js/${process.version}`,
            'X-Nox-Id': this.getInfos().id,
            'X-Nox-Address': this.getInfos().address,
            'X-Nox-Version': this.getInfos().version,
        }
    }

    async findGatewayMaster(address: string): Promise<URL | null> {
        const host = address.split(':');
        const ipv4reg = /^((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)(\.(?!$)|$)){4}$/;
        const ipv6reg = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
        const uriType = host[0].match(ipv4reg) ? 'IPv4' : host[0].match(ipv6reg) ? 'IPv6' : 'DNS';

        if (uriType === 'IPv4' || uriType === 'IPv6') {
            Debug.log(`Finding master gateway for IP address ${host[0]} (${uriType}) for ${address}...`);
            let uri = new URL(`tcp://${host[0]}:${host[1] || Env.getPort()}`);
            let fmg = await this.findGM(uri.host, true);
            if (fmg) return fmg;
            return null;
        }

        if (host[0] === "localhost") {
            Debug.log(`Finding master gateway for localhost for ${address}...`);
            let uri = new URL(`tcp://${host[0]}:${host[1] || Env.getPort()}`);
            let fmg = await this.findGM(uri.host, true);
            if (fmg) return fmg;
            return null;
        }

        if (uriType === 'DNS') {
            Debug.log(`Finding master gateway for DNS address ${host[0]} for ${address}...`);
            let uri = new URL(`tcp://${host[0]}:${host[1] || Env.getPort()}`);
            let txt = await this.findTXT(`_nox.${uri.hostname}`);
            if (txt.length > 0)
                for (const t of txt) {
                    Debug.log(`Found TXT record for ${uri.hostname}:`, t);
                    let mg = t.getMasterGateway();
                    if (mg) return mg;
                }
            let fmg = await this.findGM(uri.host);
            if (fmg) return fmg;
            return null;
        }

        return null;
    }

    async findGM(domain: string, forceHTTP = false): Promise<URL | null> {
        const protos = forceHTTP ? ['http'] : ['https', 'http'];
        for (const protocol of protos) {
            try {
                Debug.log(`Finding master gateway for ${protocol.toUpperCase()} protocol for ${domain}...`);
                const uri = new URL(`${protocol}://${domain}/.well-known/nox`);
                const req = await request(uri);
                if (req.statusCode === 200)
                    return new URL(`${protocol}://${domain}`);
            } catch (e) {
                continue;
            }
        }
        return null;
    }

    async findTXT(domain: string): Promise<TXTAnswer[]> {
        try {
            Debug.log(`Fetching TXT record for ${domain}...`);
            const req = await request(`https://dns.google/resolve?name=${domain}&type=TXT`);
            if (req.statusCode === 200) {
                const srv = await req.body.json() as TXT;
                if (srv.Status !== 0) return [];
                return srv.Answer.map(answer => {
                    return {
                        name: answer.name,
                        type: answer.type,
                        TTL: answer.TTL,
                        data: answer.data,
                        getData() {
                            return Object.fromEntries(this.data
                                .split(';')
                                .map(e => e.trim())
                                .filter(e => e.length > 0)
                                .map(e => e.split('='))
                                .map(e => ([e[0], e.slice(1).join('=')])))
                        },
                        getMasterGateway() {
                            let mg = this.getData()['mg'];
                            if (isValidURL(mg))
                                return new URL(mg);
                            return null;
                        }
                    }
                });
            }
        } catch (e) {
            return [];
        }
        return [];
    }

    getStatus(): Status {
        if (!this.app.ready_at)
            return {
                code: "starting",
                deprecated: null,
                security: null,
                error: null,
                maintenance: null
            };
        return {
            code: "online",
            deprecated: null,
            security: null,
            error: null,
            maintenance: null
        }
    }
}

export interface Status {
    code: "online" | "starting" | "stopping" | "offline" | "security" | "error" | "maintenance" | "deprecated";
    deprecated: {
        message: string;
        address: string;
        closing_date: Date | null;
    } | null;
    security: {
        message: string;
        features_disabled: string[];
    } | null;
    maintenance: {
        message: string;
        start_date: Date | null;
        end_date: Date | null;
    } | null;
    error: {
        message: string;
        code: number;
    } | null;
}

export interface TXT {
    Status: number;
    Answer: TXTAnswer[];
}

export interface TXTAnswer {
    name: string;
    type: number;
    TTL: number;
    data: string;
    getData(): { [key: string]: string };
    getMasterGateway(): URL | null;
}

export interface IServer {
    id: string;
    title: string;
    description: string;
    address: string;
    gateways: {
        http: URL;
        ws: URL;
        web: URL;
    };
    features: string[];
    version: string;
    ready_at: Date;
    icon: URL;
    certificate: string;
}


export function isOwnServerAddress(address: string): boolean {
    if (address === Env.getPreferedAddress())
        return true;
    return [
        /127\.\d+\.\d+\.\d+/,
        /0\.\d+\.\d+\.\d+/,
    ].some(reg => reg.test(address));
}