import Main from "../Main";
import Debug from "../utils/Debug";
import { PublicCertificate, Security } from "../utils/Security";
import NetServer from "./NetServer";
import crypto from "crypto";

export default class NetServerManager {
    constructor(private readonly app: Main) {
    }

    async initDiscover(address: string): Promise<NetServer | Error> {
        if (!address) return new Error("Invalid address");

        let server = await this.findNetServerByAddress(address);

        if (server) {
            Debug.log(`Server ${address} already registered.`);
            return server;
        }

        Debug.log(`Discovering server at ${address}...`);

        const data = await this.app.server.fetchServer(address);
        if (data instanceof Error) {
            Debug.error(`Failed to discover server at ${address}: ${data.message}`);
            return data
        }

        let cert: PublicCertificate;
        try {
            cert = Security.pemToCertificate(data.certificate);
            if (!cert) {
                Debug.error(`Invalid certificate for server at ${address}`);
                return new Error("Invalid certificate");
            }
        } catch (e) {
            Debug.error(`Failed to parse certificate for server at ${address}: ${e instanceof Error ? e.message : e}`);
            return new Error("Failed to parse certificate");
        }

        if (!cert.validity || !cert.validity.notAfter || cert.validity.notAfter < new Date()) {
            Debug.error(`Certificate for server at ${address} is expired.`);
            return new Error("Certificate expired");
        }

        return await this.createNetServer({
            address: data.address,
            certificate: cert
        }) || new Error("Failed to create NetServer");
    }

    async findOrInitServer(address: string): Promise<NetServer | Error> {
        let server = await this.findNetServerByAddress(address);
        if (server) return server;
        return await this.initDiscover(address);
    }

    async findChallengeByAuth(authBody: string): Promise<NetServer | null> {
        if (!authBody) return null;
        const parts = authBody.split('.');
        if (parts.length !== 4) return null;

        const serverAddress = Buffer.from(parts[0], 'base64').toString('utf-8');
        const publicMyKeyHash = parts[1];
        const expires = new Date(parseInt(parts[2], 36));
        const contentSign = parts[3];
        if (expires < new Date()) {
            Debug.error("Challenge expired");
            return null;
        }

        const server = await this.findNetServerByAddress(serverAddress);
        if (!server) return null;

        const myPublicKey = Security.publicKey;
        const myPublicKeyHash = crypto.createHash('sha256').update(Security.compactPublicKey(Security.publicKeyToPem(myPublicKey))).digest('base64');

        if (publicMyKeyHash !== myPublicKeyHash) {
            Debug.error("Public key hash mismatch");
            return null;
        }

        const sign = crypto.createVerify('RSA-SHA256');
        const content = [
            parts[0],
            myPublicKeyHash,
            expires.getTime().toString(36)
        ].join('.');
        sign.update(content);

        if (!sign.verify(Security.publicKeyToPem(server.publicKey), contentSign, 'base64')) {
            Debug.error("Signature verification failed");
            return null;
        }

        return server;
    }

    async findNetServerByAddress(address: string): Promise<NetServer | null> {
        try {
            const server = await this.app.database.netServer.findFirst({ where: { address } });
            if (!server) return null;
            return new NetServer(server, this.app);
        } catch { return null; }
    }


    async findNetServerById(id: number): Promise<NetServer | null> {
        try {
            const server = await this.app.database.netServer.findFirst({ where: { id } });
            if (!server) return null;
            return new NetServer(server, this.app);
        } catch { return null; }
    }


    async createNetServer(data: IMakeNetServer): Promise<NetServer | null> {
        try {
            const server = await this.app.database.netServer.create({
                data: {
                    address: data.address,
                    cert_blob: Security.certificateToDer(data.certificate),
                    cert_expires: data.certificate.validity.notAfter,
                }
            });
            return new NetServer(server, this.app);
        } catch (e) {
            Debug.error(e);
        }
        return null;
    }
}

export interface IMakeNetServer {
    address: string;
    certificate: PublicCertificate;
}
