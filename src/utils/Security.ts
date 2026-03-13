import { join } from "node:path";
import crypto, { createHash, generateKeyPair, generateKeyPairSync } from "node:crypto";
import * as forge from "node-forge";
import Env from "./Environment";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import Debug from "./Debug";

export interface PublicCertificate extends forge.pki.Certificate {
    publicKey: forge.pki.rsa.PublicKey;
}


/**
 * Security utilities for managing RSA keys and certificates
 * Handles generation, validation, and management of cryptographic materials
 */
export class Security {

    static isPem(public_key: string) {
        try {
            this.pemToPublicKey(public_key);
            return true;
        } catch {
            Debug.warn("Invalid public key format", public_key);
            return false;
        }
    }

    static publicKeyToFingerprint(pk: forge.pki.rsa.PublicKey): string {
        const blob = this.publicKeyToDer(pk);
        return createHash('sha256').update(blob).digest('hex');
    }

    /**
     * Get the private RSA key
     */
    static get privateKey(): forge.pki.rsa.PrivateKey {
        if (!existsSync(Env.sync('PRIVATEKEY_FILE')))
            this.storeCertificate(this.generateCertificate());
        return forge.pki.privateKeyFromPem(readFileSync(Env.sync('PRIVATEKEY_FILE'), "utf-8"));
    }

    static get publicCertificate(): PublicCertificate {
        if (!existsSync(Env.sync('CERTIFICATE_FILE')))
            this.storeCertificate(this.generateCertificate());
        return forge.pki.certificateFromPem(readFileSync(Env.sync('CERTIFICATE_FILE'), "utf-8")) as PublicCertificate;
    }

    static get publicKey(): forge.pki.rsa.PublicKey {
        return this.publicCertificate.publicKey;
    }

    static pemToPublicKey(publicKey: string): forge.pki.rsa.PublicKey {
        if (!publicKey.startsWith('-'))
            publicKey = this.uncompactPublicKey(publicKey);
        return forge.pki.publicKeyFromPem(publicKey);
    }

    static privateToPem(privateKey: forge.pki.rsa.PrivateKey): string {
        return forge.pki.privateKeyToPem(privateKey);
    }

    static publicKeyToPem(publicKey: forge.pki.rsa.PublicKey): string {
        return forge.pki.publicKeyToPem(publicKey);
    }

    static certificateToPem(certificate: forge.pki.Certificate): string {
        return forge.pki.certificateToPem(certificate);
    }

    static pemToCertificate(certificate: string): PublicCertificate {
        if (!certificate.startsWith('-'))
            certificate = this.uncompactCertificate(certificate);
        return forge.pki.certificateFromPem(certificate) as PublicCertificate;
    }

    static derToCertificate(blob: Uint8Array<ArrayBufferLike>): PublicCertificate {
        let der = Buffer.from(blob).toString('binary');
        return forge.pki.certificateFromAsn1(forge.asn1.fromDer(der)) as PublicCertificate;
    }

    static certificateToDer(certificate: PublicCertificate): Uint8Array<ArrayBufferLike> {
        const der = forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes();
        return new Uint8Array(Buffer.from(der, 'binary'));
    }

    static derToPrivateKey(blob: Uint8Array<ArrayBufferLike>): forge.pki.rsa.PrivateKey {
        let der = Buffer.from(blob).toString('binary');
        return forge.pki.privateKeyFromAsn1(forge.asn1.fromDer(der));
    }

    static privateKeyToDer(privateKey: forge.pki.rsa.PrivateKey): Uint8Array<ArrayBufferLike> {
        const der = forge.asn1.toDer(forge.pki.privateKeyToAsn1(privateKey)).getBytes();
        return new Uint8Array(Buffer.from(der, 'binary'));
    }

    static derToPublicKey(blob: Uint8Array<ArrayBufferLike>): forge.pki.rsa.PublicKey {
        let der = Buffer.from(blob).toString('binary');
        return forge.pki.publicKeyFromAsn1(forge.asn1.fromDer(der));
    }

    static publicKeyToDer(publicKey: forge.pki.rsa.PublicKey): Uint8Array<ArrayBufferLike> {
        const der = forge.asn1.toDer(forge.pki.publicKeyToAsn1(publicKey)).getBytes();
        return new Uint8Array(Buffer.from(der, 'binary'));
    }

    static storeCertificate(certificate: forge.pki.Certificate) {
        var parentPrivate = join(Env.sync('PRIVATEKEY_FILE'), '..');
        var parentCert = join(Env.sync('CERTIFICATE_FILE'), '..');
        if (!existsSync(parentPrivate)) mkdirSync(parentPrivate, { recursive: true });
        if (!existsSync(parentCert)) mkdirSync(parentCert, { recursive: true });
        writeFileSync(Env.sync('PRIVATEKEY_FILE'), Security.privateToPem(certificate.privateKey as forge.pki.rsa.PrivateKey), 'utf-8');
        writeFileSync(Env.sync('CERTIFICATE_FILE'), Security.certificateToPem(certificate), 'utf-8');
    }

