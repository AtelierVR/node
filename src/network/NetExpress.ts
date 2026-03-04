import Reileta from "../Main";
import Express from "express";
import Multer from 'multer';
import NetHTTP from "./NetHTTP";
import NetData from "./NetData";
import { ParsedQs } from "qs";
import multer from "multer";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import Ajv, { JSONSchemaType, Schema } from "ajv";
import { ErrorMessage } from "../utils/Utils";
import { ErrorCodes } from "../utils/Constants";
import Schemas from "../utils/Schemas";
import Debug from "../utils/Debug";
import Env from "../utils/Environment";


interface ValidateResponseSuccess<T> {
    valid: true;
    data: T;
}

interface ValidateResponseFailure {
    valid: false;
    errors: any[];
}

type ValidateResponseResult<T> = ValidateResponseSuccess<T> | ValidateResponseFailure;



export default class NetExpress {
    server: Express.Application;
    upload: Multer.Multer;
    constructor(public readonly app: Reileta, private readonly http: NetHTTP) {
        this.server = Express();
        const storage = multer.diskStorage({
            destination: (req, file, cb) => cb(null, tmpdir()),
            filename: (req: Request, file, cb) => {
                var user = req.data.authToken;
                if (!user) return cb(null, `${Date.now()}-${req.data.authType}-${req.data.ip.replace(/[^0-9a-z]/gi, '_')}`);
                const hash = createHash('md5').update(user.toString()).digest('hex');
                cb(null, `${Date.now()}-${req.data.authType}-${hash}`);
            },
        });
        this.upload = multer({
            storage: storage,
            limits: {
                fileSize: Env.getMaxFileSize(),
                fieldSize: Env.getMaxFieldSize(),
                files: Env.getMaxFiles(),
            }
        });
    }

    static handleMulterError() {
        return async (err: any, req: any, res: any, next: any) => {
            if (err instanceof multer.MulterError) {
                Debug.error(`Multer error: ${err.code} - ${err.message}`);
                switch (err.code) {
                    case 'LIMIT_FILE_SIZE':
                        return res.send(new ErrorMessage(ErrorCodes.InvalidField, 'file', `File too large. Maximum size is ${Env.getMaxFileSize()} bytes`));
                    case 'LIMIT_FILE_COUNT':
                        return res.send(new ErrorMessage(ErrorCodes.InvalidField, 'files', `Too many files. Maximum is ${Env.getMaxFiles()}`));
                    case 'LIMIT_FIELD_VALUE':
                        return res.send(new ErrorMessage(ErrorCodes.InvalidField, 'field', `Field value too large. Maximum size is ${Env.getMaxFieldSize()} bytes`));
                    case 'LIMIT_UNEXPECTED_FILE':
                        return res.send(new ErrorMessage(ErrorCodes.InvalidField, 'file', 'Unexpected file field'));
                    default:
                        return res.send(new ErrorMessage(ErrorCodes.InvalidField, 'file', err.message));
                }
            }
            next(err);
        }
    }

    static uploadTimeout() {
        return async (req: any, res: any, next: any) => {
            const timeout = Env.getUploadTimeout();
            const timer = setTimeout(() => {
                if (!res.headersSent) {
                    Debug.error(`Upload timeout after ${timeout}ms for ${req.url}`);
                    res.send(new ErrorMessage(ErrorCodes.InternalError, 'Upload timeout'));
                }
            }, timeout);

            res.on('finish', () => clearTimeout(timer));
            res.on('close', () => clearTimeout(timer));
            req.on('close', () => clearTimeout(timer));

            next();
        }
    }

    static log() {
        return async (req: any, res: any, next: any) => {
            try { Debug.dir(req.body, { depth: null, colors: true }); }
            catch { Debug.log(req.body); }
            next();
        }
    }

    static validate<T>(schema: Schema | JSONSchemaType<T> | string) {
        return async (req: any, res: any, next: any) => {
            if (typeof schema === 'string') {
                let sch = await Schemas.load(schema);
                if (!sch) {
                    Debug.error(`Schema ${schema} not found`);
                    return res.send(new ErrorMessage(ErrorCodes.InternalError));
                }
                schema = sch;
            }

            const ajv = new Ajv({ allErrors: true, strict: false });
            const validate = ajv.compile<T>(schema);
            const valid = validate(req.body);

            if (!valid) {
                let errors = validate.errors || [];
                Debug.dir(req.body, { depth: null, colors: true });
                Debug.error(errors);
                return res.send(
                    new ErrorMessage(ErrorCodes.InvalidField, errors[0].instancePath.slice(1), errors[0].message)
                        .addOther('validation', errors)
                );
            } else return next();
        }
    }


    /**
     * Valide une réponse JSON contre un schéma
     */
    static async validateResponse<T>(data: any, schema: Schema | JSONSchemaType<T> | string): Promise<ValidateResponseResult<T>> {
        try {
            if (typeof schema === 'string') {
                let sch = await Schemas.load(schema);
                if (!sch) {
                    Debug.error(`Schema ${schema} not found`);
                    return { valid: false, errors: [{ message: "Schema not found" }] };
                }
                schema = sch;
            }

            const ajv = new Ajv({ allErrors: true, strict: false });
            const validate = ajv.compile<T>(schema);
            const valid = validate(data);

            if (!valid) {
                Debug.error(`Response validation`, validate.errors);
                return { valid: false, errors: validate.errors || [] };
            }

            return { valid: true, data: data as T };
        } catch (error) {
            Debug.error(`Error validating response:`, error);
            return { valid: false, errors: [{ message: "Validation error" }] };
        }
    }
}

export interface Request<T = {}, B = any> extends Express.Request<T, any, B, ParsedQs, Record<string, any>> {
    data: NetData;
}

export interface Response extends Express.Response<any, Record<string, any>> {
    oldsend: (body: any) => this;
    send<T>(body: T): this
}

export interface Next extends Express.NextFunction { }