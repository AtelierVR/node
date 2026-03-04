import * as speakeasy from 'speakeasy';
import * as QRCode from 'qrcode';
import User from '../users/User';
import { ErrorCodes } from '../utils/Constants';
import { ErrorMessage } from '../utils/Utils';
import { VerificationFactorResult } from '../auth/VerificationFactorManager';
import Main from '../Main';
import TwoFactorAPIWeb from './TwoFactorAPIWeb';
import Debug from '../utils/Debug';

/**
 * Result interface for two-factor authentication setup
 * Contains all necessary data for configuring TOTP authentication
 */
export interface TwoFactorSetupResult {
    /** Base32-encoded secret key for TOTP generation */
    secret: string;
    /** QR code data URL for easy setup with authenticator apps */
    qrCodeUrl: string;
    /** Optional backup codes for account recovery */
    backupCodes?: string[];
}

/**
 * Result interface for two-factor authentication verification
 * Contains verification status and optional token information
 */
export interface TwoFactorVerificationResult {
    /** Whether the verification was successful */
    verified: boolean;
    /** Optional token or additional verification data */
    token?: string;
}

/**
 * Manager class for Two-Factor Authentication using TOTP (Time-based One-Time Password)
 * Handles secret generation, QR code creation, token verification, and 2FA lifecycle management
 * Integrates with speakeasy library for TOTP operations and provides secure 2FA functionality
 */
export default class TwoFactorManager {
    /** Service name displayed in authenticator apps */
    private readonly SERVICE_NAME = 'Nox';
    /** Time window tolerance for TOTP verification (allows for clock skew) */
    private readonly WINDOW = 2; // Allow 2 time windows for clock skew
    /** Web API handler for TOTP HTTP endpoints */
    api_web: TwoFactorAPIWeb;

    /**
     * Constructor for TwoFactorManager
     * Initializes the web API handler for TOTP endpoints
     * @param app - Main application instance providing access to services
     */
    constructor(private readonly app: Main) {
        this.api_web = new TwoFactorAPIWeb(app);
    }

    /**
     * Generate a new 2FA secret for a user
     * Creates a cryptographically secure secret that can be used for TOTP generation
     * @param user - The user for whom to generate the 2FA secret
     * @returns Generated secret object containing the base32 secret and metadata
     */
    generateSecret(user: User): speakeasy.GeneratedSecret {
        return speakeasy.generateSecret({
            name: `${user.username} (${user.display})`,
            issuer: this.SERVICE_NAME,
            length: 32
        });
    }

    /**
     * Generate QR code URL for 2FA setup
     * Creates a QR code data URL that can be scanned by authenticator apps
     * @param secret - The base32-encoded TOTP secret
     * @param user - The user for whom to generate the QR code
     * @returns Promise resolving to QR code data URL
     */
    async generateQRCode(secret: string, user: User): Promise<string> {
        const otpAuthUrl = speakeasy.otpauthURL({
            secret: secret,
            label: `${user.username} (${user.display})`,
            issuer: this.SERVICE_NAME,
            encoding: 'base32'
        });

        return await QRCode.toDataURL(otpAuthUrl);
    }

    /**
     * Set up 2FA for a user (returns secret and QR code)
     * Generates a new TOTP secret and QR code for initial 2FA setup
     * Does not enable 2FA until verification is completed
     * @param user - The user for whom to set up 2FA
     * @returns Setup result with secret and QR code, or error if 2FA already enabled
     */
    async setupTwoFactor(user: User): Promise<TwoFactorSetupResult | ErrorMessage> {
        if (user.twofa_enabled) {
            return new ErrorMessage(ErrorCodes.InvalidField, '2FA', 'Already enabled');
        }

        const secret = this.generateSecret(user);
        const qrCodeUrl = await this.generateQRCode(secret.base32!, user);

        return {
            secret: secret.base32!,
            qrCodeUrl,
            backupCodes: [] // TODO: Implement backup codes if needed
        };
    }    
    
