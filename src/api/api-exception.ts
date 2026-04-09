import { HttpException } from "@nestjs/common";
import { ApiErrorCode, ApiErrorFactory } from "./api-error.factory";

export class ApiException extends HttpException {
    public readonly code: ApiErrorCode;
    public readonly data: unknown;
    public readonly args: string[];

    constructor(code: ApiErrorCode, data: unknown = null, ...args: string[]) {
        super(ApiErrorFactory.formatMessage(code, ...args), ApiErrorFactory.getStatus(code));
        this.code = code;
        this.data = data;
        this.args = args;
    }
}
