import Reileta from "../Main";
import NetExpress, { Request, Response } from "../network/NetExpress";
import User from "../users/User";
import { ErrorCodes } from "../utils/Constants";
import { ErrorMessage } from "../utils/Utils";
import Express from "express";

/**
 * Web API handler for Two-Factor Authentication (TOTP) endpoints
 * Manages HTTP routes for 2FA setup, enable, disable, and verification operations
 * Provides secure management of TOTP-based authentication for user accounts
 */
export default class TwoFactorAPIWeb {
    /**
     * Constructor for TwoFactorAPIWeb
     * Sets up all TOTP-related HTTP routes and their handlers
     * @param app - Main application instance providing access to services
     */
    constructor(private readonly app: Reileta) {
        this.app.http.express.server.post('/api/auth/totp/setup', Express.json(), (req, res) => this.handleSetup(req as Request, res as Response));
        this.app.http.express.server.post('/api/auth/totp/enable', Express.json(), NetExpress.validate('auth/totp/enable'), (req, res) => this.handleEnable(req as Request, res as Response));
        this.app.http.express.server.post('/api/auth/totp/disable', Express.json(), NetExpress.validate('auth/totp/disable'), (req, res) => this.handleDisable(req as Request, res as Response));
        this.app.http.express.server.post('/api/auth/totp/verify', Express.json(), NetExpress.validate('auth/totp/verify'), (req, res) => this.handleVerify(req as Request, res as Response));
    }

    /**
     * Handle 2FA setup requests
     * Generates a new TOTP secret and QR code for the user
     * Requires user authentication but does not enable 2FA until verification
     * @param request - HTTP request from authenticated user
     * @param response - HTTP response containing setup data (secret, QR code, backup codes)
     */
    async handleSetup(request: Request, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));

        const user = await request.data.getData() as User | null;
        if (!user) return response.send(new ErrorMessage(ErrorCodes.UserNotFound));

        const setup = await this.app.totp.setupTwoFactor(user);
        if (setup instanceof ErrorMessage)
            return response.send(setup);

        return response.send<IRTwoFactorSetup>({
            secret: setup.secret,
            qrCodeUrl: setup.qrCodeUrl,
            backupCodes: setup.backupCodes || []
        });
    }

    /**
     * Handle 2FA enable requests
     * Validates the TOTP token against the provided secret and enables 2FA for the user
     * Updates the user's 2FA status in the database upon successful verification
     * @param request - HTTP request containing secret and verification token
     * @param response - HTTP response indicating success or failure of 2FA enablement
     */
    async handleEnable(request: Request, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));

        const user = await request.data.getData() as User | null;
        if (!user) return response.send(new ErrorMessage(ErrorCodes.UserNotFound));

        const { secret, token } = request.body as { secret: string; token: string };

        if (!secret || !token) {
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'secret or token', 'string'));
        }

        const result = await this.app.totp.enableTwoFactor(user, secret, token);
        if (result instanceof ErrorMessage)
            return response.send(result);

        // Update user in database
        user.twofa_enabled = true;
        user.twofa_secret = secret;
        const updatedUser = await this.app.users.updateUser(user);

        if (!updatedUser) {
            return response.send(new ErrorMessage(ErrorCodes.InternalError, 'update user'));
        }

        return response.send<IRTwoFactorEnable>({
            enabled: true,
            message: '2FA has been enabled successfully'
        });
    }

    /**
     * Handle 2FA disable requests
     * Disables two-factor authentication for a user account
     * Requires additional verification if the user has other verification methods enabled
     * @param request - HTTP request containing optional verification code
     * @param response - HTTP response indicating success or failure of 2FA disabling
     */
    async handleDisable(request: Request, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));

        const user = await request.data.getData() as User | null;
        if (!user) return response.send(new ErrorMessage(ErrorCodes.UserNotFound));

        const { factor_code } = request.body as { factor_code?: string };

        // First check if 2FA is actually enabled
        if (!user.twofa_enabled) {
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, '2FA', 'Not enabled'));
        }

        // Check if verification is required for sensitive operations
        if (this.app.auth.verification.isVerificationRequired(user)) {
            if (factor_code) {
                const verifyResult = await this.app.auth.verification.verifyFactorCode(user, factor_code);
                if (!verifyResult.success)
                    return response.send(new ErrorMessage(ErrorCodes.InvalidField, "factor_code", verifyResult.message));
                // Verification successful, proceed with disabling 2FA
            } else {
                // No factor code provided, return verification required
                let err = new ErrorMessage(ErrorCodes.VerificationRequired, "Verification required");
                err.data = { methods: this.app.auth.verification.getAvailableVerificationMethods(user) };
                return response.send(err);
            }
        }

        const result = await this.app.totp.disableTwoFactor(user);
        if (result instanceof ErrorMessage)
            return response.send(result);

        // Update user in database
        user.twofa_enabled = false;
        user.twofa_secret = null;
        const updatedUser = await this.app.users.updateUser(user);

        if (!updatedUser) {
            return response.send(new ErrorMessage(ErrorCodes.InternalError, 'update user'));
        }

        return response.send<IRTwoFactorDisable>({
            disabled: true,
            message: '2FA has been disabled successfully'
        });
    }

    /**
     * Handle TOTP token verification requests
     * Verifies a TOTP token for an authenticated user
     * Used for testing 2FA setup or general token validation
     * @param request - HTTP request containing the TOTP token to verify
     * @param response - HTTP response indicating whether the token is valid
     */
    async handleVerify(request: Request, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));

        const user = await request.data.getData() as User | null;
        if (!user) return response.send(new ErrorMessage(ErrorCodes.UserNotFound));

        const { token } = request.body as { token: string };

        if (!token) {
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'token', 'string'));
        } const verified = this.app.totp.verifyLoginToken(user, token);

        return response.send<IRTwoFactorVerify>({
            verified,
            message: verified ? 'Token verified successfully' : 'Invalid token'
        });
    }
}

/**
 * Response interface for 2FA setup operations
 * Contains all necessary information for setting up TOTP authentication
 */
export interface IRTwoFactorSetup {
    /** Base32-encoded secret key for TOTP generation */
    secret: string;
    /** QR code URL that can be scanned by authenticator apps */
    qrCodeUrl: string;
    /** Array of backup codes for account recovery */
    backupCodes: string[];
}

/**
 * Response interface for 2FA enable operations
 * Indicates the result of enabling two-factor authentication
 */
export interface IRTwoFactorEnable {
    /** Whether 2FA was successfully enabled */
    enabled: boolean;
    /** Descriptive message about the enable operation */
    message: string;
}

/**
 * Response interface for 2FA disable operations
 * Indicates the result of disabling two-factor authentication
 */
export interface IRTwoFactorDisable {
    /** Whether 2FA was successfully disabled */
    disabled: boolean;
    /** Descriptive message about the disable operation */
    message: string;
}

/**
 * Response interface for TOTP token verification operations
 * Indicates whether a provided TOTP token is valid
 */
export interface IRTwoFactorVerify {
    /** Whether the provided token was valid */
    verified: boolean;
    /** Descriptive message about the verification result */
    message: string;
}
