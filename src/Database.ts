import { PrismaClient } from "@prisma/client";
import { getAdminDisplay, getAdminId, getAdminPassword, getAdminUsername } from "./utils/Environment";
import UserManager from "./users/UserManager";
import Main from "./Main";
import Debug from "./utils/Debug";
import child_process from "child_process";
import { Security } from "./utils/Security";

export default class Database extends PrismaClient {
    constructor(private readonly app: Main) {
        super({
            errorFormat: 'minimal',
            transactionOptions: {
                maxWait: 1000,
                timeout: 1000,
            },
        });
    }

    async whenReady(): Promise<Error | true> {
        try {
            await this.$connect();
            await this.$disconnect();
        } catch (e) {
            Debug.error("Database connection failed: " + e);
            return new Error("Database connection failed: " + e);
        }
        let updated = false;
        while (!updated) {
            try {
                let admin_id = getAdminId();
                if (!admin_id || !UserManager.isValidId(admin_id))
                    admin_id = 1;
                let cert = Security.generateSubCertificate(getAdminUsername(), `${admin_id}@${this.app.server.getInfos().address}`, 1);
                await this.$transaction([
                    this.user.upsert({
                        where: { id: admin_id },
                        create: {
                            id: admin_id,
                            username: getAdminUsername(),
                            display: getAdminDisplay(),
                            password: getAdminPassword(),
                            links: [this.app.server.getInfos().gateways.http.toString()],
                            cert_blob: Security.certificateToDer(cert),
                            cert_expires: cert.validity.notAfter,
                            key_blob: Security.privateKeyToDer(Security.privateKey),
                            tags: ["sys:admin"],
                        },
                        update: {
                            username: getAdminUsername(),
                            display: getAdminDisplay(),
                            password: getAdminPassword(),
                            links: [this.app.server.getInfos().gateways.http.toString()],
                            tags: ["sys:admin"]
                        }
                    })
                ]);
                updated = true;
            } catch (e) {
                Debug.error("Invalid database schema.");
                Debug.debug("Installing database schema...");
                let migrate = child_process.spawn('npm', ['run', 'deploy']);
                let success = await new Promise<boolean>((resolve, reject) => {
                    migrate.on('close', (code) => {
                        if (code === 0) resolve(true);
                        else resolve(false);
                    });
                });
                if (!success) {
                    return new Error("Failed to install database schema.");
                } else {
                    Debug.debug("Database schema installed.");
                    updated = false;
                }
            }
        }
        return true;
    }

}