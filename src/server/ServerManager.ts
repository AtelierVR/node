import { IRServer, ServerAPIWeb } from "./ServerAPIWeb";
import { join } from "node:path";
import { cwd } from "node:process";
import Reileta from "../Main";
import { isValidURL, isValidWSURL } from "../utils/Utils";
import { request } from "undici";
import { arch, platform } from "os";
import NetServer from "./NetServer";
import Env from "../utils/Environment";
import Debug from "../utils/Debug";
import { Security } from "../utils/Security";
import User from "../users/User";

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

    async fetchServer(address: string, server?: NetServer): Promise<IServer | Error> {
        let url: URL;
        if (isValidURL(address))
            url = new URL(address);
        else {
            let fmg = await this.findGatewayMaster(address);
            if (!fmg) return new Error("Error to resolve the server");
            url = fmg;
        }
        if (!url) return new Error("URL is not valid");

        Debug.log("fetching server", url.toString());
        try {
            url.pathname = '/api/server';
            const req = await request(url, {
                method: 'GET',
                headers: {
                    ...this.defaultHeaders,
                    ...(server ? await server.requestHeaders() : {})
                }
            });
            if (req.statusCode === 200) {
                const body = await req.body.json() as { data?: IRServer, error?: { message: string, code: number, status: number } };
                if (body.error) return new Error(body.error.message);
                const data = this.checkServer(body.data);
                if (data) return data;
                return new Error("The server is not valid (invalid data)");
            }
            return new Error("The server is not ready");
        } catch (e: any) {
            return new Error("The server is not valid (" + e.toString() + ")");
        }
    }

    get defaultHeaders() {
        return {
            'User-Agent': `NoxServer/${ServerManager.version} (${platform()}; ${arch()}) Node.js/${process.version}`,
            'X-Nox-Id': this.getInfos().id,
            'X-Nox-Address': this.getInfos().address,
            'X-Nox-Version': this.getInfos().version,
        }
    }

    checkServer(server?: IRServer): IServer | null {
        let tests: any = {
            obj: !server
        }
        if (server)
            tests = {
                ...tests,
                id: !server.id || typeof server.id !== 'string',
                title: !server.title || typeof server.title !== 'string',
                description: !server.description || typeof server.description !== 'string',
                address: !server.address || typeof server.address !== 'string',
                gateways: !server.gateways || typeof server.gateways !== 'object',
                version: !server.version || typeof server.version !== 'string',
                ready_at: !server.ready_at || typeof server.ready_at !== 'number',
                icon: !server.icon || !isValidURL(server.icon),
                certificate: !server.certificate || typeof server.certificate !== 'string',
                features: !server.features || !Array.isArray(server.features) || server.features.some(f => typeof f !== 'string')
            }
        else return null;

        if (server?.gateways)
            tests = {
                ...tests,
                gateways_http: !server.gateways.http || !isValidURL(server.gateways.http),
                gateways_ws: !server.gateways.ws || !isValidWSURL(server.gateways.ws),
                gateways_web: !server.gateways.web || !isValidURL(server.gateways.web)
            }


        if (Object.values(tests).some(t => t)) {
            Debug.error('Invalid server data', tests);
            return null;
        }

        return {
            id: server.id,
            title: server.title,
            description: server.description,
            address: server.address,
            gateways: {
                http: new URL(server.gateways.http),
                ws: new URL(server.gateways.ws),
                web: new URL(server.gateways.web)
            },
            features: server.features,
            version: server.version,
            ready_at: new Date(server.ready_at),
            icon: new URL(server.icon),
            certificate: server.certificate,
        }
    }

    async findGatewayMaster(address: string): Promise<URL | null> {
        const host = address.split(':');
        const ipv4reg = /^((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)(\.(?!$)|$)){4}$/;
        const ipv6reg = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
        const uriType = host[0].match(ipv4reg) ? 'IPv4' : host[0].match(ipv6reg) ? 'IPv6' : 'DNS';

        if (uriType === 'IPv4' || uriType === 'IPv6') {
            let uri = new URL(`tcp://${host[0]}:${host[1] || Env.getPort()}`);
            let fmg = await this.findGM(uri.host, true);
            if (fmg) return fmg;
            return null;
        }

        if (host[0] === "localhost") {
            let uri = new URL(`tcp://${host[0]}:${host[1] || Env.getPort()}`);
            let fmg = await this.findGM(uri.host, true);
            if (fmg) return fmg;
            return null;
        }

        if (uriType === 'DNS') {
            let uri = new URL(`tcp://${host[0]}:${host[1] || Env.getPort()}`);
            let fmg = await this.findGM(uri.host);
            if (fmg) return fmg;
            let txt = await this.findTXT(`_nox.${uri.hostname}`);
            if (txt.length > 0)
                for (const t of txt) {
                    let mg = t.getMasterGateway();
                    if (mg) return mg;
                }
            return null;
        }

        return null;
    }

    async findGM(domain: string, forceHTTP = false): Promise<URL | null> {
        const protos = forceHTTP ? ['http'] : ['https', 'http'];
        for (const protocol of protos) {
            try {
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
            Debug.log("Fetching TXT record for", domain);
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