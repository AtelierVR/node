import Main from "../Main";
import Express from "express";
import NetExpress, { Request, Response } from "../network/NetExpress";
import { ErrorMessage } from "../utils/Utils";
import { ErrorCodes } from "../utils/Constants";
import User from "../users/User";
import EmailManager from "./EmailManager";
import Debug from "../utils/Debug";

/**
 * Web API handler for email-related endpoints
 * Provides HTTP endpoints for email testing, verification, and administration
 * Handles email verification workflows and admin email testing functionality
 */
export default class EmailAPIWeb {
    /**
     * Constructor for EmailAPIWeb
     * Sets up email-related HTTP routes and their handlers
     * @param app - Main application instance providing access to services
     * @param emailManager - EmailManager instance for handling email operations
     */
    constructor(private readonly app: Main, private readonly emailManager: EmailManager) {
        this.app.http.express.server.post("/api/admin/email/test", Express.json(), NetExpress.validate('email/test'), (req, res) => this.handleTestEmail(req as Request<{}>, res as Response));

        // Email verification endpoints
        this.app.http.express.server.get("/api/auth/email/verify", (req, res) => this.handleVerifyEmail(req as Request, res as Response));
        this.app.http.express.server.post("/api/email/resend-verification", Express.json(), (req, res) => this.handleResendVerification(req as Request, res as Response));
    }

    /**
     * Handle test email sending (admin only)
     * Allows administrators to test email functionality by sending test emails
     * Supports both templated emails and direct HTML emails
     * @param request - HTTP request containing email test parameters
     * @param response - HTTP response indicating success or failure of email sending
     */
    async handleTestEmail(request: Request<{}>, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));
        const user = await request.data.getData() as User | null;
        if (!user || !user.isAdmin())
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized, 'admin access required'));
        const { to, template, variables, subject, html, text } = request.body;

        if (!to) return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'to', 'email address required'));


        try {
            let success = false;

            if (template) {
                // Send templated email
                success = await this.emailManager.sendTemplatedEmail(to, template, variables || {}, subject);
            } else if (html) {
                // Send direct HTML email
                success = await this.emailManager.sendEmail(to, subject || 'Test Email', html, text);
            } else {
                return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'template or html', 'required'));
            }

            if (success) {
                return response.send({ success: true, message: 'Email sent successfully' });
            } else {
                return response.send(new ErrorMessage(ErrorCodes.InternalError, 'failed to send email'));
            }
        } catch (error) {
            Debug.error('Error in test email handler:', error);
            return response.send(new ErrorMessage(ErrorCodes.InternalError, 'email sending failed'));
        }
    }    /**
     * Handle email verification
     * Processes email verification tokens from verification links
     * Validates the token and marks the user's email as verified
     * @param request - HTTP request containing the verification token in query parameters
     * @param response - HTTP response indicating verification success or failure
     */
    async handleVerifyEmail(request: Request, response: Response) {
        const { token } = request.query;

        if (!token || typeof token !== 'string') {
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'token', 'verification token required'));
        }

        try {
            const result = await this.app.emails.verification.verifyEmailToken(token);

            if (result.success) {
                return response.send({
                    success: true,
                    message: 'Email verified successfully',
                    verified: true
                });
            } else {
                return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'token', result.message || 'Invalid or expired token'));
            }
        } catch (error) {
            Debug.error('Error in email verification handler:', error);
            return response.send(new ErrorMessage(ErrorCodes.InternalError, 'email verification failed'));
        }
    }

    /**
     * Handle resending verification email
     * Allows users to request a new verification email if they didn't receive the original
     * Requires user authentication and checks if email is already verified
     * @param request - HTTP request from authenticated user requesting email resend
     * @param response - HTTP response indicating success or failure of email resending
     */
    async handleResendVerification(request: Request, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));
        const user = await request.data.getData() as User | null;
        if (!user) return response.send(new ErrorMessage(ErrorCodes.UserNotFound));

        if (!user.email) return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'email', 'No email address associated with account'));
        if (user.email_verified) return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'email', 'Email is already verified'));

        try {
            const success = await this.app.emails.verification.sendVerificationEmail(user);

            if (success) {
                return response.send({
                    success: true,
                    message: 'Verification email sent successfully'
                });
            } else {
                return response.send(new ErrorMessage(ErrorCodes.InternalError, 'Failed to send verification email'));
            }
        } catch (error) {
            Debug.error('Error in resend verification handler:', error);
            return response.send(new ErrorMessage(ErrorCodes.InternalError, 'email sending failed'));
        }
    }

}
