import crypto, { pbkdf2Sync, randomBytes, scryptSync } from "crypto";
import { ErrorCode, LocalAddressRegex } from "./Constants";
import child_process from "child_process";
import { VerificationRequiredOutput } from "../auth/AuthManager";
import Debug from "./Debug";

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export const isLocalAddress = (address: string) => LocalAddressRegex.some(regex => regex.test(address));
export const isValidURL = (url: string) => {
    try {
        let uri = new URL(url);
        return uri.protocol === 'http:' || uri.protocol === 'https:';
    } catch {
        return false;
    }
}

export const isValidWSURL = (url: string) => {
    try {
        let uri = new URL(url);
        return uri.protocol === 'ws:' || uri.protocol === 'wss:';
    } catch {
        return false;
    }
}

export function verify(password: string, hashed: string) {
    const [salt] = hashed.split(":");
    return hashed === hash(password, salt);
}

function generateSalt() {
    return randomBytes(16).toString('base64');
}

export function sha256(data: crypto.BinaryLike) {
    return crypto.createHash('sha256').update(data).digest('hex');
}

export function hash(password: string, salt: string = generateSalt()) {
    return salt + ":" + pbkdf2Sync(password, Buffer.from(salt, 'base64'), 10000, 64, 'sha256').toString('base64');
}

export function hasTag(tags: string[], tag: string) {
    return tags.some(t => t === tag || t.split(':')[1] === tag.split(':')[1]);
}

export function isValidInt(value: number | bigint, min: number | bigint, max: number | bigint) {
    return value >= min && value < max;
}

export function stringify<T>(obj: T): string {
    return JSON.stringify(obj);
}

export const PaternAssetFiles = [
    {
        engine: 'unity',
        type: null,
        platform: null,
        command: ["python3", "tools/assetbundle.py", '{path}']
    },
    {
        engine: null,
        type: null,
        platform: null,
        command: null
    }
]

interface ValidationAssetFile {
    sucess: boolean,
    data: string | AnalyzedAssetBundle | null
}

export interface AnalyzedAssetBundle {
    name: string,
    engine: string,
    version: string,
    platform: number,
    data: any
}

export async function checkValidAssetFile(path: string, engine: string, platform: string, type: string): Promise<ValidationAssetFile> {
    const patern = PaternAssetFiles.sort(p => {
        var fengine = !p.engine ? 0 : (p.engine === engine ? 1 : -1);
        var ftype = !p.type ? 0 : (p.type === type ? 1 : -1);
        var fplatform = !p.platform ? 0 : (p.platform === platform ? 1 : -1);
        return fengine + ftype + fplatform;
    })[0];
    if (!patern || !patern.command) {
        Debug.error('No command found for this file');
        return { sucess: false, data: null };
    }
    const command = patern.command.map(c => c
        .replace('{type}', type)
        .replace('{platform}', platform)
        .replace('{path}', path)
        .replace('{engine}', engine)
    );
    Debug.log('Command to execute :', command.join(' '));
    let ls = child_process.spawn(command[0], command.slice(1));
    return new Promise<ValidationAssetFile>(resolve => {
        let data = '';
        ls.stdout.on('data', d => data += d.toString());
        ls.stderr.on('data', d => data += d.toString());
        ls.on('close', code => {
            try {
                resolve({
                    sucess: code === 0,
                    data: code === 0 ? JSON.parse(data) : data
                });
            } catch (e) {
                resolve({
                    sucess: false,
                    data: data
                });
            }
        });
    });
}

export class ErrorMessage {
    constructor(public error: ErrorCode, ...args: any[]) {
        this.error.message = this.error.message.replace(/{(\d+)}/g, (match, number) => {
            return typeof args[number] != 'undefined' ? args[number] : match;
        });
    }

    get code() {
        return this.error.code;
    }

    get message() {
        return this.error.message;
    }

    get status() {
        return this.error.status;
    }

    public data: any | null = null;

    public others: { [key: string]: any } = {};

    public addOther(key: string, value: any) {
        this.others[key] = value;
        return this;
    }

    toJSON() {
        return {
            code: this.error.code,
            message: this.error.message,
            status: this.error.status,
            ...this.others
        };
    }
}

// createdAt: created_at, UserID: user_id
export function normalizeText(text: string): string {
    // if the first letter is a capital letter, we put it in lowercase
    // if the previous character of a capital letter is a lowercase letter, we put a uderscore before the capital letter and we put it in lowercase
    let result = text[0].toLowerCase();
    for (let i = 1; i < text.length; i++)
        if (text[i] === text[i].toUpperCase() && text[i - 1] !== text[i - 1].toUpperCase()) {
            result += '_' + text[i].toLowerCase();
        } else result += text[i].toLowerCase();
    return result
        .replace(/ /g, '_')
        .replace(/-/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_/g, '')
        .replace(/_$/g, '');
}