    /**
     * Verify a TOTP token against a secret
     * Validates a 6-digit TOTP code with time window tolerance for clock skew
     * @param secret - The base32-encoded TOTP secret
     * @param token - The 6-digit TOTP token to verify
     * @returns true if the token is valid, false otherwise
     */
    verifyToken(secret: string, token: string): boolean {
        Debug.log(`2FA Debug - Verifying token: ${token} with secret: ${secret ? '[HIDDEN]' : 'NULL'}`);
        Debug.log(`2FA Debug - Token length: ${token?.length}, Window: ${this.WINDOW}`);

        const verified = speakeasy.totp.verify({
            secret: secret,
            encoding: 'base32',
            token: token,
            window: this.WINDOW
        });

        Debug.log(`2FA Debug - Verification result: ${verified}`);

        if (!verified) {
            // Generate current token for comparison
            const currentToken = speakeasy.totp({
                secret: secret,
                encoding: 'base32'
            });
            Debug.log(`2FA Debug - Current expected token: ${currentToken}`);

            // Try a few time windows for debugging
            for (let i = -3; i <= 3; i++) {
                const testToken = speakeasy.totp({
                    secret: secret,
                    encoding: 'base32',
                    time: Date.now() + (i * 30 * 1000) // 30 second intervals
                });
                Debug.log(`2FA Debug - Token at window ${i}: ${testToken}`);
            }
        }

        return verified;
    }

    /**
     * Enable 2FA for a user after verifying the setup token
     * Validates the provided token against the secret before enabling 2FA
     * @param user - The user for whom to enable 2FA
     * @param secret - The TOTP secret to associate with the user
     * @param token - The verification token to validate the setup
     * @returns true if 2FA was enabled successfully, or ErrorMessage if failed
     */
    async enableTwoFactor(user: User, secret: string, token: string): Promise<boolean | ErrorMessage> {
        if (user.twofa_enabled) {
            return new ErrorMessage(ErrorCodes.InvalidField, '2FA', 'Already enabled');
        }

        if (!this.verifyToken(secret, token)) {
            return new ErrorMessage(ErrorCodes.InvalidField, 'token', 'Invalid 2FA token');
        }

        return true;
    }    
    
    /**
     * Disable 2FA for a user
     * Removes two-factor authentication from a user account
     * @param user - The user for whom to disable 2FA
     * @returns true if 2FA was disabled successfully, or ErrorMessage if not enabled
     */
    async disableTwoFactor(user: User): Promise<boolean | ErrorMessage> {
        if (!user.twofa_enabled) {
            return new ErrorMessage(ErrorCodes.InvalidField, '2FA', 'Not enabled');
        }

        return true;
    }

    /**
     * Verify a TOTP code for factor verification purposes
     * Used as part of the multi-factor authentication verification flow
     * @param user - The user attempting verification
     * @param code - The TOTP code to verify
     * @returns VerificationFactorResult with success status and message
     */
    async verifyFactorTOTPCode(user: User, code: string): Promise<VerificationFactorResult> {
        const method = 'totp';

        if (!user.twofa_enabled || !user.twofa_secret)
            return {
                success: false,
                message: '2FA is not enabled for this user',
                verified_method: method
            };

        const verified = this.verifyToken(user.twofa_secret, code);
        return {
            success: verified,
            message: verified ? '2FA token verified' : 'Invalid 2FA token',
            verified_method: method
        };
    }

    /**
     * Verify 2FA during login
     * Validates a TOTP token for login authentication purposes
     * Includes detailed logging for debugging authentication issues
     * @param user - The user attempting to log in
     * @param token - The TOTP token provided by the user
     * @returns true if the token is valid and login should proceed, false otherwise
     */
    verifyLoginToken(user: User, token: string): boolean {
        Debug.log(`2FA Login Debug - User: ${user.username}, 2FA enabled: ${user.twofa_enabled}, Has secret: ${!!user.twofa_secret}`);
        Debug.log(`2FA Login Debug - Provided token: ${token}`);

        if (!user.twofa_enabled || !user.twofa_secret) {
            Debug.log('2FA Login Debug - 2FA not enabled, allowing login');
            return true; // 2FA not enabled, so verification passes
        }

        const result = this.verifyToken(user.twofa_secret, token);
        Debug.log(`2FA Login Debug - Final verification result: ${result}`);
        return result;
    }
}
