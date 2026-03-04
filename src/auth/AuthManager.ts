import { createHash } from "node:crypto";
import Reileta from "../Main";
import User from "../users/User";
import { ErrorCodes } from "../utils/Constants";
import { getSessionExpiration } from "../utils/Environment";
import { ErrorMessage, sha256, verify } from "../utils/Utils";
import AuthAPIWeb from "./AuthAPIWeb";
import Session from "./sessions/Session";
import SessionManager from "./sessions/SessionManager";
import VerificationFactorManager from "./VerificationFactorManager";
import { Security } from "../utils/Security";

/**
 * Authentication manager class responsible for user registration, login, and session management
 * Handles both standard authentication and multi-factor authentication workflows
 * Integrates with the web API layer and verification factor manager
 */
export default class AuthManager {
    /** Web API handler for authentication endpoints */
    api_web: AuthAPIWeb;
    /** Manager for multi-factor authentication and verification codes */
    verification: VerificationFactorManager;

    /**
     * Constructor for AuthManager
     * Initializes the web API handler and verification manager
     * @param app - Main application instance providing access to all services
     */
    constructor(private readonly app: Reileta) {
        this.api_web = new AuthAPIWeb(app, this);
        this.verification = new VerificationFactorManager(app);
    }

    /**
     * Register a new user account
     * Validates that the user ID, username, and email are not already in use,
     * creates the user account, and automatically logs them in
     * @param input - Registration data including username, password, email, and optional fields
     * @returns AuthOutput with session and user data, or ErrorMessage if registration fails
     */
    async register(input: InputRegister): Promise<AuthOutput | ErrorMessage> {
        if (input.id && await this.app.users.findUserById(input.id))
            return new ErrorMessage(ErrorCodes.InvalidField, "email", "already exists");

        if (await this.app.users.findUserByUsername(input.username))
            return new ErrorMessage(ErrorCodes.InvalidField, "username", "already exists");

        if (input.email && await this.app.users.findUserByEmail(input.email))
            return new ErrorMessage(ErrorCodes.InvalidField, "email", "already exists");

        if (input.public_key && !Security.isPem(input.public_key))
            return new ErrorMessage(ErrorCodes.InvalidField, "public_key", "invalid format");

        let user = await this.app.users.createUser({
            id: input.id,
            username: input.username,
            display: input.display,
            password: input.password,
            email: input.email,
            thumbnail: input.thumbnail,
            banner: input.banner
        });

        if (!user)
            return new ErrorMessage(ErrorCodes.InternalError, "Failed to create user");

        return await this.createSuccessfulLogin(user);
    }

    async checkPublicKey(public_key: string, challenge: string): Promise<boolean | ErrorMessage> {
        let parts = challenge.split(".");
        if (parts.length !== 2) return new ErrorMessage(ErrorCodes.InvalidField, "challenge", "invalid format");
        let [nonce, time, signature] = parts;
        var date = new Date(Number(time));
        if (isNaN(date.getTime()) || (Date.now() - date.getTime()) > 5 * 60 * 1000)
            return new ErrorMessage(ErrorCodes.InvalidField, "challenge", "expired");
        let group = [nonce, time].join(".");
        if (!Security.verifySignature(public_key, group, signature))
            return new ErrorMessage(ErrorCodes.InvalidField, "challenge", "invalid signature");
        return true;
    }

    /**
     * Authenticate a user login attempt
     * Validates credentials and handles multi-factor authentication if required
     * Supports both username and user ID as identifiers
     * @param input - Login credentials including identifier, password, and optional verification code
     * @returns AuthOutput for successful login, VerificationRequiredOutput if MFA needed, or ErrorMessage for failures
     */
    async login(input: InputLogin): Promise<AuthOutput | VerificationRequiredOutput | ErrorMessage> {
        let user = typeof input.identifier === "string"
            ? await this.app.users.findUserByUsername(input.identifier)
            : await this.app.users.findUserById(input.identifier);

        if (input.public_key && !Security.isPem(input.public_key))
            return new ErrorMessage(ErrorCodes.InvalidField, "public_key", "invalid format");

        if (!user) return new ErrorMessage(ErrorCodes.UserNotFound);
        
        // Vérifier d'abord le mot de passe avant toute chose
        if (!user.password || !verify(input.password, user.password))
            return new ErrorMessage(ErrorCodes.InvalidField, "password", "string");

        // Si la vérification est requise, le factor_code DOIT être fourni et valide
        if (this.verification.isVerificationRequired(user)) {
            if (!input.factor_code) {
                return {
                    verification_required: true,
                    methods: this.verification.getAvailableVerificationMethods(user),
                    message: "Please verify your identity using one of the available methods."
                };
            }
            
            const verifyResult = await this.verification.verifyFactorCode(user, input.factor_code);
            if (!verifyResult.success) {
                return new ErrorMessage(ErrorCodes.InvalidField, "factor_code", verifyResult.message);
            }
        }

        return await this.createSuccessfulLogin(user, input.public_key);
    }

    /**
     * Create a successful login response with session and user data
     * Generates a new session token with appropriate expiration time
     * This is used for both registration and login success flows
     * @param user - The authenticated user for whom to create a session
     * @returns AuthOutput containing the new session and user information
     */
    private async createSuccessfulLogin(user: User, public_key?: string): Promise<AuthOutput> {
        let session = await this.app.sessions.createTokenSession({
            user_id: user.id,
            token: SessionManager.generateToken(),
            expires: getSessionExpiration(),
            created_at: new Date(),
            updated_at: new Date(),
            public_key: public_key
        });

        return { session, user };
    }

}

/**
 * Input data structure for user registration
 * Contains all the information needed to create a new user account
 */
export interface InputRegister {
    /** Optional user ID (auto-generated if not provided) */
    id?: number;
    /** Unique username for the account */
    username: string;
    /** Optional display name (defaults to username if not provided) */
    display?: string;
    /** Optional email address for the account */
    email?: string;
    /** Password for the account (will be hashed before storage) */
    password: string;
    /** Optional URL or path to user's profile thumbnail image */
    thumbnail?: string;
    /** Optional URL or path to user's profile banner image */
    banner?: string;
    /** Optional public key for session binding (if applicable) in base64 format */
    public_key?: string;
}

/**
 * Input data structure for user login
 * Contains credentials and optional multi-factor authentication code
 */
export interface InputLogin {
    /** Username or user ID for authentication */
    identifier: string | number;
    /** User's password (should be hashed on client side) */
    password: string;
    /** Optional verification code for multi-factor authentication */
    factor_code?: string;
    /** Optional public key for session binding (if applicable) in base64 format */
    public_key?: string;
}

/**
 * Output data structure for successful authentication
 * Contains the created session and authenticated user information
 */
export interface AuthOutput {
    /** The newly created session for the authenticated user */
    session: Session;
    /** The authenticated user object with all profile information */
    user: User;
}

/**
 * Output data structure when multi-factor authentication is required
 * Returned when a user's login requires additional verification steps
 */
export interface VerificationRequiredOutput {
    /** Always true to indicate verification is required */
    verification_required: true;
    /** Array of available verification methods for the user */
    methods: Array<{
        /** Type of verification method (e.g., 'email', 'totp') */
        type: string;
        /** Human-readable name of the verification method */
        name: string;
        /** Whether this method is currently enabled for the user */
        enabled: boolean;
    }>;
    /** Message to display to the user explaining the verification requirement */
    message: string;
}