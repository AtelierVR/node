import { createSign, createVerify, generateKeyPair, publicEncrypt, privateDecrypt, constants } from "node:crypto";
import { promisify } from "node:util";

export interface KeyPair {
    public: string;
    private: string;
}

export async function make(): Promise<KeyPair> {
    const { publicKey, privateKey } = await promisify(generateKeyPair)('rsa', {
        modulusLength: 4096,
        publicKeyEncoding: {
            type: 'spki',
            format: 'pem',
        },
        privateKeyEncoding: {
            type: 'pkcs8',
            format: 'pem',
        },
    });
    return { public: publicKey, private: privateKey };
}

export async function sign(data: Buffer, privKey: string): Promise<Buffer> {
    const sign = createSign('SHA256');
    sign.update(data);
    sign.end();
    return sign.sign(privKey);
}

export async function verify(data: Buffer, signature: Buffer, pubKey: string): Promise<boolean> {
    const verify = createVerify('SHA256');
    verify.update(data);
    verify.end();
    return verify.verify(pubKey, signature);
}

/** RSA-OAEP encrypt — chiffre avec la clé publique du destinataire. */
export function encrypt(plaintext: Buffer, pubKeyPem: string): Buffer {
    return publicEncrypt(
        { key: pubKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING },
        plaintext,
    );
}

/** RSA-OAEP decrypt — déchiffre avec sa propre clé privée. */
export function decrypt(ciphertext: Buffer, privKeyPem: string): Buffer {
    return privateDecrypt(
        { key: privKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING },
        ciphertext,
    );
}

// ── PEM compression helpers ─────────────────────────────────────────────────

/** Strip PEM header/footer and newlines from a public key. */
export function compressPublicKey(pem: string): string {
    return pem
        .replace(/-----BEGIN PUBLIC KEY-----\r?\n?/, '')
        .replace(/\r?\n?-----END PUBLIC KEY-----\r?\n?/, '')
        .replace(/\r?\n/g, '');
}

/** Restore a full PEM public key from a compressed (header-less) string. */
export function decompressPublicKey(compact: string): string {
    return `-----BEGIN PUBLIC KEY-----\n${compact}\n-----END PUBLIC KEY-----\n`;
}

/** Strip PEM header/footer and newlines from a private key. */
export function compressPrivateKey(pem: string): string {
    return pem
        .replace(/-----BEGIN PRIVATE KEY-----\r?\n?/, '')
        .replace(/\r?\n?-----END PRIVATE KEY-----\r?\n?/, '')
        .replace(/\r?\n/g, '');
}

/** Restore a full PEM private key from a compressed (header-less) string. */
export function decompressPrivateKey(compact: string): string {
    return `-----BEGIN PRIVATE KEY-----\n${compact}\n-----END PRIVATE KEY-----\n`;
}