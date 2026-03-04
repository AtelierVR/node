import Main from "../Main";
import Badger from "../auth/badgers/Badger";
import Session from "../auth/sessions/Session";
import Relay from "../relay/Relay";
import NetUser from "../users/NetUser";
import User from "../users/User";
import { Request } from "./NetExpress";
import { IncomingMessage } from "http";
import NetServer from "../server/NetServer";

export default class NetData {
    constructor(private readonly app: Main, private readonly request: Request | IncomingMessage) { }

    private _data: DataTypes | null = null;
    private _auth: AuthenticationTypes | null = null;

    async getAuthenticator(): Promise<AuthenticationTypes | null> {
        if (!this.authBody) return null;
        if (this._auth) return this._auth;
        switch (this.authType) {
            case NetDataType.BEARER:
                this._auth = await this.app.sessions.findSession(this.authBody);
                break;
            case NetDataType.BADGER:
                this._auth = await this.app.badgers.findBadgerByToken(this.authBody);
                break;
            case NetDataType.CHALLENGE:
                this._auth = await this.app.netServers.findChallengeByAuth(this.authBody);
                break;
        }
        return this._auth;
    }

    async getData(): Promise<DataTypes | null> {
        if (!this.authToken) return null;
        if (this._data) return this._data;
        switch (this.authType) {
            case NetDataType.BEARER:
                let s = await this.getAuthenticator();
                if (s instanceof Session) {
                    await s.updateLogs(this.ip, this.request.headers['user-agent'] || '');
                    this._data = await s.getUser() || null;
                }
                break;
            case NetDataType.BADGER:
                let b = await this.getAuthenticator();
                if (b instanceof Badger)
                    this._data = await b.getRelay() || null;
                break;
            case NetDataType.CHALLENGE:
                let c = await this.getAuthenticator();
                if (c instanceof NetServer)
                    this._data = c || null;
                break;
        }
        return this._data;
    }

    get ip(): string {
        var ip = this.request.headers['cf-connecting-ip'] || this.request.headers['x-forwarded-for'] || this.request.connection.remoteAddress || this.request.socket.remoteAddress || '::1';
        if (Array.isArray(ip)) ip = ip[0];
        return ip;
    }

    get userAgent(): string {
        return this.request.headers['user-agent'] || 'unknown';
    }

    get authType(): NetDataType {
        var authentication = (this.authToken || '')?.split(' ');
        switch (authentication[0]) {
            case 'Bearer': return NetDataType.BEARER;
            case 'Challenge': return NetDataType.CHALLENGE;
            case 'Badger': return NetDataType.BADGER;
            default: return NetDataType.NONE;
        }
    }

    get authBody(): string | null {
        var authentication = (this.authToken || '')?.split(' ').slice(1).join(' ');
        if (!authentication) return null;
        return authentication;
    }

    get authToken(): string | null {
        let e = this.request.headers['authorization'];
        if (!e) {
            e = new URLSearchParams(this.request.url?.split('?')[1] || '').get('auth') || undefined;
            if (e) e = `Bearer ${e}`;
            else {
                const cookieHeader = this.request.headers['cookie'];
                if (cookieHeader) {
                    const cookies = cookieHeader.split(';').reduce((acc: Record<string, string>, cookie) => {
                        const [key, value] = cookie.trim().split('=');
                        if (key && value) acc[key] = decodeURIComponent(value);
                        return acc;
                    }, {});
                    const uid = cookies['_uid'];
                    if (uid) e = `Bearer ${uid}`;
                }
            }
        }

        return e || null;
    }

    isBearer() {
        return this.authType === NetDataType.BEARER;
    }

    isBadger() {
        return this.authType === NetDataType.BADGER;
    }

    isChallenge() {
        return this.authType === NetDataType.CHALLENGE;
    }
}

export type AuthenticationTypes = Session | Badger | NetServer;
export type DataTypes = User | NetUser | Relay | NetServer;

export enum NetDataType {
    NONE,
    BEARER,
    BADGER,
    CHALLENGE
}