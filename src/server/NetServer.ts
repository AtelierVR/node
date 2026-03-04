import { NetServer as INetServer } from "@prisma/client";
import Main from "../Main";
import { IServer } from "../server/ServerManager";
import crypto from "crypto";
import { Security } from "../utils/Security";
import Debug from "../utils/Debug";

export default class NetServer implements INetServer {

    constructor(server: INetServer, private readonly app: Main) {
        this.id = server.id;
        this.rank = server.rank;
        this.address = server.address;
        this.cert_blob = server.cert_blob;
        this.cert_expires = server.cert_expires;
        this.last_seen = server.last_seen;
        this.created_at = server.created_at;
        this.updated_at = server.updated_at;
    }

    last_seen: Date;
    created_at: Date;
    updated_at: Date;
    id: number;
    rank: number;
    address: string;
    cert_blob: Uint8Array<ArrayBufferLike>;
    cert_expires: Date;

    get publicCertificate() {
        return Security.derToCertificate(this.cert_blob);
    }

    get publicKey() {
        return this.publicCertificate.publicKey;
    }

    async fetchInfos(): Promise<IServer | null> {
        const data = await this.app.server.fetchServer(this.address, this);
        if (data instanceof Error) {
            Debug.error("Error to fetch server", data);
            return null;
        }
        return data;
    }

    generateChallenge(): string {
        let sign = crypto.createSign('RSA-SHA256');
        let content = [
            Buffer.from(this.app.server.getInfos().address).toString('base64'),
            crypto.createHash('sha256').update(Security.compactPublicKey(Security.publicKeyToPem(this.publicKey))).digest('base64'),
            (Date.now() + 60000).toString(36), // expires in 1 minute
        ].join('.');
        sign.update(content);
        let contentSign = sign.sign(Security.privateToPem(Security.privateKey), 'base64');
        return [content, contentSign].join('.');
    }

    async requestHeaders(): Promise<{ [key: string]: string }> {
        return {
            'Authorization': `Challenge ${this.generateChallenge()}`,
        };
    }
}

export interface ChallengeExported {
    data: Buffer;
    signature: Buffer;
}