    /**
     * Generate the RSA keys and certificate
     */
    static generateCertificate(): forge.pki.Certificate {

        // Generate RSA key pair
        const Der = generateKeyPairSync('rsa', {
            modulusLength: 4096,
            publicKeyEncoding: {
                type: 'spki',
                format: 'pem'
            },
            privateKeyEncoding: {
                type: 'pkcs8',
                format: 'pem',
            }
        });

        const publicKey = forge.pki.publicKeyFromPem(Der.publicKey);
        const privateKey = forge.pki.privateKeyFromPem(Der.privateKey);

        // Create self-signed certificate
        const cert = forge.pki.createCertificate();
        cert.publicKey = publicKey;
        cert.privateKey = privateKey;
        cert.serialNumber = forge.util.bytesToHex(forge.random.getBytesSync(16));
        cert.validity.notBefore = new Date();
        cert.validity.notAfter = new Date();
        cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
        let attr = [{
            name: 'commonName',
            value: Env.sync('TITLE') || 'A Nox Node Server',
        }];
        cert.setSubject(attr);
        cert.setIssuer(attr); // Self-signed
        cert.setExtensions([]);

        cert.sign(
            privateKey,
            forge.md.sha256.create()
        );

        return cert;
    }

    /**
     * Generate a new identity signed by a CA identity
     * @param caIdentity The CA identity to sign the new certificate
     * @param commonName Common name for the new certificate (optional)
     * @param validityYears Certificate validity in years (default: 1)
     */
    static generateSubCertificate(name: string, email: string, validityYears: number = 1): PublicCertificate {
        // Generate new RSA key pair for the new identity
        const newKeyPair = generateKeyPairSync('rsa', {
            modulusLength: 4096,
            publicKeyEncoding: {
                type: 'spki',
                format: 'pem'
            },
            privateKeyEncoding: {
                type: 'pkcs8',
                format: 'pem',
            }
        });

        const privateKey = forge.pki.privateKeyFromPem(newKeyPair.privateKey);
        const publicKey = forge.pki.publicKeyFromPem(newKeyPair.publicKey);

        const caPrivateKey = this.privateKey;
        const caCert = this.publicCertificate;
        const caPublicKey = caCert.publicKey;
        if (!caPrivateKey || !caPublicKey || !caCert)
            throw new Error("CA identity is not valid");

        // Create new certificate
        const cert = forge.pki.createCertificate();
        cert.publicKey = publicKey;
        cert.privateKey = privateKey;
        cert.serialNumber = forge.util.bytesToHex(forge.random.getBytesSync(16));
        cert.validity.notBefore = new Date();
        cert.validity.notAfter = new Date();
        cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + validityYears);

        // Set subject attributes
        cert.setSubject([{
            name: 'commonName',
            value: name
        }, {
            name: 'emailAddress',
            value: email
        }]);

        // Set issuer from CA certificate
        cert.setIssuer(caCert.subject.attributes);

        // Set certificate extensions
        cert.setExtensions([
            {
                name: 'basicConstraints',
                cA: false
            },
            {
                name: 'keyUsage',
                keyCertSign: false,
                digitalSignature: true,
                nonRepudiation: true,
                keyEncipherment: true,
                dataEncipherment: true
            },
            {
                name: 'extKeyUsage',
                serverAuth: true,
                clientAuth: true
            }
        ]);

        // Sign the new certificate with the CA private key
        cert.sign(
            caPrivateKey,
            forge.md.sha256.create()
        );

        return cert as PublicCertificate;
    }

    static compactCertificate(certificate: string): string {
        return certificate
            .replace(/-----BEGIN CERTIFICATE-----/g, '')
            .replace(/-----END CERTIFICATE-----/g, '')
            .replace(/\s+/g, '');
    }

    static compactPrivateKey(privateKey: string): string {
        return privateKey
            .replace(/-----BEGIN PRIVATE KEY-----/g, '')
            .replace(/-----END PRIVATE KEY-----/g, '')
            .replace(/\s+/g, '');
    }

    static compactPublicKey(publicKey: string): string {
        return publicKey
            .replace(/-----BEGIN PUBLIC KEY-----/g, '')
            .replace(/-----END PUBLIC KEY-----/g, '')
            .replace(/\s+/g, '');
    }

    static uncompactCertificate(certificate: string): string {
        return `-----BEGIN CERTIFICATE-----\n${certificate.match(/.{1,64}/g)?.join('\n')}\n-----END CERTIFICATE-----`;
    }

    static uncompactPrivateKey(privateKey: string): string {
        return `-----BEGIN PRIVATE KEY-----\n${privateKey.match(/.{1,64}/g)?.join('\n')}\n-----END PRIVATE KEY-----`;
    }

    static uncompactPublicKey(publicKey: string): string {
        return `-----BEGIN PUBLIC KEY-----\n${publicKey.match(/.{1,64}/g)?.join('\n')}\n-----END PUBLIC KEY-----`;
    }


    static sha256(data: string): string {
        return createHash('sha256').update(data).digest('hex');
    }

    static verifySignature(public_key: string, nonce: string, signature: string) {
        const pubKey = this.uncompactPublicKey(public_key);
        const verifier = crypto.createVerify('SHA256');
        verifier.update(nonce);
        verifier.end();
        return verifier.verify(pubKey, signature, 'base64');
    }

    static decryptWithPrivateKey(raw: string, privateKey: forge.pki.rsa.PrivateKey) {
        var decoded = Buffer.from(raw, 'base64').toString('binary');
        return privateKey.decrypt(decoded, 'RSA-OAEP', {
            md: forge.md.sha256.create(),
            mgf1: { md: forge.md.sha1.create() }
        });
    }
}
