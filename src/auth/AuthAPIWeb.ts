import Reileta from "../Main";
import NetExpress, { Request, Response } from "../network/NetExpress";
import User from "../users/User";
import { IRUserMe } from "../users/UserAPIWeb";
import { ErrorCodes } from "../utils/Constants";
import Env from "../utils/Environment";
import { presenceToApi } from "../utils/Presence";
import { Security } from "../utils/Security";
import { ErrorMessage } from "../utils/Utils";
import AuthManager, { InputLogin, InputRegister, VerificationRequiredSendData } from "./AuthManager";
import Session from "./sessions/Session";
import Express from "express";

/**
 * Web API handler for authentication endpoints
 * Manages HTTP routes for login, registration, logout, and verification code sending
 * Integrates with AuthManager for business logic and handles HTTP-specific concerns
 */
export default class AuthAPIWeb {
    /**
     * Constructor for AuthAPIWeb
     * Sets up all authentication-related HTTP routes and their handlers
     * @param app - Main application instance providing access to services
     * @param manager - AuthManager instance for handling authentication logic
     */
    constructor(private readonly app: Reileta, private readonly manager: AuthManager) {
        this.app.http.express.server.post('/api/auth/login', Express.json(), NetExpress.validate<InputLogin>('auth/login'), (req, res) => this.handleLogin(req as Request, res as Response));
        this.app.http.express.server.post('/api/auth/register', Express.json(), NetExpress.validate<InputRegister>('auth/register'), (req, res) => this.handleRegister(req as Request, res as Response));
        this.app.http.express.server.get('/api/auth/logout', (req, res) => this.handleLogout(req as Request, res as Response));
        this.app.http.express.server.post('/api/auth/:type/send', Express.json(), NetExpress.validate<VerificationRequiredSendData>('auth/send'), (req, res) => this.handleSendCode(req as Request<{ type: string }, VerificationRequiredSendData>, res as Response));
    }

    /**
     * Handle verification code sending requests
     * Sends verification codes via the specified method (email, etc.)
     * Requires user to be authenticated with a valid bearer token
     * @param request - HTTP request containing the verification method type in params
     * @param response - HTTP response object for sending the result
     */
    async handleSendCode(request: Request<{ type: string }, VerificationRequiredSendData>, response: Response) {
        let user = await this.app.users.findUserById(request.body.target);
        if (!user) return response.send(new ErrorMessage(ErrorCodes.UserNotFound));

        const success = await this.app.auth.verification.sendVerificationCode(user, request.params.type);
        if (!success) return response.send(new ErrorMessage(ErrorCodes.InternalError, 'failed to send verification code'));

        return response.send({
            success: true,
            message: 'Verification code sent',
        });
    }

    /**
     * Handle user registration requests
     * Creates a new user account and automatically logs them in
     * Checks if registration is enabled before processing
     * @param request - HTTP request containing registration data in body
     * @param response - HTTP response object for sending the authentication result
     */
    async handleRegister(request: Request, response: Response) {
        if (Env.sync('CAN_REGISTER') === false)
            return response.send(new ErrorMessage(ErrorCodes.ServiceDisabled));
        const register = await this.manager.register(request.body);
        if (register instanceof ErrorMessage)
            return response.send(register);
        const { session, user } = register;
        await session.register(request.data.ip, request.data.userAgent);
        return this.handleRegisterAndLogin(response, session, user);
    }

    /**
     * Handle user login requests
     * Processes login credentials and handles multi-factor authentication
     * Returns appropriate response based on authentication result
     * @param request - HTTP request containing login credentials in body
     * @param response - HTTP response object for sending the authentication result
     */
    async handleLogin(request: Request, response: Response) {
        const login = await this.manager.login(request.body);

        if (login instanceof ErrorMessage)
            return response.send(login);

        if ('verification_required' in login && login.verification_required) {
            let err = new ErrorMessage(ErrorCodes.VerificationRequired, login.message || "Verification required");
            err.data = { methods: login.methods || [] };
            return response.send(err);
        }

        const authOutput = login as { session: Session; user: User };
        await authOutput.session.register(request.data.ip, request.data.userAgent);
        return this.handleRegisterAndLogin(response, authOutput.session, authOutput.user);
    }

    /**
     * Handle user logout requests
     * Invalidates the user's session and clears authentication cookies
     * Requires user to be authenticated with a valid bearer token
     * @param request - HTTP request containing the session token
     * @param response - HTTP response object for sending the logout result
     */
    async handleLogout(request: Request, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));
        const session = await request.data.getData() as Session | null;
        if (!session) return response.send(new ErrorMessage(ErrorCodes.SessionNotFound));
        let success = await this.app.sessions.deleteSession(session);
        response.clearCookie('_uid');
        return response.send<IRLogout>({
            success: success
        });
    }

    /**
     * Handle successful registration and login completion
     * Sets authentication cookies and returns complete user session data
     * Used by both registration and login flows after successful authentication
     * @param response - HTTP response object for setting cookies and sending data
     * @param session - The created session object containing token and expiration
     * @param user - The authenticated user object with profile information
     */
    async handleRegisterAndLogin(response: Response, session: Session, user: User) {
        response.cookie('_uid', session.token, {
            expires: session.expires,
            secure: Env.sync('SECURE'),
            sameSite: 'strict',
            httpOnly: true
        });
        const address = this.app.server.getInfos().address;
        const http = this.app.server.getInfos().gateways.http;
        const web = this.app.server.getInfos().gateways.web;
        return response.send<IRAuth>({
            token: session.token,
            expires: session.expires.getTime(),
            created_at: session.created_at.getTime(),
            user: {
                id: user.id,
                username: user.username,
                display: user.display,
                bio: user.bio || null,
                pronoun: user.pronoun,
                server: address,
                tags: user.getTags(),
                thumbnail: user.getThumbnail(http)?.href || null,
                banner: user.getBanner(http)?.href || null,
                home: user.getHomeRef()?.toString(address) || null,
                avatar: user.getAvatarRef()?.toString(address) || null,
                links: user.getLinks(),
                rank: user.rank,
                email: user.email || null,
                email_verified: user.email_verified,
                relations: null,
                created_at: user.created_at.getTime(),
                twofa_enabled: user.twofa_enabled,
                certificate: Security.compactCertificate(Security.certificateToPem(user.publicCertificate)),
                followers: await user.getFollowersCount(),
                following: await user.getFollowingCount(),
                presence: {
                    status: presenceToApi(user.presence),
                    text: user.presence_status,
                },
                alias: await user.alias(),
            }
        });
    }
}

/**
 * Response interface for logout operations
 * Contains the success status of the logout attempt
 */
export interface IRLogout {
    /** Whether the logout operation was successful */
    success: boolean;
}

/**
 * Response interface for session information
 * Contains basic session data including token and timing information
 */
export interface IRSession {
    /** 
     * Authentication token for the session 
     * Can be null for non-token based sessions
     */
    token: string | null;
    /** Session expiration timestamp (milliseconds since epoch) */
    expires: number;
    /** Session creation timestamp (milliseconds since epoch) */
    created_at: number;
}

/**
 * Response interface for authentication operations
 * Extends session information to include complete user profile data
 * Used for login and registration success responses
 */
export interface IRAuth extends IRSession {
    /** Complete user profile information */
    user: IRUserMe;
}

/**
 * Response interface for two-factor authentication checks
 * Used to inform clients about 2FA requirements before attempting login
 */
export interface IRCheck2FA {
    /** Whether the user has two-factor authentication enabled */
    requires2FA: boolean;
    /** Whether a user exists with the provided identifier */
    userExists: boolean;
}
